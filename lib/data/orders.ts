import { env } from "@/lib/env";
import { withTenant } from "@/lib/prisma";
import { canTransition, type OrderStatusValue } from "@/lib/orders";
import { effectivePrice, parseAttributes, variantLabel } from "@/lib/variants";
import { isLicenseActive } from "@/lib/license/status";

/**
 * Orders. Every function takes a tenantId (from the storefront's slug lookup when a customer
 * orders, from the session on the admin side) and puts it in the WHERE clause. Variant ids in
 * a cart are client-supplied, so they are only ever resolved through a product of THIS store.
 */

export type OrderErrorCode =
  | "EMPTY"
  | "INVALID"
  | "UNAVAILABLE"
  | "STOCK"
  | "NOT_FOUND"
  | "BAD_TRANSITION"
  | "CHANGED"
  | "PAUSED";

/** A problem the customer/owner can act on; the message is safe to show. */
export class OrderError extends Error {
  constructor(
    public code: OrderErrorCode,
    message: string,
    /** For STOCK: the variant that ran short and how many are left. */
    public detail?: { variantId: string; available: number },
  ) {
    super(message);
  }
}

export type CustomerInput = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  deliveryLocation: string;
  notes: string;
};

export type OrderLineInput = { variantId: string; quantity: number };

const MAX_LINES = 50;
const MAX_QTY = 99;

/**
 * Creates the order and its items and deducts stock, all in one transaction.
 *
 * Stock is taken with a conditional UPDATE (`stock >= qty`), never read-then-write, so two
 * customers racing for the last unit cannot both get it: the second UPDATE matches no row and
 * the whole transaction (including any earlier deductions) rolls back with a clear error.
 */
export async function placeOrder(
  tenantId: string,
  customer: CustomerInput,
  lines: OrderLineInput[],
) {
  // Merge duplicate variant ids and sanity-check quantities.
  const wanted = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY) {
      throw new OrderError("INVALID", "Invalid quantity in your cart.");
    }
    wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0) + l.quantity);
  }
  if (wanted.size === 0) throw new OrderError("EMPTY", "Your cart is empty.");
  if (wanted.size > MAX_LINES) throw new OrderError("INVALID", "Too many different items in one order.");
  for (const q of wanted.values()) {
    if (q > MAX_QTY) throw new OrderError("INVALID", "Invalid quantity in your cart.");
  }

  // Deterministic order so concurrent orders touching the same variants can't deadlock.
  const ids = [...wanted.keys()].sort();

  return withTenant(tenantId, async (tx) => {
    // Lock the tenant row through this transaction. A concurrent pause waits until this order
    // commits (or vice versa), so no order slips in after a pause has already taken effect.
    const tenantRows = await tx.$queryRaw<{ isPaused: boolean }[]>`
      SELECT "isPaused" FROM "Tenant" WHERE id = ${tenantId} FOR SHARE`;
    const licenseRows = await tx.$queryRaw<{
      status: string;
      expiresAt: Date | null;
      offlineGraceUntil: Date | null;
    }[]>`
      SELECT status, "expiresAt", "offlineGraceUntil"
      FROM "TenantLicense" WHERE "tenantId" = ${tenantId} FOR SHARE`;
    if (
      !tenantRows[0] ||
      tenantRows[0].isPaused ||
      !isLicenseActive(licenseRows[0])
    ) {
      throw new OrderError("PAUSED", "This store is temporarily unavailable and cannot accept orders.");
    }

    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids }, product: { tenantId } },
      include: { product: true },
    });
    // Covers deleted variants and ids that belong to another store.
    if (variants.length !== ids.length) {
      throw new OrderError("UNAVAILABLE", "Some items in your cart are no longer available.");
    }
    const byId = new Map(variants.map((v) => [v.id, v]));

    for (const id of ids) {
      const qty = wanted.get(id)!;
      const { count } = await tx.productVariant.updateMany({
        where: { id, stock: { gte: qty }, product: { tenantId } },
        data: { stock: { decrement: qty } },
      });
      if (count !== 1) {
        const v = byId.get(id)!;
        const fresh = await tx.productVariant.findUnique({ where: { id }, select: { stock: true } });
        const available = fresh?.stock ?? 0;
        const label = variantLabel(parseAttributes(v.attributes), "");
        throw new OrderError(
          "STOCK",
          available > 0
            ? `Only ${available} left of "${v.product.name}${label ? ` (${label})` : ""}". Please lower the quantity.`
            : `"${v.product.name}${label ? ` (${label})` : ""}" just sold out.`,
          { variantId: id, available },
        );
      }
    }

    return tx.order.create({
      data: {
        tenantId,
        customerName: customer.customerName,
        customerPhone: customer.customerPhone,
        customerAddress: customer.customerAddress,
        deliveryLocation: customer.deliveryLocation,
        notes: customer.notes,
        items: {
          create: ids.map((id) => {
            const v = byId.get(id)!;
            return {
              variantId: id,
              productNameSnapshot: v.product.name,
              variantAttributesSnapshot: parseAttributes(v.attributes),
              // Priced here on the server, never from anything the client sent.
              priceCentsSnapshot: effectivePrice(v.product.basePriceCents, v.priceCentsOverride),
              quantity: wanted.get(id)!,
            };
          }),
        },
      },
      include: { items: true },
    });
  });
}

