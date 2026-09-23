import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaClass?: typeof PrismaClient;
};

function createClient() {
  // env.databaseUrl is the restricted, RLS-bound role (APP_DATABASE_URL) when set, else the
  // owner (DATABASE_URL). Migrations, seeds and dev/CI scripts run as the owner, which is a
  // superuser and bypasses RLS; those scripts point APP_DATABASE_URL at the owner URL via
  // scripts/_owner.ts so this same client talks to Postgres as the owner.
  //
  // max: node-postgres defaults to 10, shared by this whole process via the globalThis
  // singleton below. Every withTenant()/withBypass() call is an interactive transaction that
  // holds a connection for its full duration, and a single storefront page load fans out
  // several of those concurrently (see loadStorefrontData), so 10 runs out fast under any
  // real concurrency. Single instance only — once running more than one app instance, stop
  // raising this and put a connection pooler (PgBouncer, or the host's built-in one) in front
  // of Postgres instead; confirm Postgres's own max_connections covers this value either way.
  const adapter = new PrismaPg({ connectionString: env.databaseUrl, max: 30 });
  return new PrismaClient({ adapter });
}

// The dev-mode globalThis cache survives hot reloads so they don't each open a new pool. But after
// `prisma generate` (a schema change), the reloaded generated module exports a NEW PrismaClient
// class, while the cached instance was built from the old one and rejects the new fields
// ("Unknown field ... for select statement"). Reuse the cached client only if it came from the
// current class; otherwise retire it and build a fresh one.
function devClient() {
  const cached = globalForPrisma.prisma;
  if (cached && globalForPrisma.prismaClass === PrismaClient) return cached;
  void cached?.$disconnect();
  const client = createClient();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaClass = PrismaClient;
  return client;
}

export const prisma = env.NODE_ENV === "production" ? createClient() : devClient();

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
