/**
 * Reading the ledger.
 *
 * Kept apart from `lib/data/stock.ts`, which is the one file allowed to *move* stock and whose
 * narrowness is checked by a grep rule in `pnpm verify:counter` and `pnpm verify:stock`. A read
 * never needs that guarantee, and piling the history screens' queries into the file would bury the
 * rule under them.
 *
 * Two things here are not presentation details:
 *
 *  - **unit cost is removed in the query, not in the markup** (D92). `withCost: false` leaves
 *    `unitCostCents` out of the `select`, so the figure never reaches the server component that
 *    renders the page, let alone the browser. A hidden column is not a permission check.
 *  - **every row is readable without the catalogue.** A movement carries the product's name and
 *    the variant's attributes as snapshots, because `updateProduct` hard-deletes variants an owner
 *    removes from the form — so the row that explains where forty units went must not depend on
 *    the variant still existing.
 */

import { normalizeAdminPageSize } from "@/lib/admin-pagination";
import { withTenant } from "@/lib/prisma";
import type { StockMovementReasonValue } from "@/lib/stock";
import { LOW_STOCK } from "@/lib/variants";

/**
 * How many movements a store has recorded, for the platform console's switch page.
 *
 * Scoped with `withTenant` rather than `withBypass`, for the reason `countCounterSales` gives: the
 * platform admin is asking about ONE store, so the narrower tool is the right one.
 */
export function countStockMovements(tenantId: string) {
  return withTenant(tenantId, (db) => db.stockMovement.count({ where: { tenantId } }));
}

export type StockMovementFilter = {
  reason?: StockMovementReasonValue;
  /** One variant's own history, newest first. */
  variantId?: string;
  /** One submitted document's lines — a receipt, a stocktake. */
  batchId?: string;
};

/**
 * One page of the ledger, newest first.
 *
 * `(createdAt desc, id desc)` is a total order and nothing more. A store-wide history has no
 * causal order to show — two variants' movements are simply unrelated — and `variantSeq` is the
 * order *within* a variant, which is the only place one exists (D86). Ordering a mixed list by it
 * would be meaningless and would read as authoritative.
 *
 * The reason counts deliberately ignore the reason filter, so the tabs keep their numbers while one
 * is selected; they do respect `variantId`/`batchId`, because those narrow what the list is *about*
 * rather than which slice of it is shown.
 */
export function listStockMovementsPage(
  tenantId: string,
  requestedPage: number,
  filter: StockMovementFilter,
  requestedPageSize = 25,
  withCost = false,
) {
  const pageSize = normalizeAdminPageSize(requestedPageSize);
  const scope = {
    tenantId,
    ...(filter.variantId ? { variantId: filter.variantId } : {}),
    ...(filter.batchId ? { batchId: filter.batchId } : {}),
  };
  const where = { ...scope, ...(filter.reason ? { reason: filter.reason } : {}) };

  return withTenant(tenantId, async (db) => {
    const [total, counts] = await Promise.all([
      db.stockMovement.count({ where }),
      db.stockMovement.groupBy({ by: ["reason"], where: scope, _count: { _all: true } }),
    ]);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.stockMovement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        variantId: true,
        variantSeq: true,
        productNameSnapshot: true,
        variantAttributesSnapshot: true,
        delta: true,
        balanceAfter: true,
        reason: true,
        batchId: true,
        orderId: true,
        counterSaleId: true,
        note: true,
        actorUserId: true,
        actorNameSnapshot: true,
        // D92: owner only, and removed from the query rather than from the table markup.
        ...(withCost ? { unitCostCents: true } : {}),
        // So a row about a variant that still exists can link to where its stock is changed.
        // Null for a removed variant, which is why the snapshots above are what the screen reads.
        variant: { select: { productId: true } },
      },
    });
    return { items, total, page, pages, pageSize, counts };
  });
}

/** The document a `?batch=` filter is about, so the screen can name it instead of its id. */
export function getStockBatch(tenantId: string, id: string) {
  return withTenant(tenantId, (db) =>
    db.stockBatch.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        kind: true,
        reference: true,
        note: true,
        createdAt: true,
        actorNameSnapshot: true,
      },
    }),
  );
}

export type StockAttentionRow = {
  variantId: string;
  productId: string;
  productName: string;
  attributes: unknown;
  stock: number;
  /** The product's own threshold, or the platform default. */
  lowAt: number;
};

/** How many of this store's variants are empty, and how many are at or below their threshold. */
export type StockAttentionCounts = { empty: number; low: number; variants: number };

/**
 * What needs looking at: empty shelves first, then the ones running out.
 *
 * Raw because `stock <= COALESCE(p."lowStockThreshold", 3)` compares two columns, which Prisma's
 * query builder cannot express — the same reason the dashboard's running-low read is raw.
 *
 * Capped, and the counts come from a second statement over the whole catalogue rather than from the
 * length of this list: a shop with four hundred empty variants needs to be told four hundred, and
 * also needs a page that renders.
 */
export function getStockAttention(tenantId: string, limit = 40) {
  return withTenant(tenantId, async (db) => {
    const [rows, totals] = await Promise.all([
      db.$queryRaw<StockAttentionRow[]>`
        SELECT v."id"       AS "variantId",
               p."id"       AS "productId",
               p."name"     AS "productName",
               v."attributes",
               v."stock",
               COALESCE(p."lowStockThreshold", ${LOW_STOCK}) AS "lowAt"
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."productId"
        WHERE p."tenantId" = ${tenantId}
          AND v."stock" <= COALESCE(p."lowStockThreshold", ${LOW_STOCK})
        ORDER BY v."stock" ASC, p."name" ASC, v."id" ASC
        LIMIT ${limit}`,
      db.$queryRaw<{ empty: bigint; low: bigint; variants: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE v."stock" <= 0) AS "empty",
               COUNT(*) FILTER (
                 WHERE v."stock" > 0
                   AND v."stock" <= COALESCE(p."lowStockThreshold", ${LOW_STOCK})
               ) AS "low",
               COUNT(*) AS "variants"
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."productId"
        WHERE p."tenantId" = ${tenantId}`,
    ]);
    const t = totals[0];
    const counts: StockAttentionCounts = {
      empty: Number(t?.empty ?? 0),
      low: Number(t?.low ?? 0),
      variants: Number(t?.variants ?? 0),
    };
    return { rows, counts };
  });
}

export type StockSearchRow = StockAttentionRow & { productSlug: string };

/**
 * Find a variant by its product's name, for someone who knows what they are looking for.
 *
 * Bounded at 20 rows and refusing a query under two characters: this is a lookup, not a way to
 * page through the catalogue (Products already does that), and an unanchored `ILIKE` on one
 * character is the whole table. `Product.name` has no text index in this schema — see the till's
 * numbers in CLAUDE.md for the threshold at which that becomes worth changing.
 */
export function searchStockVariants(tenantId: string, query: string, limit = 20) {
  const q = query.trim();
  if (q.length < 2) return Promise.resolve([] as StockSearchRow[]);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return withTenant(tenantId, (db) =>
    db.$queryRaw<StockSearchRow[]>`
      SELECT v."id"       AS "variantId",
             p."id"       AS "productId",
             p."name"     AS "productName",
             p."slug"     AS "productSlug",
             v."attributes",
             v."stock",
             COALESCE(p."lowStockThreshold", ${LOW_STOCK}) AS "lowAt"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      WHERE p."tenantId" = ${tenantId}
        AND p."name" ILIKE ${like}
      ORDER BY p."name" ASC, v."sortOrder" ASC, v."id" ASC
      LIMIT ${limit}`,
  );
}
