/**
 * Phase 4 verification: the three health signals, kept apart (pnpm verify:health — P4-28 to
 * P4-31a).
 *
 * P4-28 is the one that matters most, and it is a regression test rather than a feature check.
 * Phase 3 shipped a defect where EVERY batch from a custom domain was refused as malformed and
 * silently lost — and the operational drop rate, the number §11.10 alerts on, sat at zero
 * throughout, because a contract rejection is not an operational drop. Nothing would ever have
 * paged anyone. So: a forced 400 must raise the contract-rejection signal ALONE.
 *
 * Everything here goes through the real endpoint and reads the rows a SECOND process wrote,
 * because that is the whole claim of D34: the web process owns the counters and writes them,
 * and the scheduler — another process, in another container — can read them afterwards.
 *
 * Needs a server started with the flush window at zero, so every batch writes its window
 * instead of waiting five minutes:
 *
 *   ANALYTICS_ROLLOUT_MODE=all ANALYTICS_HEALTH_FLUSH_MINUTES=0 pnpm exec next dev --port 3300
 *   BASE_URL=http://localhost:3300 pnpm verify:health
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env";
import { runScheduled } from "../lib/analytics/scheduled";
import { healthEvaluate } from "../lib/analytics/stages";
import { prisma } from "../lib/prisma";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPathForSlug,
  type AnalyticsEventInput,
} from "../lib/analytics/contract";
import { mintBootstrapToken } from "../lib/analytics/token";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { GRANT_ALL } from "../lib/consent/types";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import { disconnectJobPrisma } from "../lib/prisma-job";
import { closeRedis } from "../lib/redis";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const event = (over: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput => ({
  eventId: randomUUID(),
  type: "PAGE_VIEW",
  occurredAt: Date.now(),
  pageKind: "home",
  ...over,
});

type Totals = {
  rows: number;
  attempted: number;
  accepted: number;
  policy: number;
  operational: number;
  rejections: number;
  instances: string[];
};

async function main() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Health ${run}`,
    ownerName: "Phase4",
    ownerEmail: `health-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 4 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-health",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;
  const endpoint = `${BASE}${analyticsEventsPathForSlug(tenant.slug)}`;
  const consentCookie = `${consentCookieName(T)}=${encodeConsent(
    buildStoredConsent({ noticeVersion: tenant.consentNoticeVersion, grants: GRANT_ALL, locale: "en" }),
  )}`;

  try {
    /** Rows written since a moment, which is how a second process sees another's counters. */
    const totalsSince = async (since: Date): Promise<Totals> => {
      // Give `after()` a moment: the flush deliberately happens once the response is gone.
      for (let attempt = 0; attempt < 30; attempt++) {
        const rows = await prisma.analyticsOperationalMetric.findMany({
          where: { at: { gte: since } },
        });
        if (rows.length > 0 || attempt === 29) {
          return {
            rows: rows.length,
            attempted: rows.reduce((n, r) => n + r.attemptedBatches, 0),
            accepted: rows.reduce((n, r) => n + r.acceptedBatches, 0),
            policy: rows.reduce((n, r) => n + r.policyDrops, 0),
            operational: rows.reduce((n, r) => n + r.operationalDrops, 0),
            rejections: rows.reduce((n, r) => n + r.contractRejections, 0),
            instances: [...new Set(rows.map((r) => r.instance))],
          };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("unreachable");
    };

    const post = (body: unknown, cookie?: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });

    const envelope = (events: AnalyticsEventInput[]) => ({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      sentAt: Date.now(),
      token: mintBootstrapToken(T),
      events,
    });

    // A healthy batch first, so the window exists and the flush has something to write. This
    // also proves the flush is not writing rows for an instance that saw no traffic.
    const t0 = new Date();
    const accepted = await post(envelope([event()]), consentCookie);
    assert.equal(accepted.status, 202);
    const healthy = await totalsSince(t0);
    assert.ok(healthy.rows >= 1, "the ingesting process must write its own window");
    assert.equal(healthy.instances.length, 1, `one instance wrote these rows: ${healthy.instances}`);
    assert.match(
      healthy.instances[0],
      /^[^:]+:\d+$/,
      `the row must be keyed by hostname:pid, got ${healthy.instances[0]}`,
    );
    ok(
      "P4-31a",
      `a window written by the server was read by this process, keyed ${healthy.instances[0]}`,
    );

    // ------------------------------------------------------ P4-28: a 400 raises ONLY the 400s
    const t1 = new Date();
    // Malformed on purpose: an eventId that is not a UUID is exactly what Phase 3's bug sent.
    const bad = await post(
      envelope([{ ...event(), eventId: `${Date.now()}-not-a-uuid` } as AnalyticsEventInput]),
      consentCookie,
    );
    assert.equal(bad.status, 400, "a malformed envelope must be refused with 400");
    // One healthy batch after it, so the window flushes and we can read the pair together.
    await post(envelope([event()]), consentCookie);
    const afterBad = await totalsSince(t1);
    assert.ok(afterBad.rejections >= 1, `the 400 must raise contractRejections: ${JSON.stringify(afterBad)}`);
    assert.equal(
      afterBad.operational,
      0,
      "a contract rejection must NOT raise the operational drop rate — this is the Phase 3 " +
        "defect, where every batch was refused and that rate stayed at zero",
    );
    assert.equal(afterBad.policy, 0, "and must not look like a policy drop either");
    ok("P4-28", `a forced 400 raised ${afterBad.rejections} rejection(s) and 0 operational drops`);

    // ------------------------------------------- P4-30: a refused-consent batch raises neither
    const t2 = new Date();
    const refused = await post(envelope([event()])); // no consent cookie at all
    assert.equal(refused.status, 202, "a batch without consent is accepted and stored nowhere");
    await post(envelope([event()]), consentCookie);
    const afterRefusal = await totalsSince(t2);
    assert.ok(afterRefusal.policy >= 1, `honouring consent is a POLICY drop: ${JSON.stringify(afterRefusal)}`);
    assert.equal(afterRefusal.operational, 0, "and never an operational one");
    assert.equal(afterRefusal.rejections, 0, "and never a contract rejection");
    ok("P4-30", `a batch with no consent raised ${afterRefusal.policy} policy drop(s) and nothing else`);

    // ------------------------------------------- P4-29: a limiter raises the operational rate
    // The PER-VISITOR limiter (60/min) is the one that actually shapes traffic, and the only
    // one a check can reach without inventing a database fault — the per-IP and per-tenant
    // bounds are 3,000/min and would take a minute of hammering to reach for no extra proof.
    // Reaching it needs the visitor cookie the endpoint minted: a cookieless batch is bounded
    // by the far looser identity-creation limit instead, which is why this flood has to carry
    // the identity forward the way a browser does.
    const identity = (accepted.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .filter((c) => c.startsWith("store_visitor_") || c.startsWith("store_session_"));
    assert.ok(identity.length >= 1, "the first batch should have minted an identity to flood with");
    const visitorCookie = [consentCookie, ...identity].join("; ");

    const t3 = new Date();
    for (let i = 0; i < 80; i++) {
      await post(envelope([event()]), visitorCookie);
    }
    const afterFlood = await totalsSince(t3);
    assert.ok(
      afterFlood.operational >= 1,
      `a flood must produce at least one operational drop: ${JSON.stringify(afterFlood)}`,
    );
    assert.equal(
      afterFlood.rejections,
      0,
      "and must not be counted as a contract rejection: nothing malformed was sent",
    );
    ok(
      "P4-29",
      `a flood of 80 batches raised ${afterFlood.operational} operational drop(s) and 0 rejections`,
    );

    // ------------------------------------------------------- P4-31: windows cannot overlap
    const rows = await prisma.analyticsOperationalMetric.findMany({
      where: { at: { gte: t0 } },
      orderBy: { windowEnd: "asc" },
      select: { windowStart: true, windowEnd: true, instance: true, attemptedBatches: true },
    });
    assert.ok(rows.length >= 2, "there should be several windows by now");
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].instance !== rows[i - 1].instance) continue;
      assert.ok(
        rows[i].windowStart.getTime() >= rows[i - 1].windowEnd.getTime() - 50,
        `window ${i} starts before window ${i - 1} ended, so a batch could be counted twice`,
      );
    }
    const totalAttempted = rows.reduce((n, r) => n + r.attemptedBatches, 0);
    assert.ok(totalAttempted >= 80, `every batch should be counted once: ${totalAttempted}`);
    ok("P4-31", `${rows.length} windows, none overlapping, ${totalAttempted} batches counted once`);

    // ----------------------------------------- P4-31a: a quiet instance leaves no row at all
    // This process has its own counters (it imported the same module) and has ingested nothing,
    // so a flush here must write nothing — which is what makes "no rows" mean silence.
    const { flushAnalyticsHealth } = await import("../lib/analytics/health-flush");
    const before = await prisma.analyticsOperationalMetric.count();
    const wrote = await flushAnalyticsHealth(true);
    const after = await prisma.analyticsOperationalMetric.count();
    assert.equal(wrote, null, "a process with no attempted batches must write nothing");
    assert.equal(after, before, "and must not create a row");
    ok("P4-31a", "a process that ingested nothing writes no row, even when forced to flush");

    // ------------------------------- the stage that reads them keeps the three apart as well
    // The counters being separate is half the claim; the other half is that the thing deciding
    // whether to wake somebody uses a different threshold for each. Rows are injected here so
    // each scenario is exact — producing 20+ real batches with a 6% operational rate on demand
    // would be slower and less precise, and it is the arithmetic under test, not the endpoint.
    await prisma.analyticsOperationalMetric.deleteMany({});
    const synthetic = (over: Record<string, number>) =>
      prisma.analyticsOperationalMetric.create({
        data: {
          instance: "check:1",
          windowStart: new Date(Date.now() - 60_000),
          windowEnd: new Date(),
          attemptedBatches: 100,
          acceptedBatches: 100,
          ...over,
        },
      });
    const lastRun = async () =>
      prisma.analyticsScheduledRun.findFirstOrThrow({
        where: { stage: "health-evaluate" },
        orderBy: { startedAt: "desc" },
      });

    // Rejections alone: well under the operational threshold, well over the rejection one.
    await synthetic({ contractRejections: env.ANALYTICS_CONTRACT_REJECTION_ALERT });
    await runScheduled([healthEvaluate], { log: () => {} });
    const onRejections = await lastRun();
    assert.equal(onRejections.status, "OK");
    assert.match(onRejections.detail ?? "", /ALERT/, "rejections at the threshold must alert");
    assert.match(onRejections.detail ?? "", /contract rejection/i);
    assert.doesNotMatch(
      onRejections.detail ?? "",
      /operational drops \d/,
      "and must not claim an operational problem: there was none",
    );
    ok(
      "P4-28",
      `${env.ANALYTICS_CONTRACT_REJECTION_ALERT} rejections alerted alone, with no operational claim`,
    );

    // Operational alone: no rejections at all, a rate over the percentage threshold.
    await prisma.analyticsOperationalMetric.deleteMany({});
    await synthetic({ operationalDrops: 20 });
    await runScheduled([healthEvaluate], { log: () => {} });
    const onOperational = await lastRun();
    assert.match(onOperational.detail ?? "", /ALERT/);
    assert.match(onOperational.detail ?? "", /operational drops 20\.0%/);
    assert.doesNotMatch(onOperational.detail ?? "", /contract rejection/i);
    ok("P4-29", "a 20% operational rate alerted on its own threshold, with no rejection claim");

    // Policy drops alone: the system working. Nothing should fire.
    await prisma.analyticsOperationalMetric.deleteMany({});
    await synthetic({ policyDrops: 100, acceptedBatches: 0 });
    await runScheduled([healthEvaluate], { log: () => {} });
    const onPolicy = await lastRun();
    assert.doesNotMatch(
      onPolicy.detail ?? "",
      /ALERT/,
      "100% policy drops is consent being honoured and must never alert",
    );
    assert.match(onPolicy.detail ?? "", /policy 100/);
    ok("P4-30", "a window of nothing but policy drops raised no alert at all");

    // A thin window: a real rate, but not enough batches to mean anything yet.
    await prisma.analyticsOperationalMetric.deleteMany({});
    await synthetic({ attemptedBatches: 5, acceptedBatches: 0, operationalDrops: 5 });
    await runScheduled([healthEvaluate], { log: () => {} });
    const onThin = await lastRun();
    assert.doesNotMatch(
      onThin.detail ?? "",
      /ALERT/,
      `${env.ANALYTICS_INGESTION_MIN_BATCHES} batches are needed before a rate means anything`,
    );
    ok("P4-29", `a 100% rate over 5 batches did not alert: §11.10 wants a meaningful baseline`);

    // And no rows at all is silence.
    await prisma.analyticsOperationalMetric.deleteMany({});
    await runScheduled([healthEvaluate], { log: () => {} });
    const onSilence = await lastRun();
    assert.equal(onSilence.status, "OK", "an empty window is not a failed stage");
    assert.match(onSilence.detail ?? "", /silence, not failure/);
    ok("P4-31a", "with no rows the stage reports silence rather than an outage");
  } finally {
    await prisma.analyticsOperationalMetric.deleteMany({});
    await prisma.analyticsScheduledRun.deleteMany({ where: { stage: "health-evaluate" } });
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

async function shutdown() {
  await disconnectJobPrisma().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

// No process.exit(): see the note in scripts/verify-search.ts.
main()
  .then(async () => {
    await shutdown();
    console.log(`\n${checks} checks passed.`);
  })
  .catch(async (error) => {
    await shutdown();
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
