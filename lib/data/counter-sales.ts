/**
 * In-store counter sales. Every function takes a tenantId from the session and puts it in the
 * WHERE clause; variant ids come from a till screen and are only ever resolved through a product
 * of THIS store.
 *
 * Nothing here touches the analytics tables, the rollout gate or the consent machinery. A counter
 * sale is a first-party business record, not visitor measurement — which is also why the takings
 * figures are read straight from these tables rather than from AnalyticsDailyMetric, whose
 * aggregation job only runs for stores inside the analytics rollout (default `off`).
 *
 * Server-only.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { normalizeAdminPageSize } from "@/lib/admin-pagination";
import { withTenant } from "@/lib/prisma";
import { calculatePrice } from "@/lib/pricing";
import {
  decrementStockOrThrow,
  incrementStock,
  recordStockMovements,
  soldLines,
  stockLedgerEnabled,
  StockShortError,
} from "@/lib/data/stock";
import { isLicenseActive } from "@/lib/license/status";
import { maxManualDiscountCents, type CounterSalePaymentValue } from "@/lib/counter-sales";
import { parseAttributes, variantLabel } from "@/lib/variants";
import type { AdminRole } from "@/lib/roles";

const MAX_LINES = 50;
const MAX_QTY = 99;
const MAX_REASON = 200;

export type CounterSaleErrorCode =
  | "EMPTY"
  | "INVALID"
  | "FEATURE_OFF"
  | "UNAVAILABLE"
  | "STOCK"
  | "PRICE_CHANGED"
  | "DISCOUNT_REFUSED"
  | "SUBMISSION_REUSED"
  | "NOT_FOUND"
  | "ALREADY_VOIDED";

export class CounterSaleError extends Error {
  constructor(
    readonly code: CounterSaleErrorCode,
    message: string,
    readonly detail?: { variantId?: string; available?: number; expectedCents?: number; actualCents?: number },
  ) {
    super(message);
    this.name = "CounterSaleError";
  }
}

export type CounterSaleLineInput = {
  variantId: string;
  quantity: number;
  /** Per unit, in cents. 0 means no manual reduction. */
  manualDiscountCents?: number;
  manualDiscountReason?: string | null;
};

export type RecordCounterSaleInput = {
  /** Minted once per cart by the till screen; the idempotency key. */
  submissionId: string;
  payment: CounterSalePaymentValue;
  lines: CounterSaleLineInput[];
  /** Who is at the till, from the session — never from the form. */
  soldByUserId: string;
  soldByName: string;
  role: AdminRole;
  notes?: string;
  /** What the cashier was shown. A mismatch refuses the sale rather than charging a new price. */
  expectedTotalCents?: number;
};

/**
 * A stable hash of what this submission is FOR.
 *
 * Retrying the same cart must return the existing sale; reusing the same id for a different cart
 * must be refused rather than silently answered with the first sale. Sorted, so the same cart in
 * a different order is the same cart.
 */
export function counterSaleFingerprint(input: {
  payment: string;
  lines: CounterSaleLineInput[];
}): string {
  const parts = input.lines
    .map((l) => `${l.variantId}:${l.quantity}:${l.manualDiscountCents ?? 0}`)
    .sort();
  return createHash("sha256").update(`${input.payment}|${parts.join("|")}`).digest("hex");
}

/** The shape every till read returns for one sale's lines. */
const itemSelect = {
  id: true,
  variantId: true,
  productNameSnapshot: true,
  variantAttributesSnapshot: true,
  regularPriceCentsSnapshot: true,
  discountCentsSnapshot: true,
  discountNameSnapshot: true,
  manualDiscountCentsSnapshot: true,
  manualDiscountReason: true,
  priceCentsSnapshot: true,
  quantity: true,
} as const;

