/**
 * The one scheduled command's orchestration (§10).
 *
 * Dockploy invokes `pnpm analytics:scheduled` every five minutes and this decides what is due.
 * Everything about it is shaped by one rule, which is stricter here than anywhere else in the
 * analytics work: THIS CODE NEVER RUNS INSIDE A REQUEST. Phases 2 and 3 could only lose
 * analytics data if they misbehaved; this phase can delete it, so the job gets its own process,
 * its own pool (`lib/prisma-job.ts`), and no import path from any route.
 *
 * Three guarantees, in the order they matter:
 *
 *  1. **One run at a time**, enforced by a PostgreSQL advisory lock held on a dedicated
 *     connection for the whole command. A second invocation does not queue, does not partially
 *     run, and does not fail: it exits saying another run holds the lock, because that is the
 *     normal state of affairs when a stage takes longer than the five-minute interval.
 *
 *  2. **A stage's failure is its own.** Every stage is isolated: it records its own outcome and
 *     the remaining stages still run. A failed retention pass must not stop an aggregate
 *     refresh, or one bad night would leave merchants staring at stale numbers for a week. The
 *     command exits non-zero so the operator hears about it.
 *
 *  3. **A crashed run is recoverable.** The advisory lock dies with the process, but the row it
 *     left behind still says RUNNING. Every run first expires leases that have passed, so a
 *     stage interrupted by a container restart is simply run again rather than being skipped
 *     forever by its own stale bookkeeping.
 */

import { Client } from "pg";
import { env } from "@/lib/env";
import { jobPrisma } from "@/lib/prisma-job";

/**
 * One fixed key, next door to the one `scripts/ensure-app-role.cjs` uses for role creation.
 * Session-level (not transaction-level): the lock has to outlive each stage's transactions and
 * cover the whole command.
 */
const SCHEDULED_LOCK_KEY = 690814215;

/** A stage that has not reported in this long is treated as dead, and run again. */
const DEFAULT_LEASE_MINUTES = 10;

export type StageContext = {
  /** One clock for the whole run, so two stages cannot disagree about which day it is. */
  now: Date;
  /** D35: when true, a stage reports what it would change and changes nothing. */
  dryRun: boolean;
  log: (message: string) => void;
};

export type StageOutcome = {
  /** Whatever this stage counts — tenants, rows, days. Shown to the platform admin. */
  items?: number;
  /** One line, for a human. Never a stack trace and never a store's data. */
  detail?: string;
};

export type Stage = {
  name: string;
  /** Override for a stage that legitimately runs long (a month-wide recompute). */
  leaseMinutes?: number;
  run: (ctx: StageContext) => Promise<StageOutcome | void>;
};

export type StageReport = {
  stage: string;
  status: "OK" | "FAILED";
  items: number;
  detail?: string;
  error?: string;
  ms: number;
};

export type RunReport = {
  /** False when another run already held the lock — a normal outcome, not a failure. */
  acquired: boolean;
  expiredLeases: number;
  stages: StageReport[];
  failed: number;
};

/**
 * Takes the lock, expires stale leases, runs each stage in isolation, releases the lock.
 *
 * Stages are passed in rather than imported from a registry so that each later commit can add
 * its own, and so the orchestration can be verified with stages that deliberately succeed,
 * throw and run long — a check that can only pass is not a check.
 */
export async function runScheduled(
  stages: Stage[],
  options: { dryRun?: boolean; now?: Date; log?: (message: string) => void } = {},
): Promise<RunReport> {
  const log = options.log ?? ((message: string) => console.log(message));
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  // A raw connection, not Prisma: a session-level advisory lock belongs to one connection, and
  // a pooled client gives no promise about which one a later query gets.
  const lock = new Client({
    connectionString: env.databaseUrl,
    application_name: "analytics-job-lock",
  });
  await lock.connect();

  try {
    const acquired = await lock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [SCHEDULED_LOCK_KEY],
    );
    if (!acquired.rows[0]?.locked) {
      log("[analytics:scheduled] another run holds the lock; exiting without doing anything");
      return { acquired: false, expiredLeases: 0, stages: [], failed: 0 };
    }

    const db = jobPrisma();
    const expiredLeases = await expireStaleLeases(db, now, log);

    const reports: StageReport[] = [];
    for (const stage of stages) {
      reports.push(await runStage(db, stage, { now, dryRun, log }));
    }

    const failed = reports.filter((r) => r.status === "FAILED").length;
    return { acquired: true, expiredLeases, stages: reports, failed };
  } finally {
    // Releasing explicitly is tidiness, not correctness: the lock goes when the connection does.
    await lock.query("SELECT pg_advisory_unlock($1)", [SCHEDULED_LOCK_KEY]).catch(() => {});
    await lock.end().catch(() => {});
  }
}

async function expireStaleLeases(
  db: ReturnType<typeof jobPrisma>,
  now: Date,
  log: (message: string) => void,
): Promise<number> {
  const stale = await db.analyticsScheduledRun.updateMany({
    where: { status: "RUNNING", leaseUntil: { lt: now } },
    data: { status: "EXPIRED", finishedAt: now, error: "lease expired; the run did not finish" },
  });
  if (stale.count > 0) {
    log(`[analytics:scheduled] expired ${stale.count} stale lease(s) from an interrupted run`);
  }
  return stale.count;
}

async function runStage(
  db: ReturnType<typeof jobPrisma>,
  stage: Stage,
  ctx: StageContext,
): Promise<StageReport> {
  const leaseMinutes = stage.leaseMinutes ?? DEFAULT_LEASE_MINUTES;
  const record = await db.analyticsScheduledRun.create({
    data: {
      stage: stage.name,
      startedAt: ctx.now,
      leaseUntil: new Date(ctx.now.getTime() + leaseMinutes * 60_000),
      status: "RUNNING",
      dryRun: ctx.dryRun,
    },
    select: { id: true },
  });

  const started = Date.now();
  try {
    const outcome = (await stage.run(ctx)) ?? {};
    const ms = Date.now() - started;
    await db.analyticsScheduledRun.update({
      where: { id: record.id },
      data: {
        status: "OK",
        finishedAt: new Date(),
        items: outcome.items ?? 0,
        detail: outcome.detail ?? null,
      },
    });
    ctx.log(`[analytics:scheduled] ${stage.name}: ok in ${ms}ms${detailSuffix(outcome)}`);
    return { stage: stage.name, status: "OK", items: outcome.items ?? 0, detail: outcome.detail, ms };
  } catch (error) {
    const ms = Date.now() - started;
    const message = error instanceof Error ? error.message : "unknown error";
    // Recording the failure must not itself be able to take the command down — if the database
    // is the thing that broke, this write fails too, and the remaining stages still deserve
    // their turn.
    await db.analyticsScheduledRun
      .update({
        where: { id: record.id },
        data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 500) },
      })
      .catch(() => {});
    ctx.log(`[analytics:scheduled] ${stage.name}: FAILED after ${ms}ms — ${message}`);
    return { stage: stage.name, status: "FAILED", items: 0, error: message, ms };
  }
}

const detailSuffix = (outcome: StageOutcome) =>
  outcome.detail ? ` — ${outcome.detail}` : outcome.items ? ` — ${outcome.items} item(s)` : "";
