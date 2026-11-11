/**
 * A fixture, not a feature. `pnpm verify:stock` spawns this as a SUBPROCESS.
 *
 * Same reason as scripts/fixtures/counter-cross-tenant.ts: every verification script imports
 * scripts/_owner so it can set fixtures up across tenants, and the owner is a superuser, which RLS
 * does not apply to. An isolation check that runs as the owner proves only that a WHERE clause was
 * written correctly — the thing most likely to be wrong.
 *
 * So this runs as app_user, the way the application does, and tries the four things a buggy
 * stockroom would do: read another store's ledger, write a movement into it, write a document
 * header into it, and — the interesting one — file a movement of its OWN against another store's
 * document. The last is not covered by the policy: `batchId` is a plain foreign key (ON DELETE SET
 * NULL cannot null a composite whose tenantId is NOT NULL, and CASCADE would let a document delete
 * ledger rows), and Postgres checks a foreign key with the referencing table's privileges while
 * ignoring RLS on the referenced table. So this probe reports what actually happens rather than
 * asserting what ought to; the suite that reads it records the answer.
 *
 *   tsx scripts/fixtures/stock-cross-tenant.ts <ownTenantId> <otherTenantId> <otherBatchId> <ownVariantId>
 */

import "dotenv/config";
import { Prisma } from "@/generated/prisma/client";
import { disconnectJobPrisma, withJobTenant, type JobTx } from "../../lib/prisma-job";

type Probe = { name: string; leakedRows?: number; refused: boolean; error: string };

const failure = (name: string, error: unknown): Probe => ({
  name,
  refused: true,
  error: error instanceof Error ? (error.message.split("\n").pop() ?? "") : "",
});

async function readProbe(tx: JobTx, other: string): Promise<Probe> {
  const movements = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM "StockMovement" WHERE "tenantId" = ${other}`,
  );
  const batches = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM "StockBatch" WHERE "tenantId" = ${other}`,
  );
  return {
    name: "read",
    leakedRows: Number(movements[0]?.c ?? 0) + Number(batches[0]?.c ?? 0),
    refused: true,
    error: "",
  };
}

async function writeMovementProbe(tx: JobTx, other: string): Promise<Probe> {
  try {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "StockMovement"
        ("id","tenantId","variantSeq","productNameSnapshot","delta","balanceAfter","reason","actorNameSnapshot")
        VALUES (${`x-${Date.now()}-sm`}, ${other}, 9999, 'probe', 1000, 1000, 'ADJUST', 'probe')`,
    );
    return { name: "write-movement", refused: false, error: "" };
  } catch (error) {
    return failure("write-movement", error);
  }
}

async function writeBatchProbe(tx: JobTx, other: string): Promise<Probe> {
  try {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "StockBatch"
        ("id","tenantId","kind","submissionId","linesFingerprint","actorNameSnapshot")
        VALUES (${`x-${Date.now()}-sb`}, ${other}, 'RECEIPT', ${`x-${Date.now()}`}, 'f', 'probe')`,
    );
    return { name: "write-batch", refused: false, error: "" };
  } catch (error) {
    return failure("write-batch", error);
  }
}

/**
 * A movement of this store's own, filed against another store's document.
 *
 * Reported, not assumed. See the header: the foreign key cannot be composite, and Postgres does
 * not apply RLS when it checks one.
 */
async function foreignBatchProbe(
  tx: JobTx,
  own: string,
  otherBatchId: string,
  ownVariantId: string,
): Promise<Probe> {
  try {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "StockMovement"
        ("id","tenantId","variantId","variantSeq","productNameSnapshot","delta","balanceAfter","reason","batchId","actorNameSnapshot")
        VALUES (${`x-${Date.now()}-fb`}, ${own}, ${ownVariantId}, 8888, 'probe', 0, 0, 'ADJUST',
                ${otherBatchId}, 'probe')`,
    );
    return { name: "foreign-batch", refused: false, error: "" };
  } catch (error) {
    return failure("foreign-batch", error);
  }
}

async function main() {
  const [own, other, otherBatchId, ownVariantId] = process.argv.slice(2);
  if (!own || !other || !otherBatchId || !ownVariantId) {
    throw new Error("usage: <ownTenantId> <otherTenantId> <otherBatchId> <ownVariantId>");
  }

  // One transaction per probe: a refused INSERT aborts its transaction, and a shared one would
  // make every probe after the first fail for the wrong reason.
  const probes: Probe[] = [];
  probes.push(await withJobTenant(own, (tx) => readProbe(tx, other)));
  probes.push(await withJobTenant(own, (tx) => writeMovementProbe(tx, other)));
  probes.push(await withJobTenant(own, (tx) => writeBatchProbe(tx, other)));
  probes.push(
    await withJobTenant(own, (tx) => foreignBatchProbe(tx, own, otherBatchId, ownVariantId)),
  );

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