/** Validates and normalizes the payload with no database work, so a bad request costs nothing. */
function normalizeLines(lines: CounterSaleLineInput[]) {
  if (lines.length === 0) throw new CounterSaleError("EMPTY", "Add at least one item.");
  if (lines.length > MAX_LINES) {
    throw new CounterSaleError("INVALID", "Too many different items in one sale.");
  }
  const wanted = new Map<string, number>();
  const manual = new Map<string, { cents: number; reason: string | null }>();
  for (const line of lines) {
    if (typeof line.variantId !== "string" || !line.variantId) {
      throw new CounterSaleError("INVALID", "An item is missing its variant.");
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY) {
      throw new CounterSaleError("INVALID", "Invalid quantity.");
    }
    const cents = line.manualDiscountCents ?? 0;
    if (!Number.isInteger(cents) || cents < 0) {
      throw new CounterSaleError("INVALID", "Invalid discount.");
    }
    const reason = (line.manualDiscountReason ?? "").trim().slice(0, MAX_REASON);
    if (cents > 0 && !reason) {
      throw new CounterSaleError("DISCOUNT_REFUSED", "A price reduction needs a reason.");
    }
    // The same variant twice is one line with the quantities added, which is what the till screen
    // does on screen too — so the fingerprint of a cart cannot depend on how it was assembled.
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);
    manual.set(line.variantId, { cents, reason: reason || null });
  }
  for (const q of wanted.values()) {
    if (q > MAX_QTY) throw new CounterSaleError("INVALID", "Invalid quantity.");
  }
  return { wanted, manual };
}

export type RecordedCounterSale = {
  id: string;
  totalCents: number;
  /** True when this submission had already been recorded and is being returned again. */
  idempotent: boolean;
};

/**
 * Records a counter sale, or returns the one this submission already created.
 *
 * One transaction: lock the store, re-read the catalogue, re-price on the server, take the stock,
 * write the sale. Validation that needs no database happens before it, and nothing that is not a
 * query runs inside it.
 */
