/**
 * What `pnpm analytics:scheduled` actually does (§10).
 *
 * Each stage is small, idempotent and independent: the orchestration
 * (`lib/analytics/scheduled.ts`) isolates failures, so a stage's job is to do its own work and
 * record how far it got, not to defend the run.
 *
 * Three stages recompute aggregates, and they exist as three rather than one because they answer
 * three different questions about WHICH days are stale:
 *
 *   - `aggregate-recompute`  today and yesterday, in each store's own zone. The ordinary case:
 *                            a day is not finished until it is finished, and yesterday can still
 *                            receive a beacon that was queued when the browser closed.
 *   - `order-status-sweep`   the days belonging to orders whose status changed recently (D33).
 *                            Cash on delivery means a cancellation lands days after the order,
 *                            and nothing else would ever revisit that day.
 *   - `nightly-backfill`     the last 30 days, once per local day. The backstop: anything the
 *                            two windows above missed — a long outage, a clock change, a bug
 *                            fixed yesterday — is corrected within a day without anybody
 *                            running a script by hand.
 *
 * Tenants are walked in bounded batches and one store's failure does not stop the next: a
 * cursor row per store per stage records the last day computed and the last error, so a store
 * that keeps failing while the others succeed is visible (and is what Phase 6 will alert on).
 */

import {
  daysTouchedByOrderChanges,
  recomputeDays,
  type AggregateTenant,
} from "@/lib/analytics/aggregate";
import { localDayOf, previousLocalDay, recentLocalDays, type LocalDay } from "@/lib/analytics/local-day";
import { describeRetention, runRetention } from "@/lib/analytics/retention";
import type { Stage, StageContext } from "@/lib/analytics/scheduled";
import { env } from "@/lib/env";
import { jobPrisma, withJobBypass, withJobTenant } from "@/lib/prisma-job";

/** How many stores one run will touch. A thousand stores must not become one unbounded query. */
const TENANT_BATCH = 50;

/** How far back the status sweep looks. Generous against the five-minute interval, because a
 *  missed run must not mean a missed correction. */
const STATUS_SWEEP_MINUTES = 60;

/** The backstop window (D33). 30 days matches the aggregate retention conversation in §4.7. */
const BACKFILL_DAYS = 30;

/** §11.10's evaluation window for the ingestion signals. */
const HEALTH_WINDOW_MINUTES = 10;

async function tenantsToProcess(): Promise<AggregateTenant[]> {
  // Tenant is not under RLS (it cannot be: the storefront resolves a store by slug before any
  // tenant context exists), so this needs no bypass — but it is cross-tenant bookkeeping, which
  // is exactly what withJobBypass is for, and being explicit keeps the intent readable.
  return withJobBypass((tx) =>
    tx.tenant.findMany({
      where: { analyticsPausedAt: null },
      select: { id: true, analyticsTimezone: true },
      orderBy: { createdAt: "asc" },
      take: TENANT_BATCH,
    }),
  );
}

async function recordCursor(
  tenantId: string,
  stage: string,
  day: LocalDay | null,
  error: string | null,
) {
  await withJobTenant(tenantId, async (tx) => {
    const data = {
      lastRunAt: new Date(),
      ...(day ? { lastComputedDay: new Date(`${day}T00:00:00.000Z`) } : {}),
      ...(error ? { failures: { increment: 1 }, lastError: error.slice(0, 500) } : { failures: 0, lastError: null }),
    };
    await tx.analyticsAggregationCursor.upsert({
      where: { tenantId_stage: { tenantId, stage } },
      create: { tenantId, stage, lastRunAt: new Date(), lastComputedDay: day ? new Date(`${day}T00:00:00.000Z`) : null, lastError: error, failures: error ? 1 : 0 },
      update: data,
    });
  });
}

/**
 * Runs `work` for each store, keeping one store's failure to that store.
 *
 * A single store with a corrupt row must not stop the other forty-nine from being aggregated —
 * that is how one bad store silently freezes a whole platform's reporting.
 */
