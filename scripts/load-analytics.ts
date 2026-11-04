/**
 * Sustained, realistic analytics load (pnpm load:analytics).
 *
 * The P2-30 saturation check answers "can analytics starve checkout" by pushing far past
 * capacity for a moment. This answers a different and more practical question: what does a
 * normal day look like, and how many shoppers can one instance actually measure?
 *
 * So the shape here is ordinary browsing, not a flood. Each simulated visitor keeps its own
 * cookie jar, flushes a small batch on the tracker's real interval with jitter, and keeps doing
 * that for minutes. Nothing is bursty, because real traffic is not.
 *
 * Measure against a PRODUCTION BUILD. A dev server recompiles routes and runs an order of
 * magnitude slower, so a capacity number taken from it would be fiction:
 *
 *   pnpm build && pnpm start --port 3200       (with the production env set)
 *   BASE_URL=http://localhost:3200 pnpm load:analytics
 *
 * Tunable: LOAD_VISITORS (default 200), LOAD_SECONDS (default 180), LOAD_FLUSH_SECONDS (10).
 */

import "dotenv/config";
import "./_owner";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { parse as parseEnvFile } from "dotenv";
import { prisma } from "../lib/prisma";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPathForSlug,
  type AnalyticsEventInput,
  type PageKind,
} from "../lib/analytics/contract";
import { mintBootstrapToken } from "../lib/analytics/token";
import { ANALYTICS_APPLICATION_NAME } from "../lib/prisma-analytics";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { GRANT_ALL } from "../lib/consent/types";
import { env } from "../lib/env";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const VISITORS = Number(process.env.LOAD_VISITORS ?? 200);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 180);
const FLUSH_SECONDS = Number(process.env.LOAD_FLUSH_SECONDS ?? 10);

/** What a visitor actually looks at, roughly in the proportions a storefront sees. */
const JOURNEY: PageKind[] = [
  "home",
  "shop",
  "category",
  "product",
  "product",
  "cart",
  "product",
  "checkout",
];

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

type Stats = {
  sentBatches: number;
  sentEvents: number;
  accepted: number;
  nonAccepted: number;
  failed: number;
  latencies: number[];
};