export async function recordCounterSale(
  tenantId: string,
  input: RecordCounterSaleInput,
): Promise<RecordedCounterSale> {
  const { wanted, manual } = normalizeLines(input.lines);
  const submissionId = input.submissionId.trim();
  if (!submissionId || submissionId.length > 64) {
    throw new CounterSaleError("INVALID", "Missing submission id.");
  }
  const fingerprint = counterSaleFingerprint({ payment: input.payment, lines: input.lines });
  const notes = (input.notes ?? "").trim().slice(0, 500);

  try {
    return await withTenant(tenantId, async (tx) => {
      // Lock the store row for this transaction, so a pause or a switch flipped mid-sale either
      // waits for this sale or takes effect before it. Same reasoning as placeOrder.
      const tenantRows = await tx.$queryRaw<{
        isPaused: boolean;
        counterSalesEnabled: boolean;
        stockEnabled: boolean;
      }[]>`
        SELECT "isPaused", "counterSalesEnabled", "stockEnabled"
        FROM "Tenant" WHERE id = ${tenantId} FOR SHARE`;
      const licenseRows = await tx.$queryRaw<{
        status: string;
        expiresAt: Date | null;
        offlineGraceUntil: Date | null;
      }[]>`
        SELECT status, "expiresAt", "offlineGraceUntil"
        FROM "TenantLicense" WHERE "tenantId" = ${tenantId} FOR SHARE`;
      const tenant = tenantRows[0];
      // The feature gate is enforced HERE, not only on the page: a server action is its own HTTP
      // endpoint, so a staff member who kept the page open after the switch was turned off, or
      // who posted to the action directly, is refused by the same check.
      if (!tenant || !tenant.counterSalesEnabled || tenant.isPaused || !isLicenseActive(licenseRows[0])) {
        throw new CounterSaleError("FEATURE_OFF", "This store cannot record counter sales.");
      }

      const ids = [...wanted.keys()];
      const pricedAt = new Date();
      // One read for every line, with the pricing graph attached. No N+1 and no second read of
      // the same product however many lines share it.
      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids }, product: { tenantId } },
        include: { product: { include: { discounts: { include: { discount: true } } } } },
      });
      if (variants.length !== ids.length) {
        throw new CounterSaleError("UNAVAILABLE", "Some items are no longer available.");
      }

      const items = variants.map((v) => {
        const price = calculatePrice(
          v.product.basePriceCents,
          v.priceCentsOverride,
          v.product.discounts.map((assignment) => assignment.discount),
          pricedAt,
        );
        const requested = manual.get(v.id)!;
        const ceiling = maxManualDiscountCents(input.role, price.finalPriceCents);
        if (requested.cents > ceiling) {
          const label = variantLabel(parseAttributes(v.attributes), "");
          throw new CounterSaleError(
            "DISCOUNT_REFUSED",
            `That reduction is more than you may give on "${v.product.name}${label ? ` (${label})` : ""}".`,
          );
        }
        return {
          // No tenantId here: it is a relation scalar of the composite foreign key, which Prisma
          // fills from the parent sale. That is the point of the composite key — a line cannot be
          // given a tenant of its own that disagrees with its parent's.
          variantId: v.id,
          productNameSnapshot: v.product.name,
          variantAttributesSnapshot: parseAttributes(v.attributes),
          regularPriceCentsSnapshot: price.regularPriceCents,
          discountCentsSnapshot: price.discountCents,
          discountIdSnapshot: price.appliedDiscount?.id ?? null,
          discountNameSnapshot: price.appliedDiscount?.name ?? null,
          manualDiscountCentsSnapshot: requested.cents,
          manualDiscountReason: requested.cents > 0 ? requested.reason : null,
          // Derived, never taken from the client. The CHECK constraint holds this shape too.
          priceCentsSnapshot: price.finalPriceCents - requested.cents,
          quantity: wanted.get(v.id)!,
        };
      });

      const totalCents = items.reduce((sum, i) => sum + i.priceCentsSnapshot * i.quantity, 0);
      // The cashier has taken money for a figure they were shown. If the server's authoritative
      // total differs, refuse and report both numbers — never charge a different price quietly.
      if (input.expectedTotalCents !== undefined && totalCents !== input.expectedTotalCents) {
        throw new CounterSaleError("PRICE_CHANGED", "The price changed. Check the total and try again.", {
          expectedCents: input.expectedTotalCents,
          actualCents: totalCents,
        });
      }

      await decrementStockOrThrow(tx, tenantId, wanted, (id, available) => {
        const v = variants.find((candidate) => candidate.id === id)!;
        const label = variantLabel(parseAttributes(v.attributes), "");
        const name = `${v.product.name}${label ? ` (${label})` : ""}`;
        return available > 0
          ? `Only ${available} left of "${name}".`
          : `"${name}" is out of stock.`;
      });

      const sale = await tx.counterSale.create({
        data: {
          tenantId,
          payment: input.payment,
          submissionId,
          linesFingerprint: fingerprint,
          soldByUserId: input.soldByUserId,
          soldByNameSnapshot: input.soldByName,
          notes,
          items: { create: items },
        },
        select: { id: true },
      });

      // The ledger, after the sale exists, because the movement names it. `stockEnabled` rode
      // along on the FOR SHARE read above, so a store without the module pays one column and no
      // extra statement. The cashier is the actor here, unlike a storefront sale: a counter sale
      // is somebody's action and the till already records whose.
      if (tenant.stockEnabled) {
        await recordStockMovements(
          tx,
          tenantId,
          {
            reason: "COUNTER_SALE",
            actor: { userId: input.soldByUserId, name: input.soldByName },
            counterSaleId: sale.id,
            at: pricedAt,
          },
          soldLines(wanted),
        );
      }
      return { id: sale.id, totalCents, idempotent: false };
    });
  } catch (error) {
    if (error instanceof StockShortError) {
      throw new CounterSaleError("STOCK", error.message, {
        variantId: error.variantId,
        available: error.available,
      });
    }
    // The unique index on (tenantId, submissionId) is the idempotency mechanism: the losing
    // transaction has already rolled back, stock included, so answering with the sale that did
    // commit is both correct and the whole point. A retry is a success, not an error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await getCounterSaleBySubmission(tenantId, submissionId);
      if (!existing) throw error;
      if (existing.linesFingerprint !== fingerprint) {
        throw new CounterSaleError(
          "SUBMISSION_REUSED",
          "That sale was already recorded with different items. Start a new sale.",
        );
      }
      return {
        id: existing.id,
        totalCents: existing.items.reduce((sum, i) => sum + i.priceCentsSnapshot * i.quantity, 0),
        idempotent: true,
      };
    }
    throw error;
  }
}

export type VoidResult = {
  /** How many lines had their stock returned, and how many there were. */
  restoredLines: number;
  totalLines: number;
};

/**
 * Voids a sale and returns its stock, once.
 *
 * A void reverses a mistake at the counter. It is not a return: there is no refund record and the
 * original lines are never modified.
 */
