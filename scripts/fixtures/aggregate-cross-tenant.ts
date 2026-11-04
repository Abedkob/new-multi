/**
 * A fixture, not a feature. `pnpm verify:aggregates` spawns this as a SUBPROCESS for P4-23.
 *
 * The reason is the same as scripts/fixtures/scheduled-read-events.ts: every verification script
 * imports scripts/_owner, which points APP_DATABASE_URL at the owner so fixtures can be set up
 * across tenants — and the owner is a superuser, which RLS does not apply to. An isolation check
 * that runs as the owner proves only that a WHERE clause was written correctly, which is the
 * thing most likely to be wrong.
 *
 * So this runs as app_user, the way the real job does, and tries both things a buggy aggregate
 * would do — read another store's rows, and write a row belonging to another store — against
 * EVERY table Phase 4 added. Covering one table and inferring the rest is how a migration that
 * forgot a policy on the fifth one goes unnoticed.
 *
 *   tsx scripts/fixtures/aggregate-cross-tenant.ts <ownTenantId> <otherTenantId>
 */

import "dotenv/config";
import { Prisma } from "@/generated/prisma/client";
import { disconnectJobPrisma, withJobTenant, type JobTx } from "../../lib/prisma-job";

/** The tables, and a minimal row for each, so the write half is a real INSERT. */
const TABLES = [
  {
    table: "AnalyticsDailyMetric",
    insert: (tenantId: string) =>
      Prisma.sql`INSERT INTO "AnalyticsDailyMetric" ("id","tenantId","localDay","timeZone","sessions")
                 VALUES (${`x-${Date.now()}-dm`}, ${tenantId}, ${"2026-01-01"}::date, 'Asia/Beirut', 1)`,
  },
  {
    table: "AnalyticsHourlyMetric",
    insert: (tenantId: string) =>
      Prisma.sql`INSERT INTO "AnalyticsHourlyMetric" ("id","tenantId","localDay","timeZone","hour","sessions")
                 VALUES (${`x-${Date.now()}-hm`}, ${tenantId}, ${"2026-01-01"}::date, 'Asia/Beirut', 9, 1)`,
  },
  {
    table: "AnalyticsProductDaily",
    insert: (tenantId: string) =>
      Prisma.sql`INSERT INTO "AnalyticsProductDaily" ("id","tenantId","localDay","timeZone","productId","views")
                 VALUES (${`x-${Date.now()}-pd`}, ${tenantId}, ${"2026-01-01"}::date, 'Asia/Beirut', 'p1', 1)`,
  },
  {
    table: "AnalyticsSearchDaily",
    insert: (tenantId: string) =>
      Prisma.sql`INSERT INTO "AnalyticsSearchDaily" ("id","tenantId","localDay","timeZone","phrase","searches")
                 VALUES (${`x-${Date.now()}-sd`}, ${tenantId}, ${"2026-01-01"}::date, 'Asia/Beirut', 'x', 1)`,
  },
  {
    table: "AnalyticsAcquisitionDaily",
    insert: (tenantId: string) =>
      Prisma.sql`INSERT INTO "AnalyticsAcquisitionDaily" ("id","tenantId","localDay","timeZone","sourceKind","sessions")
                 VALUES (${`x-${Date.now()}-ad`}, ${tenantId}, ${"2026-01-01"}::date, 'Asia/Beirut', 'direct', 1)`,
  },
  {
    table: "AnalyticsAggregationCursor",
    insert: (tenantId: string) =>
      Prisma.sql`INSERT INTO "AnalyticsAggregationCursor" ("id","tenantId","stage")
                 VALUES (${`x-${Date.now()}-ac`}, ${tenantId}, 'verify')`,
  },
] as const;

type TableResult = {
  table: string;
  leakedRows: number;
  ownRows: number;
  writeRefused: boolean;
  writeError: string;
};

async function checkTable(
  tx: JobTx,
  entry: (typeof TABLES)[number],
  own: string,
  other: string,
): Promise<TableResult> {
  // 1. Reading. The tenant context says `own`, so the other store's rows must be invisible even
  //    though this query asks for them by id.
  const leaked = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM ${Prisma.raw(`"${entry.table}"`)} WHERE "tenantId" = ${other}`,
  );
  const mine = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM ${Prisma.raw(`"${entry.table}"`)} WHERE "tenantId" = ${own}`,
  );

  // 2. Writing. The policy's WITH CHECK is what refuses this; without RLS it would succeed and
  //    one store's figures would land in another store's report.
  let writeRefused = false;
  let writeError = "";
  try {
    await tx.$executeRaw(entry.insert(other));
  } catch (error) {
    writeRefused = true;
    writeError = error instanceof Error ? (error.message.split("\n").pop() ?? "") : "";
  }

  return {
    table: entry.table,
    leakedRows: Number(leaked[0]?.c ?? 0),
    ownRows: Number(mine[0]?.c ?? 0),
    writeRefused,
    writeError,
  };
}

async function main() {
  const [own, other] = process.argv.slice(2);
  if (!own || !other) throw new Error("usage: <ownTenantId> <otherTenantId>");

  const results: TableResult[] = [];
  for (const entry of TABLES) {
    // One transaction per table: a refused INSERT aborts its transaction, and a shared one would
    // make every table after the first fail for the wrong reason.
    results.push(await withJobTenant(own, (tx) => checkTable(tx, entry, own, other)));
  }

  const role = await withJobTenant(own, (tx) =>
    tx.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      Prisma.sql`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    ),
  );

  console.log(JSON.stringify({ role: role[0], results }));
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ threw: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => disconnectJobPrisma());