async function main() {
  const run = Date.now().toString(36);
  const password = await hashPassword("x".repeat(24));
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Load ${run}`,
    ownerName: "Load",
    ownerEmail: `load-${run}@example.test`,
    passwordHash: password,
    privacy: {
      privacyControllerName: "Load Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "load-script",
      jointControllerVersion: "2026-11",
    },
  });

  const endpoint = `${BASE}${analyticsEventsPathForSlug(tenant.slug)}`;
  const consentCookie = `${consentCookieName(tenant.id)}=${encodeConsent(
    buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
  )}`;

  const stats: Stats = {
    sentBatches: 0,
    sentEvents: 0,
    accepted: 0,
    nonAccepted: 0,
    failed: 0,
    latencies: [],
  };

  // Connection sampling, by application_name.
  const restricted = parseEnvFile(readFileSync(".env")).APP_DATABASE_URL;
  const monitor = new Client({ connectionString: restricted });
  await monitor.connect();
  let peakAnalytics = 0;
  let peakTotal = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const { rows } = await monitor.query<{ application_name: string; n: string }>(
        `select coalesce(nullif(application_name, ''), 'app') application_name, count(*) n
           from pg_stat_activity where datname = current_database() group by 1`,
      );
      const analytics = Number(
        rows.find((r) => r.application_name === ANALYTICS_APPLICATION_NAME)?.n ?? 0,
      );
      peakAnalytics = Math.max(peakAnalytics, analytics);
      peakTotal = Math.max(peakTotal, rows.reduce((sum, r) => sum + Number(r.n), 0));
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  /** One visitor, with their own cookie jar, browsing until the clock runs out. */
  async function visitor(index: number, until: number) {
    // Each visitor's own jar; the server hands back visitor and session cookies on the first
    // reply and they are echoed from then on, exactly as a browser would.
    let identity = "";
    let step = index % JOURNEY.length;

    // Stagger starts across one flush interval so arrivals are spread, not synchronised.
    await new Promise((r) => setTimeout(r, Math.random() * FLUSH_SECONDS * 1000));

    while (Date.now() < until) {
      const now = Date.now();
      const count = 1 + Math.floor(Math.random() * 3);
      const events: AnalyticsEventInput[] = Array.from({ length: count }, (_, i) => ({
        eventId: randomUUID(),
        type: "PAGE_VIEW" as const,
        occurredAt: now - (count - i) * 1000,
        pageKind: JOURNEY[(step += 1) % JOURNEY.length],
      }));

      const body = JSON.stringify({
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        sentAt: now,
        token: mintBootstrapToken(tenant.id),
        events,
      });

      const started = Date.now();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: identity ? `${consentCookie}; ${identity}` : consentCookie,
          },
          body,
        });
        stats.latencies.push(Date.now() - started);
        stats.sentBatches += 1;
        stats.sentEvents += count;
        if (response.status === 202) stats.accepted += 1;
        else stats.nonAccepted += 1;

        const setCookies = response.headers.getSetCookie?.() ?? [];
        const pairs = setCookies
          .map((c) => c.split(";")[0])
          .filter((c) => c.startsWith("store_visitor_") || c.startsWith("store_session_"));
        if (pairs.length) identity = pairs.join("; ");
      } catch {
        stats.failed += 1;
      }

      // Think time: the tracker's interval, jittered so visitors do not march in lockstep.
      const jitter = FLUSH_SECONDS * 1000 * (0.7 + Math.random() * 0.6);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }

  console.log(
    `Load: ${VISITORS} visitors, ${SECONDS}s, a batch every ~${FLUSH_SECONDS}s each -> ` +
      `~${Math.round((VISITORS * 60) / FLUSH_SECONDS)} batches/min against ${BASE}`,
  );
  const until = Date.now() + SECONDS * 1000;
  const progress = setInterval(() => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    process.stdout.write(
      `\r  ${stats.sentBatches} batches sent, ${stats.accepted} accepted, ${left}s left   `,
    );
  }, 2000);

  try {
    await Promise.all(Array.from({ length: VISITORS }, (_, i) => visitor(i, until)));
  } finally {
    clearInterval(progress);
    sampling = false;
    await sampler;
    process.stdout.write("\n");
  }

  // Let the last writes land before counting.
  await new Promise((r) => setTimeout(r, 2000));

  const storedEvents = await prisma.analyticsEvent.count({ where: { tenantId: tenant.id } });
  const visitors = await prisma.analyticsVisitor.count({ where: { tenantId: tenant.id } });
  const sessions = await prisma.analyticsSession.count({ where: { tenantId: tenant.id } });

  const dropRate = stats.sentEvents === 0 ? 0 : 1 - storedEvents / stats.sentEvents;
  const batchesPerMinute = (stats.sentBatches / SECONDS) * 60;
  const p50 = percentile(stats.latencies, 50);
  const p95 = percentile(stats.latencies, 95);
  const p99 = percentile(stats.latencies, 99);

  console.log("\n--- sustained load ------------------------------------------------");
  console.log(`  visitors simulated        ${VISITORS} over ${SECONDS}s`);
  console.log(`  batches sent              ${stats.sentBatches} (${batchesPerMinute.toFixed(0)}/min)`);
  console.log(`  events sent               ${stats.sentEvents}`);
  console.log(`  events stored             ${storedEvents}`);
  console.log(`  drop rate                 ${(dropRate * 100).toFixed(2)}%`);
  console.log(`  non-202 responses         ${stats.nonAccepted}`);
  console.log(`  transport failures        ${stats.failed}`);
  console.log(`  ingestion latency         p50 ${p50}ms  p95 ${p95}ms  p99 ${p99}ms`);
  console.log(`  rows created              ${visitors} visitors, ${sessions} sessions`);
  console.log(`  analytics connections     peak ${peakAnalytics}/${env.ANALYTICS_DATABASE_POOL_MAX}`);
  console.log(`  database connections      peak ${peakTotal}`);

  // Capacity, stated as what was measured rather than as a promise. The binding limit is
  // whichever comes first: sustained batch throughput, or the per-tenant rate limit.
  const perVisitorBatchesPerMinute = 60 / FLUSH_SECONDS;
  const byTenantLimit = Math.floor(
    (60_000 / 60_000) * (3_000 / perVisitorBatchesPerMinute),
  );
  console.log("\n--- capacity ------------------------------------------------------");
  console.log(
    `  measured: ${VISITORS} concurrent visitors at ${batchesPerMinute.toFixed(0)} batches/min ` +
      `with a ${(dropRate * 100).toFixed(2)}% drop rate and p95 ${p95}ms`,
  );
  console.log(
    `  the per-store rate limit (3000/min) caps one store at ~${byTenantLimit} concurrent ` +
      `visitors browsing at this rate, whatever the hardware does`,
  );

  await monitor.end().catch(() => {});
  await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => {});
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
