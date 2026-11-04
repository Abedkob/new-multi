/**
 * A fixture, not a feature. `pnpm verify:aggregates` spawns this as a SUBPROCESS for P4-23.
 *
 * The reason is the same as scripts/fixtures/scheduled-read-events.ts: every verification script
 * imports scripts/_owner, which points APP_DATABASE_URL at the owner so fixtures can be set up
 * across tenants — and the owner is a superuser, which RLS does not apply to. An isolation check
 * that runs as the owner proves only that a WHERE clause was written correctly, which is the
 * thing most likely to be wrong.
 *
 * So this runs as app_user, the way the real job does, and tries two things a buggy aggregate
 * would do: read another store's rows, and write a row belonging to another store.
 *
 *   tsx scripts/fixtures/aggregate-cross-tenant.ts <ownTenantId> <otherTenantId>
 */

import "dotenv/config";
import { disconnectJobPrisma, withJobTenant } from "../../lib/prisma-job";

async function main() {
  const [own, other] = process.argv.slice(2);
  if (!own || !other) throw new Error("usage: <ownTenantId> <otherTenantId>");

  const result = await withJobTenant(own, async (tx) => {
    // 1. Reading. The tenant context says `own`, so the other store's rows must be invisible
    //    even though this query deliberately asks for them by id.
    const leaked = await tx.analyticsDailyMetric.findMany({
      where: { tenantId: other },
      select: { id: true },
    });
    const ownRows = await tx.analyticsDailyMetric.count();

    // 2. Writing. The policy's WITH CHECK is what refuses this; without RLS it would succeed and
    //    one store's figures would land in another store's report.
    let writeRefused = false;
    let writeError = "";
    try {
      await tx.analyticsDailyMetric.create({
        data: {
          tenantId: other,
          localDay: new Date("2026-01-01T00:00:00.000Z"),
          timeZone: "Asia/Beirut",
          sessions: 999,
        },
      });
    } catch (error) {
      writeRefused = true;
      writeError = error instanceof Error ? error.message.split("\n").pop() ?? "" : "";
    }

    return { leakedRows: leaked.length, ownRows, writeRefused, writeError };
  });

  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ threw: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => disconnectJobPrisma());
