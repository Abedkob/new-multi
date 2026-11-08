/**
 * A fixture, not a feature. `pnpm verify:counter` spawns this as a SUBPROCESS.
 *
 * Same reason as scripts/fixtures/aggregate-cross-tenant.ts: every verification script imports
 * scripts/_owner so it can set fixtures up across tenants, and the owner is a superuser, which
 * RLS does not apply to. An isolation check that runs as the owner proves only that a WHERE
 * clause was written correctly — the thing most likely to be wrong.
 *
 * So this runs as app_user, the way the application does, and tries the three things a buggy till
 * would do: read another store's sales, write a sale belonging to another store, and attach a
 * line to another store's sale (which the composite foreign key must refuse even if the policy
 * somehow let the row through).
 *
 *   tsx scripts/fixtures/counter-cross-tenant.ts <ownTenantId> <otherTenantId> <otherSaleId>
 */

import "dotenv/config";
import { Prisma } from "@/generated/prisma/client";
import { disconnectJobPrisma, withJobTenant, type JobTx } from "../../lib/prisma-job";

type Probe = { name: string; leakedRows?: number; refused: boolean; error: string };

async function readProbe(tx: JobTx, own: string, other: string): Promise<Probe> {
  const rows = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM "CounterSale" WHERE "tenantId" = ${other}`,
  );
  const items = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM "CounterSaleItem" WHERE "tenantId" = ${other}`,
  );
  void own;
  return {
    name: "read",
    leakedRows: Number(rows[0]?.c ?? 0) + Number(items[0]?.c ?? 0),
    refused: true,
    error: "",
  };
}

async function writeProbe(tx: JobTx, other: string): Promise<Probe> {
  try {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "CounterSale"
        ("id","tenantId","payment","submissionId","linesFingerprint","soldByNameSnapshot")
        VALUES (${`x-${Date.now()}-cs`}, ${other}, 'CASH', ${`x-${Date.now()}`}, 'f', 'probe')`,
    );
    return { name: "write-sale", refused: false, error: "" };
  } catch (error) {
    return {
      name: "write-sale",
      refused: true,
      error: error instanceof Error ? (error.message.split("\n").pop() ?? "") : "",
    };
  }
}

/** A line pointing at another store's sale: refused by the policy, the composite FK, or both. */
async function foreignParentProbe(tx: JobTx, own: string, otherSaleId: string): Promise<Probe> {
  try {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "CounterSaleItem"
        ("id","tenantId","counterSaleId","productNameSnapshot","regularPriceCentsSnapshot","priceCentsSnapshot","quantity")
        VALUES (${`x-${Date.now()}-ci`}, ${own}, ${otherSaleId}, 'probe', 100, 100, 1)`,
    );
    return { name: "foreign-parent", refused: false, error: "" };
  } catch (error) {
    return {
      name: "foreign-parent",
      refused: true,
      error: error instanceof Error ? (error.message.split("\n").pop() ?? "") : "",
    };
  }
}

async function main() {
  const [own, other, otherSaleId] = process.argv.slice(2);
  if (!own || !other || !otherSaleId) {
    throw new Error("usage: <ownTenantId> <otherTenantId> <otherSaleId>");
  }

  // One transaction per probe: a refused INSERT aborts its transaction, and a shared one would
  // make every probe after the first fail for the wrong reason.
  const probes: Probe[] = [];
  probes.push(await withJobTenant(own, (tx) => readProbe(tx, own, other)));
  probes.push(await withJobTenant(own, (tx) => writeProbe(tx, other)));
  probes.push(await withJobTenant(own, (tx) => foreignParentProbe(tx, own, otherSaleId)));

  const role = await withJobTenant(own, (tx) =>
    tx.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      Prisma.sql`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    ),
  );

  console.log(JSON.stringify({ role: role[0], probes }));
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ threw: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  })
  .finally(() => disconnectJobPrisma());
