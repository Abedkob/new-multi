/**
 * The one place stock moves.
 *
 * Two writers need to take stock off the shelf — the storefront checkout and the in-store till —
 * and two need to put it back — cancelling an order and voiding a counter sale. Each of those is
 * a conditional UPDATE whose `WHERE stock >= qty` guard is the entire reason the system cannot
 * oversell. A second hand-written copy of that guard is the thing worth preventing, so it lives
 * here once and `pnpm verify:counter` fails if a `stock: { decrement }` appears anywhere else.
 *
 * Deliberately knows nothing about orders or counter sales: it throws `StockShortError`, and each
 * caller translates that into its own error vocabulary. Neither writer inherits the other's.
 */

import type { TxClient } from "@/lib/prisma";

/** Raised when a conditional decrement matched no row, with what is actually left. */
export class StockShortError extends Error {
  constructor(
    message: string,
    readonly variantId: string,
    readonly available: number,
  ) {
    super(message);
    this.name = "StockShortError";
  }
}

/**
 * Takes `wanted` off the shelf, or throws having changed nothing the caller's transaction will
 * keep.
 *
 * Ids are sorted HERE rather than by the caller. Two concurrent transactions touching the same
 * two variants in opposite orders deadlock, and "sort the ids first" is not an invariant a second
 * caller should be able to forget — so it travels with the primitive.
 *
 * `label` builds the human sentence, because the wording differs by surface: a shopper is told
 * something "just sold out", while someone at a till is told how many are on the shelf. The
 * callback is given the live figure so the message can be specific.
 *
 * Must run inside a transaction. A failure throws, which rolls back any decrement already made in
 * this loop — the all-or-nothing behaviour both callers rely on.
 */
export async function decrementStockOrThrow(
  tx: TxClient,
  tenantId: string,
  wanted: Map<string, number>,
  label: (variantId: string, available: number) => string,
): Promise<void> {
  for (const id of [...wanted.keys()].sort()) {
    const qty = wanted.get(id)!;
    const { count } = await tx.productVariant.updateMany({
      where: { id, stock: { gte: qty }, product: { tenantId } },
      data: { stock: { decrement: qty } },
    });
    if (count === 1) continue;

    // Re-read to say how many are actually left. This is the part a second implementation gets
    // wrong: without it the caller can only say "not enough", which is useless at a counter.
    const fresh = await tx.productVariant.findUnique({ where: { id }, select: { stock: true } });
    const available = fresh?.stock ?? 0;
    throw new StockShortError(label(id, available), id, available);
  }
}

/**
 * Puts stock back, and reports how many lines it could.
 *
 * The count is the point. A line whose variant has since been deleted has `variantId: null` and
 * cannot be restored — and a caller that assumed every line was restored would tell a merchant
 * their stock was corrected when it was not. `updateProduct` hard-deletes variants the owner
 * removes from the form, so this is a real case rather than a theoretical one.
 *
 * Must run inside a transaction.
 */
export async function incrementStock(
  tx: TxClient,
  tenantId: string,
  items: { variantId: string | null; quantity: number }[],
): Promise<number> {
  let restored = 0;
  for (const item of items) {
    if (!item.variantId) continue;
    const { count } = await tx.productVariant.updateMany({
      where: { id: item.variantId, product: { tenantId } },
      data: { stock: { increment: item.quantity } },
    });
    restored += count;
  }
  return restored;
}