async function perTenant(
  stage: string,
  ctx: StageContext,
  work: (tenant: AggregateTenant) => Promise<LocalDay[]>,
) {
  const tenants = await tenantsToProcess();
  let done = 0;
  let failed = 0;
  let days = 0;
  for (const tenant of tenants) {
    try {
      const computed = await work(tenant);
      days += computed.length;
      done += 1;
      await recordCursor(tenant.id, stage, computed.at(-1) ?? null, null);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown error";
      ctx.log(`[analytics:scheduled] ${stage}: ${tenant.id} failed — ${message}`);
      await recordCursor(tenant.id, stage, null, message).catch(() => {});
    }
  }
  return {
    items: days,
    detail: `${done} store(s), ${days} day(s)${failed ? `, ${failed} failed` : ""}`,
  };
}

/** Today and yesterday, in each store's own zone. */
export const aggregateRecompute: Stage = {
  name: "aggregate-recompute",
  run: (ctx) =>
    perTenant("aggregate-recompute", ctx, async (tenant) => {
      if (ctx.dryRun) return [];
      const today = localDayOf(ctx.now, tenant.analyticsTimezone);
      const days = [previousLocalDay(today), today];
      await recomputeDays(tenant, days);
      return days;
    }),
};

/** The days of orders whose status changed recently (D33). */
export const orderStatusSweep: Stage = {
  name: "order-status-sweep",
  run: (ctx) =>
    perTenant("order-status-sweep", ctx, async (tenant) => {
      const since = new Date(ctx.now.getTime() - STATUS_SWEEP_MINUTES * 60_000);
      const days = await withJobTenant(tenant.id, (tx) =>
        daysTouchedByOrderChanges(tenant, since, tx),
      );
      if (ctx.dryRun || days.length === 0) return days;
      await recomputeDays(tenant, days);
      return days;
    }),
};

/**
 * The last 30 days, at most once per local day per store.
 *
 * Leases make this safe to attempt on every run: the cursor says which day it last completed,
 * so the thirty-day pass happens once a day and the other 287 invocations cost one query.
 */
export const nightlyBackfill: Stage = {
  name: "nightly-backfill",
  leaseMinutes: 30,
  run: (ctx) =>
    perTenant("nightly-backfill", ctx, async (tenant) => {
      const today = localDayOf(ctx.now, tenant.analyticsTimezone);
      const cursor = await withJobTenant(tenant.id, (tx) =>
        tx.analyticsAggregationCursor.findUnique({
          where: { tenantId_stage: { tenantId: tenant.id, stage: "nightly-backfill" } },
          select: { lastComputedDay: true },
        }),
      );
      const lastDone = cursor?.lastComputedDay
        ? cursor.lastComputedDay.toISOString().slice(0, 10)
        : null;
      if (lastDone === today) return [];

      const days = recentLocalDays(ctx.now, tenant.analyticsTimezone, BACKFILL_DAYS);
      if (ctx.dryRun) return days;
      await recomputeDays(tenant, days);
      return days;
    }),
};

/**
 * Retention: the §4.7 windows, at most once a day (D35).
 *
 * Last in the list on purpose. Aggregates are computed FROM raw events, so deleting events
 * before recomputing would build a day's figures from data that had just been thinned — wrong
 * numbers, and only for the days nobody looks at any more, which is the worst place for a
 * silent error. Compute first, delete after.
 *
 * This is also the one stage where `--dry-run` does something rather than nothing: it reports
 * exactly what each window matches and removes none of it.
 */
export const retention: Stage = {
  name: "retention",
  leaseMinutes: 30,
  run: async (ctx) => {
    const last = await withJobBypass((tx) =>
      tx.analyticsScheduledRun.findFirst({
        where: { stage: "retention", status: "OK", dryRun: false },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      }),
    );
    // Once a day is plenty for a window measured in months, and it keeps the other 287
    // invocations of the day down to a single query.
    if (!ctx.dryRun && last && ctx.now.getTime() - last.startedAt.getTime() < 20 * 3_600_000) {
      return { items: 0, detail: "already run today" };
    }

    const result = await runRetention(ctx.now, ctx.dryRun);
    return {
      items: ctx.dryRun
        ? result.windows.reduce((sum, w) => sum + w.matched, 0)
        : result.totalDeleted,
      detail: `${ctx.dryRun ? "DRY RUN - " : ""}${describeRetention(result)}`,
    };
  },
};

