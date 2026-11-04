/**
 * A second Prisma client, on its own deliberately small pool, used only by analytics ingestion.
 *
 * The whole point is that analytics cannot starve checkout. One shared pool means a burst of
 * beacons and a shopper pressing "Place order" compete for the same connections, and the
 * shopper is the one who notices. So ingestion gets its own small allowance and, when that runs
 * out, its work is DROPPED rather than queued — §7.5's "drop excess analytics work" is a
 * feature: a lost page view costs nothing, a delayed order costs a sale.
 *
 * Three bounds, all small on purpose:
 *   - `max`                     how many connections analytics may ever hold (default 5)
 *   - `connectionTimeoutMillis` how long a request waits for one before giving up
 *   - `statement_timeout`       how long a single statement may run before Postgres kills it
 *
 * Connections are tagged `analytics-ingestion` so `pg_stat_activity` shows exactly how many
 * analytics holds — which is what makes the pool-isolation check measurable rather than
 * a claim.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import type { TxClient } from "@/lib/prisma";

export const ANALYTICS_APPLICATION_NAME = "analytics-ingestion";

/** Shown in pg_stat_activity.application_name, and asserted by the saturation check. */
const globalForAnalytics = globalThis as unknown as {
  analyticsPrisma?: PrismaClient;
  analyticsPrismaClass?: typeof PrismaClient;
};

function createAnalyticsClient() {
  const adapter = new PrismaPg({
    connectionString: env.databaseUrl,
    max: env.ANALYTICS_DATABASE_POOL_MAX,
    // Do not queue behind a busy pool: a beacon that cannot be served in a second is dropped.
    connectionTimeoutMillis: 1_000,
    idleTimeoutMillis: 10_000,
    // A single ingestion statement has no business taking longer than this (§7.5).
    statement_timeout: 500,
    application_name: ANALYTICS_APPLICATION_NAME,
  });
  return new PrismaClient({ adapter });
}

// Same hot-reload guard as lib/prisma.ts: a cached client built from a previous generated
// class rejects the new fields after `prisma generate`.
function devAnalyticsClient() {
  const cached = globalForAnalytics.analyticsPrisma;
  if (cached && globalForAnalytics.analyticsPrismaClass === PrismaClient) return cached;
  void cached?.$disconnect();
  const client = createAnalyticsClient();
  globalForAnalytics.analyticsPrisma = client;
  globalForAnalytics.analyticsPrismaClass = PrismaClient;
  return client;
}

export const analyticsPrisma =
  env.NODE_ENV === "production" ? createAnalyticsClient() : devAnalyticsClient();

/**
 * Process-local concurrency ceiling (§7.5), sitting in front of the pool.
 *
 * Without it, a flood of beacons all wait on `connectionTimeoutMillis` and each holds a request
 * handler for a second. The ceiling turns that into an immediate, cheap refusal. It is set
 * slightly above the pool so a brief overlap still gets served.
 */
const MAX_IN_FLIGHT = env.ANALYTICS_DATABASE_POOL_MAX * 2;
let inFlight = 0;
let droppedForConcurrency = 0;

/** How many batches this process has dropped at the ceiling. Phase 4 flushes this to a metric. */
export const analyticsDropCount = () => droppedForConcurrency;

/**
 * Runs `fn` if there is room. Returns `null` when the ceiling is reached — the caller answers
 * 202 regardless, because a shopper must never learn that our analytics is busy.
 */
export async function withAnalyticsSlot<T>(fn: () => Promise<T>): Promise<T | null> {
  if (inFlight >= MAX_IN_FLIGHT) {
    droppedForConcurrency += 1;
    return null;
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
  }
}

/**
 * The analytics equivalent of withTenant(): sets the RLS tenant context for the transaction, on
 * the ingestion pool. Every write in this subsystem goes through here.
 */
export function withAnalyticsTenant<T>(
  tenantId: string,
  fn: (db: TxClient) => Promise<T>,
): Promise<T> {
  return analyticsPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(db);
  });
}