export async function voidCounterSale(
  tenantId: string,
  id: string,
  input: { reason: string; voidedByUserId: string; voidedByName?: string },
): Promise<VoidResult> {
  const reason = input.reason.trim().slice(0, MAX_REASON);
  if (!reason) throw new CounterSaleError("INVALID", "A void needs a reason.");

  return withTenant(tenantId, async (tx) => {
    const sale = await tx.counterSale.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, items: { select: { variantId: true, quantity: true } } },
    });
    if (!sale) throw new CounterSaleError("NOT_FOUND", "That sale no longer exists.");
    if (sale.status !== "RECORDED") {
      throw new CounterSaleError("ALREADY_VOIDED", "That sale was already voided.");
    }

    // Compare-and-swap on the status we just read, exactly as updateOrderStatus does. Two
    // concurrent voids: one matches a row, the other matches none and stops HERE, before any
    // stock is touched — so a sale's stock can never be returned twice.
    const { count } = await tx.counterSale.updateMany({
      where: { id, tenantId, status: "RECORDED" },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedByUserId: input.voidedByUserId,
        voidReason: reason,
      },
    });
    if (count !== 1) {
      throw new CounterSaleError("ALREADY_VOIDED", "That sale was already voided.");
    }

    // One extra read, and only on a void. The sale id is known here, so the ledger travels with
    // the restore rather than following it.
    //
    // `voidedByName` is optional because `counter:void` is owner-only (D73) and every caller has
    // the member's name to hand; the fallback keeps the CHECK on actorNameSnapshot satisfiable for
    // a caller that does not, rather than failing a void over a label.
    const ledgerOn = await stockLedgerEnabled(tx, tenantId);
    const restoredLines = await incrementStock(
      tx,
      tenantId,
      sale.items,
      ledgerOn
        ? {
            reason: "COUNTER_VOID",
            actor: { userId: input.voidedByUserId, name: input.voidedByName || "Store" },
            counterSaleId: sale.id,
          }
        : null,
    );
    // Recorded rather than inferred. A line whose variant was deleted cannot be restored, and a
    // variant deleted AFTER this void would make a later read of the same sale draw the opposite
    // conclusion — so the answer is written down at the moment it was true.
    await tx.counterSale.update({
      where: { id },
      data: { voidRestoredLines: restoredLines },
      select: { id: true },
    });
    return { restoredLines, totalLines: sale.items.length };
  });
}

function getCounterSaleBySubmission(tenantId: string, submissionId: string) {
  return withTenant(tenantId, (db) =>
    db.counterSale.findFirst({
      where: { tenantId, submissionId },
      select: {
        id: true,
        linesFingerprint: true,
        items: { select: { priceCentsSnapshot: true, quantity: true } },
      },
    }),
  );
}

/**
 * How many sales a store has recorded, for the platform console's switch page.
 *
 * Scoped with withTenant rather than withBypass: the platform admin is asking about ONE store, so
 * the narrower tool is the right one — nothing here needs to see across tenants.
 */
export function countCounterSales(tenantId: string) {
  return withTenant(tenantId, (db) => db.counterSale.count({ where: { tenantId } }));
}

export function getCounterSale(tenantId: string, id: string) {
  return withTenant(tenantId, (db) =>
    db.counterSale.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        payment: true,
        soldByNameSnapshot: true,
        notes: true,
        createdAt: true,
        voidedAt: true,
        voidReason: true,
        voidRestoredLines: true,
        items: { select: itemSelect, orderBy: { id: "asc" } },
      },
    }),
  );
}

/**
 * One page of the till's history.
 *
 * Mirrors listOrdersPage: the same page-size normalisation, the same clamping, and the same
 * deliberate choice to select only what the table shows — plus the two money columns, which is
 * exactly `counterSaleTotal`'s input shape, so a row total needs no second query.
 */
export function listCounterSalesPage(
  tenantId: string,
  requestedPage: number,
  status?: "RECORDED" | "VOIDED",
  requestedPageSize = 25,
) {
  const pageSize = normalizeAdminPageSize(requestedPageSize);
  const where = { tenantId, ...(status ? { status } : {}) };
  return withTenant(tenantId, async (db) => {
    const [total, counts] = await Promise.all([
      db.counterSale.count({ where }),
      db.counterSale.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    ]);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.counterSale.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        payment: true,
        soldByNameSnapshot: true,
        createdAt: true,
        items: {
          select: { priceCentsSnapshot: true, quantity: true, manualDiscountCentsSnapshot: true },
        },
      },
    });
    return { items, total, page, pages, pageSize, counts };
  });
}

export type CounterTakings = {
  saleCount: number;
  totalCents: number;
  cashSales: number;
  cashCents: number;
  cardSales: number;
  cardCents: number;
  manualDiscountCents: number;
  voidedSales: number;
};

/**
 * What the till took over a window, in one query.
 *
 * Raw SQL with FILTER clauses rather than several Prisma calls, for the reason getDashboard's own
 * raw sum exists: the alternative is loading every sale and its lines into memory to add them up.
 * It also matters that this is ONE statement — getDashboard's queries run inside an interactive
 * transaction, where they share a single connection and therefore do not overlap, so each extra
 * statement costs its full latency.
 */
