import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // env.databaseUrl is the restricted, RLS-bound role (APP_DATABASE_URL) when set, else the
  // owner (DATABASE_URL). Migrations, seeds and dev/CI scripts run as the owner, which is a
  // superuser and bypasses RLS; those scripts point APP_DATABASE_URL at the owner URL via
  // scripts/_owner.ts so this same client talks to Postgres as the owner.
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type TxClient = Prisma.TransactionClient;

/**
 * Runs `fn` inside a transaction that first sets the tenant's RLS context. `set_config(…, true)`
 * is transaction-local, so it is cleared automatically when the transaction ends and can never
 * leak onto the next borrower of a pooled connection.
 *
 * Every tenant-scoped query MUST go through here (the query runs on the same connection the
 * setting was applied to). A bare `prisma.*` query under RLS with no context set simply returns
 * nothing — the isolation is fail-closed.
 */
export function withTenant<T>(
  tenantId: string,
  fn: (db: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(db);
  });
}

/**
 * Runs `fn` with RLS bypassed, for the platform admin's cross-tenant reads/writes and for the
 * pre-context lookups that can't yet know a tenant (creating a store's first content rows).
 * The bypass is a transaction-local setting the policies also accept; keep the callback small.
 */
export function withBypass<T>(fn: (db: TxClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.bypass', 'on', true)`;
    return fn(db);
  });
}