/**
 * Reading the three health signals, each against its own threshold (§11.10, D29, D34).
 *
 * Evaluation only: this records what it found on the run, and Phase 6 decides who to wake and
 * how often. Keeping those apart means the thresholds can be argued about without touching
 * notification plumbing.
 *
 * The three signals are never one rate:
 *
 *  - POLICY drops are the system working. A visitor refused analytics; a store is outside the
 *    rollout. Alerting on these pages someone because consent is being honoured.
 *  - OPERATIONAL drops are the system struggling — a full pool, a limiter, a database timeout.
 *    §11.10's "over 5% of at least 20 attempted batches" is written against these.
 *  - CONTRACT REJECTIONS are our own code sending something the endpoint refuses. Not load, not
 *    consent, and not a percentage: a handful in a window is already a bug. Phase 3 shipped
 *    exactly that defect — every batch from a custom domain refused as malformed — while the
 *    operational rate sat at zero throughout, which is why this is its own number with its own
 *    threshold.
 *
 * And no rows in the window is SILENCE, not failure. An instance that received no traffic
 * writes nothing, so a quiet night must never read as an outage.
 */
export const healthEvaluate: Stage = {
  name: "health-evaluate",
  run: async (ctx) => {
    const since = new Date(ctx.now.getTime() - HEALTH_WINDOW_MINUTES * 60_000);
    const rows = await withJobBypass((tx) =>
      tx.analyticsOperationalMetric.findMany({
        where: { at: { gte: since } },
        select: {
          instance: true,
          attemptedBatches: true,
          acceptedBatches: true,
          policyDrops: true,
          operationalDrops: true,
          contractRejections: true,
        },
      }),
    );

    if (rows.length === 0) {
      return {
        items: 0,
        detail: `no ingestion rows in the last ${HEALTH_WINDOW_MINUTES}m: silence, not failure`,
      };
    }

    const sum = (pick: (row: (typeof rows)[number]) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);
    const attempted = sum((r) => r.attemptedBatches);
    const operational = sum((r) => r.operationalDrops);
    const policy = sum((r) => r.policyDrops);
    const rejections = sum((r) => r.contractRejections);
    const instances = new Set(rows.map((r) => r.instance)).size;
    const operationalPercent = attempted === 0 ? 0 : (operational / attempted) * 100;

    const alerts: string[] = [];
    if (
      attempted >= env.ANALYTICS_INGESTION_MIN_BATCHES &&
      operationalPercent > env.ANALYTICS_INGESTION_FAILURE_PERCENT
    ) {
      alerts.push(
        `operational drops ${operationalPercent.toFixed(1)}% of ${attempted} batches ` +
          `(threshold ${env.ANALYTICS_INGESTION_FAILURE_PERCENT}%)`,
      );
    }
    if (rejections >= env.ANALYTICS_CONTRACT_REJECTION_ALERT) {
      alerts.push(
        `${rejections} contract rejection(s) — our own code is sending something the endpoint ` +
          `refuses (threshold ${env.ANALYTICS_CONTRACT_REJECTION_ALERT})`,
      );
    }

    return {
      items: alerts.length,
      detail:
        `${instances} instance(s), ${attempted} batch(es): ` +
        `operational ${operationalPercent.toFixed(1)}%, policy ${policy}, rejections ${rejections}` +
        (alerts.length ? ` — ALERT: ${alerts.join("; ")}` : ""),
    };
  },
};

/** Everything the command runs, in order. */
export const ANALYTICS_STAGES: Stage[] = [
  aggregateRecompute,
  orderStatusSweep,
  nightlyBackfill,
  healthEvaluate,
  retention,
];

/** Exposed for a check that wants to recompute one store without the scheduler. */
export async function recomputeTenantNow(tenantId: string, days: readonly LocalDay[]) {
  const tenant = await jobPrisma().tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { id: true, analyticsTimezone: true },
  });
  return recomputeDays(tenant, days);
}