export function listOrders(tenantId: string) {
  return withTenant(tenantId, (db) =>
    db.order.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { items: { select: { priceCentsSnapshot: true, quantity: true } } },
    }),
  );
}

const ORDERS_PAGE_SIZE = 25;

/** The owner's orders list, one page at a time, newest first, optionally one status only;
 * `counts` has every status's total for the tabs. */
export function listOrdersPage(tenantId: string, requestedPage: number, status?: OrderStatusValue) {
  const where = { tenantId, ...(status ? { status } : {}) };
  return withTenant(tenantId, async (db) => {
    const [total, byStatus] = await Promise.all([
      db.order.count({ where }),
      db.order.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Partial<
      Record<OrderStatusValue, number>
    >;
    const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ORDERS_PAGE_SIZE,
      take: ORDERS_PAGE_SIZE,
      include: { items: { select: { priceCentsSnapshot: true, quantity: true } } },
    });
    return { items, total, page, pages, counts };
  });
}

export function getOrder(tenantId: string, id: string) {
  return withTenant(tenantId, (db) =>
    db.order.findFirst({
      where: { id, tenantId },
      include: { items: { orderBy: { id: "asc" } } },
    }),
  );
}

export function countOrdersByStatus(tenantId: string, status: OrderStatusValue) {
  return withTenant(tenantId, (db) => db.order.count({ where: { tenantId, status } }));
}

/**
 * Moves an order along Pending -> Confirmed -> Delivered, or to Cancelled. Cancelling gives
 * the stock back to the variants, exactly once: the status write is guarded on the status we
 * read, so a double click (or two admin tabs) can't restore the same stock twice.
 */
export async function updateOrderStatus(tenantId: string, id: string, next: OrderStatusValue) {
  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!order) throw new OrderError("NOT_FOUND", "Order not found.");
    if (!canTransition(order.status, next)) {
      throw new OrderError(
        "BAD_TRANSITION",
        `An order that is ${order.status.toLowerCase()} can't be changed to ${next.toLowerCase()}.`,
      );
    }

    const { count } = await tx.order.updateMany({
      where: { id, tenantId, status: order.status },
      data: { status: next },
    });
    if (count !== 1) {
      throw new OrderError("CHANGED", "This order was just changed elsewhere. Refresh and try again.");
    }

    if (next === "CANCELLED") {
      for (const item of order.items) {
        // variantId is null when the variant was deleted after the order: nothing to restore.
        if (!item.variantId) continue;
        await tx.productVariant.updateMany({
          where: { id: item.variantId, product: { tenantId } },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
    return next;
  });
}

export type ExpireResult = {
  scanned: number;
  cancelled: number;
  skipped: { id: string; reason: string }[];
};

/**
 * Cancels this store's PENDING orders placed before `olderThan`, which restores their stock.
 * Pending orders hold stock the moment they are placed and never expire on their own, so
 * abandoned or fake orders would otherwise tie up inventory forever. Run lazily when the owner
 * opens their Orders page (no scheduler): they get accurate state and stale stock is released.
 *
 * Each candidate is cancelled through the normal `updateOrderStatus` path, so stock restoration
 * and the status guard are identical to a manual cancel. An order the owner just confirmed or
 * cancelled fails that guard and is skipped, never double-processed. Idempotent.
 *
 * `Date.now()` is read in here rather than by the caller (a Server Component render) so the
 * page stays a pure function of its props/session — this is the one place "now" matters.
 */
export async function expireStalePendingOrders(tenantId: string): Promise<ExpireResult> {
  const olderThan = new Date(Date.now() - env.ORDER_PENDING_TTL_HOURS * 3_600_000);
  const stale = await withTenant(tenantId, (db) =>
    db.order.findMany({
      where: { tenantId, status: "PENDING", createdAt: { lt: olderThan } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
  );

  let cancelled = 0;
  const skipped: { id: string; reason: string }[] = [];
  for (const o of stale) {
    try {
      await updateOrderStatus(tenantId, o.id, "CANCELLED");
      cancelled++;
    } catch (e) {
      // Most likely the owner just confirmed/cancelled it (BAD_TRANSITION / CHANGED / NOT_FOUND).
      skipped.push({ id: o.id, reason: e instanceof OrderError ? e.code : "ERROR" });
    }
  }
  return { scanned: stale.length, cancelled, skipped };
}
