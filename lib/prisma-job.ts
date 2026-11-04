/**
 * A third Prisma client, for the scheduled command only (§10, §14's
 * `ANALYTICS_JOB_DATABASE_POOL_MAX`).
 *
 * The job runs in its own container, so its pool is already separate from the web process's by
 * virtue of being a different process. The reason it is still declared here, small and tagged,
 * is the arithmetic: every pool counts against one Postgres `max_connections`, and a job that
 * quietly opened the application's default 30 while recomputing a month of aggregates would be
 * competing with checkout for the same scarce thing the analytics pool was split off to protect.
 *
 * Two connections is enough for a job that walks tenants in bounded batches, and the
 * `analytics-job` tag is what lets a check COUNT what the job holds rather than assume it.
 *
 * Unlike ingestion, this pool has no aggressive `statement_timeout`: a recompute legitimately
 * takes seconds, and killing it mid-way would leave a day half-aggregated. Its bound is the
 * stage lease instead (`lib/analytics/scheduled.ts`).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

export const ANALYTICS_JOB_APPLICATION_NAME = "analytics-job";

let client: PrismaClient | undefined;

/**
 * Created on first use, not at import: the web process must never open this pool just because
 * something in a shared module graph mentioned it.
 */
export function jobPrisma(): PrismaClient {
  if (client) return client;
  const adapter = new PrismaPg({
    connectionString: env.databaseUrl,
    max: env.ANALYTICS_JOB_DATABASE_POOL_MAX,
    application_name: ANALYTICS_JOB_APPLICATION_NAME,
  });
  client = new PrismaClient({ adapter });
  return client;
}

export async function disconnectJobPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

/**
 * The RLS wrappers the job uses, mirroring lib/prisma.ts's `withTenant` / `withBypass` but on
 * this client.
 *
 * Not imported from there on purpose: those are bound to the application's pool, and the point
 * of a separate pool is that nothing the job does can consume a connection checkout might need.
 * The policies are the same, so the isolation is the same.
 */
export type JobTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/** Runs `fn` with the tenant context set, so RLS filters every statement inside it. */
export function withJobTenant<T>(tenantId: string, fn: (tx: JobTx) => Promise<T>): Promise<T> {
  return jobPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as JobTx);
  });
}

/**
 * Runs `fn` with RLS bypassed — for the job's cross-tenant bookkeeping only (reading its own
 * run records, listing which stores exist). Never for a store's numbers: those go through
 * `withJobTenant`, so a bug in a WHERE clause cannot write one store's figures into another's
 * row. Keep the callback small.
 */
export function withJobBypass<T>(fn: (tx: JobTx) => Promise<T>): Promise<T> {
  return jobPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass', 'on', true)`;
    return fn(tx as unknown as JobTx);
  });
}
