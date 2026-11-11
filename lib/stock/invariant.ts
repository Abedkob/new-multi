/**
 * The one statement that says whether the ledger and the shelf still agree.
 *
 * **The invariant.** For every variant with at least one movement, the movement with the greatest
 * `variantSeq` has `balanceAfter` equal to `ProductVariant.stock`.
 *
 * Exported from here rather than written out in the suite, so that a future diagnostic, a platform
 * screen and `pnpm verify:stock` cannot drift into three slightly different definitions of
 * "correct" — which is the failure mode worth designing against, because each of them would look
 * green.
 *
 * **Where drift is legitimate, and why it heals.** Stock can move while the module is off: the
 * product form writes it, an order takes it, a till sale takes it, and none of those writes a
 * movement with `stockEnabled` false. So a store switched off, sold through, and switched back on
 * has a variant whose last movement predates the gap. That is expected, and it is exactly why the
 * ledger reconciles against the live figure instead of trusting a time window: the next movement on
 * that variant writes an `OPENING` row (delta 0, `balanceAfter` = whatever is actually on the
 * shelf) ahead of itself, and the invariant holds again from there.
 *
 * So a non-empty result means one of two things: an off-period that nothing has touched since, or a
 * writer that moved stock without going through `lib/data/stock.ts`. The second is what this is
 * for.
 */

import { prisma, withTenant, type TxClient } from "@/lib/prisma";

export type StockDrift = {
  variantId: string;
  productName: string;
  /** What is on the shelf now. */
  stock: number;
  /** What the newest movement said would be. */
  balanceAfter: number;
  variantSeq: number;
};

/**
 * Every variant in this store whose newest movement disagrees with its stock.
 *
 * One statement, and bounded by the number of *disagreeing* variants rather than by the catalogue:
 * the LATERAL join reads one movement row per variant (the `(variantId, variantSeq)` unique index
 * serves it) and the WHERE discards the agreeing ones in the database.
 *
 * Takes a `TxClient` so it can be called inside a caller's transaction — a check run outside one
 * could read a variant's stock and a movement written by a different transaction.
 */
export function findStockDrift(db: TxClient, tenantId: string): Promise<StockDrift[]> {
  return db.$queryRaw<StockDrift[]>`
    SELECT v."id"            AS "variantId",
           p."name"          AS "productName",
           v."stock",
           m."balanceAfter",
           m."variantSeq"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    JOIN LATERAL (
      SELECT "balanceAfter", "variantSeq"
      FROM "StockMovement"
      WHERE "variantId" = v."id"
      ORDER BY "variantSeq" DESC
      LIMIT 1
    ) m ON true
    WHERE p."tenantId" = ${tenantId}
      AND m."balanceAfter" <> v."stock"
    ORDER BY p."name", v."id"`;
}

/** The same question from outside a transaction, for a script or a one-off check. */
export function stockDriftForTenant(tenantId: string): Promise<StockDrift[]> {
  return withTenant(tenantId, (db) => findStockDrift(db, tenantId));
}

/**
 * Across every store, for a platform-level check.
 *
 * Reads through the unrestricted client on purpose: this is the one question that is not about one
 * tenant, and a per-tenant loop would be a different (and weaker) check — it could not notice rows
 * belonging to a store it was never told to look at.
 */
export function stockDriftEverywhere(): Promise<(StockDrift & { tenantId: string })[]> {
  return prisma.$queryRaw<(StockDrift & { tenantId: string })[]>`
    SELECT p."tenantId",
           v."id"            AS "variantId",
           p."name"          AS "productName",
           v."stock",
           m."balanceAfter",
           m."variantSeq"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    JOIN LATERAL (
      SELECT "balanceAfter", "variantSeq"
      FROM "StockMovement"
      WHERE "variantId" = v."id"
      ORDER BY "variantSeq" DESC
      LIMIT 1
    ) m ON true
    WHERE m."balanceAfter" <> v."stock"
    ORDER BY p."tenantId", p."name", v."id"`;
}

/** A one-line description of each drifting variant, for an assertion message. */
export function describeStockDrift(rows: readonly StockDrift[]): string {
  return rows
    .map(
      (row) =>
        `${row.productName} (${row.variantId}): shelf ${row.stock}, ledger says ${row.balanceAfter} ` +
        `at seq ${row.variantSeq}`,
    )
    .join("; ");
}