export function getCounterTakings(
  tenantId: string,
  range: { from: Date; to: Date },
): Promise<CounterTakings> {
  return withTenant(tenantId, async (db) => {
    const [row] = await db.$queryRaw<
      {
        sale_count: number;
        total_cents: number;
        cash_sales: number;
        cash_cents: number;
        card_sales: number;
        card_cents: number;
        manual_discount_cents: number;
        voided_sales: number;
      }[]
    >`
      WITH per_sale AS (
        SELECT s.id,
               s.payment,
               s.status,
               SUM(i."priceCentsSnapshot" * i.quantity)::int AS total,
               SUM(i."manualDiscountCentsSnapshot" * i.quantity)::int AS manual
        FROM "CounterSale" s
        JOIN "CounterSaleItem" i ON i."counterSaleId" = s.id AND i."tenantId" = s."tenantId"
        WHERE s."tenantId" = ${tenantId}
          AND s."createdAt" >= ${range.from}
          AND s."createdAt" < ${range.to}
        GROUP BY s.id, s.payment, s.status
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'RECORDED')::int AS sale_count,
        COALESCE(SUM(total) FILTER (WHERE status = 'RECORDED'), 0)::int AS total_cents,
        COUNT(*) FILTER (WHERE status = 'RECORDED' AND payment = 'CASH')::int AS cash_sales,
        COALESCE(SUM(total) FILTER (WHERE status = 'RECORDED' AND payment = 'CASH'), 0)::int AS cash_cents,
        COUNT(*) FILTER (WHERE status = 'RECORDED' AND payment = 'CARD')::int AS card_sales,
        COALESCE(SUM(total) FILTER (WHERE status = 'RECORDED' AND payment = 'CARD'), 0)::int AS card_cents,
        COALESCE(SUM(manual) FILTER (WHERE status = 'RECORDED'), 0)::int AS manual_discount_cents,
        COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS voided_sales
      FROM per_sale`;
    return {
      saleCount: row?.sale_count ?? 0,
      totalCents: row?.total_cents ?? 0,
      cashSales: row?.cash_sales ?? 0,
      cashCents: row?.cash_cents ?? 0,
      cardSales: row?.card_sales ?? 0,
      cardCents: row?.card_cents ?? 0,
      manualDiscountCents: row?.manual_discount_cents ?? 0,
      voidedSales: row?.voided_sales ?? 0,
    };
  });
}

export type TillItem = {
  variantId: string;
  productName: string;
  variantLabel: string;
  stock: number;
  regularPriceCents: number;
  finalPriceCents: number;
  discountName: string | null;
};

/**
 * The till's product search: a short, bounded, flat list of sellable variants.
 *
 * Deliberately not listProductsPage, which offset-paginates and also fetches the category and the
 * full pricing graph for a 25-row admin table. This is one query, capped, selecting only what a
 * search result row shows — and it prices through `calculatePrice`, the same function the write
 * path uses, so what the cashier sees cannot drift from what is charged.
 *
 * `Product.name` has no text index (there is no pg_trgm anywhere in this schema), so an unanchored
 * ILIKE scans that store's products. That is measured rather than assumed: see verify:counter's
 * performance checks, which also carry the threshold at which a trigram index becomes worth its
 * extension.
 */
export async function searchTillItems(
  tenantId: string,
  search: string,
  limit = 20,
): Promise<TillItem[]> {
  const q = search.trim().slice(0, 100);
  const pricedAt = new Date();
  const products = await withTenant(tenantId, (db) =>
    db.product.findMany({
      where: { tenantId, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
      orderBy: { name: "asc" },
      take: limit,
      select: {
        name: true,
        basePriceCents: true,
        variants: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, attributes: true, stock: true, priceCentsOverride: true },
        },
        discounts: { select: { discount: true } },
      },
    }),
  );

  const items: TillItem[] = [];
  for (const product of products) {
    const discounts = product.discounts.map((assignment) => assignment.discount);
    for (const variant of product.variants) {
      const price = calculatePrice(
        product.basePriceCents,
        variant.priceCentsOverride,
        discounts,
        pricedAt,
      );
      items.push({
        variantId: variant.id,
        productName: product.name,
        variantLabel: variantLabel(parseAttributes(variant.attributes), ""),
        stock: variant.stock,
        regularPriceCents: price.regularPriceCents,
        finalPriceCents: price.finalPriceCents,
        discountName: price.appliedDiscount?.name ?? null,
      });
    }
  }
  return items;
}
