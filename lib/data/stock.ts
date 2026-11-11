/**
 * The one place stock moves, and the one place its history is written.
 *
 * Two writers need to take stock off the shelf — the storefront checkout and the in-store till —
 * and two need to put it back — cancelling an order and voiding a counter sale. Each of those is
 * a conditional UPDATE whose `WHERE stock >= qty` guard is the entire reason the system cannot
 * oversell. A second hand-written copy of that guard is the thing worth preventing, so it lives
 * here once and `pnpm verify:counter` fails if a `stock: { decrement }` appears anywhere else.
 *
 * The movement ledger lives here for the same reason, and it is not a coincidence: a file that is
 * already the only one allowed to change the number is the only honest place to record that it
 * changed. A sixth writer added later cannot get a movement row by accident — and cannot move
 * stock without one either, because the grep rule stops the obvious shape of it and
 * `lib/stock/invariant.ts` catches the rest.
 *
 * Deliberately knows nothing about orders or counter sales: it throws `StockShortError`, and each
 * caller translates that into its own error vocabulary. Neither writer inherits the other's.
 *
 * **With no `ledger` argument, every function here behaves exactly as it did before this phase** —
 * same statements, same count, same return values. That is what makes the module's switch free for
 * a store that does not want it.
 */

import type { StockMovementReasonValue } from "@/lib/stock";
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

/** Who moved it. `userId` is null for the system, in which case `name` names the channel. */
export type StockActor = { userId: string | null; name: string };

/**
 * What to record about a movement, or nothing at all.
 *
 * A caller passes `null`/`undefined` when the store's module is off, which is the ledger's only
 * gate: not `canMoveStock`, because a paused store's stock can still legitimately move (a
 * cancellation restores it, the owner can still correct a figure) and those movements are exactly
 * what the ledger exists to record.
 */
export type StockLedger = {
  reason: StockMovementReasonValue;
  actor: StockActor;
  /** One instant for the whole batch, so a receipt's lines sort together. Defaults to now. */
  at?: Date;
  /** The document these lines belong to, when a person submitted one. */
  batchId?: string | null;
  /** What caused it. References, not foreign keys — see the migration. */
  orderId?: string | null;
  counterSaleId?: string | null;
  note?: string;
  /** Captured at receipt, the only moment anyone knows it. Owner-only on every screen. */
  unitCostCents?: number | null;
};

/**
 * One line of a movement write.
 *
 * `balanceAfter` is omitted in the normal case, where the UPDATE has already happened and the
 * variant's current stock *is* the balance after. It is passed only by `VARIANT_REMOVED`, which
 * runs before the row is deleted and so cannot read its own result: there the balance after is 0
 * and the delta is the whole of what was on the shelf.
 */
export type StockMovementLine = {
  variantId: string;
  delta: number;
  balanceAfter?: number;
  /**
   * What one unit of THIS line cost, overriding the ledger's.
   *
   * A delivery of three lines is one document at one moment with three different prices, so the
   * cost cannot live only on the ledger — and splitting the write into one call per price would
   * turn a 50-line receipt into 200 statements to carry a column nothing computes with.
   */
  unitCostCents?: number | null;
};

/** Whether the ledger is on for this store. Tenant is not under RLS, so this is a plain read. */
export async function stockLedgerEnabled(tx: TxClient, tenantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ stockEnabled: boolean }[]>`
    SELECT "stockEnabled" FROM "Tenant" WHERE id = ${tenantId}`;
  return rows[0]?.stockEnabled === true;
}

/**
 * Writes one movement per line, with an `OPENING` ahead of any line whose history does not already
 * reconcile.
 *
 * **Precondition: every variant named here has just been UPDATEd (or is about to be deleted) in
 * this same transaction.** That is what holds its row lock, which is what makes `MAX(variantSeq) + 1`
 * safe without a sequence (D86): a concurrent writer to the same variant blocks until this
 * transaction commits. A zero-delta line still goes through an UPDATE for exactly this reason —
 * see `setStockTo`. If the precondition is ever broken, the `(variantId, variantSeq)` unique index
 * turns the race into an error rather than a ledger with two rows claiming one position.
 *
 * Three statements, regardless of how many lines: the snapshots, each variant's newest movement
 * (one `DISTINCT ON`, not a mark query and then a balance query — see below), and one
 * `createMany`. A fifty-line receipt is three statements, not two hundred.
 *
 * **Why this is public rather than folded into the decrement.** A movement must name the order or
 * the counter sale that caused it, and that id does not exist until the row does — while the
 * decrement has to run first, so a stock shortfall aborts before anything else has been written.
 * Both are true at once, so those two callers write their movements after their `create`. It costs
 * nothing: the row locks the decrement took are held for the whole transaction, so the order of the
 * two halves is free. The callers that already know their reference (a cancellation, a void, an
 * adjustment) pass a `ledger` to the function that moves the stock and never touch this.
 */
export async function recordStockMovements(
  tx: TxClient,
  tenantId: string,
  ledger: StockLedger,
  lines: readonly StockMovementLine[],
): Promise<void> {
  if (lines.length === 0) return;
  const at = ledger.at ?? new Date();
  const ids = [...new Set(lines.map((line) => line.variantId))].sort();

  // Scoped through the product, because ProductVariant has no tenantId of its own. A variant that
  // is not this store's simply does not come back, and its line is skipped — the same way every
  // other function here treats a foreign id.
  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids }, product: { tenantId } },
    select: { id: true, stock: true, attributes: true, product: { select: { name: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  // Each variant's newest movement: the high-water mark for the counter, and the balance it left.
  //
  // `DISTINCT ON` because this is on the checkout path. It was a `groupBy` for the mark and then a
  // `findMany` for the balance at that mark, which is two round trips for one question — and
  // `pnpm measure:stock` put the whole ledger write at 5.4ms on a 9ms order, where every round
  // trip is over a millisecond of it. One statement, served by the `(variantId, variantSeq)`
  // unique index, and bounded by the number of variants rather than by one variant's history (a
  // plain `findMany` of every movement would be unbounded — a shelf with ten thousand rows).
  const latest = await tx.$queryRaw<
    { variantId: string; variantSeq: number; balanceAfter: number }[]
  >`
    SELECT DISTINCT ON ("variantId") "variantId", "variantSeq", "balanceAfter"
    FROM "StockMovement"
    WHERE "tenantId" = ${tenantId} AND "variantId" = ANY(${ids})
    ORDER BY "variantId", "variantSeq" DESC`;
  const nextSeq = new Map<string, number>();
  const lastBalance = new Map<string, number>();
  for (const row of latest) {
    nextSeq.set(row.variantId, row.variantSeq + 1);
    lastBalance.set(row.variantId, row.balanceAfter);
  }

  const rows: {
    tenantId: string;
    variantId: string;
    variantSeq: number;
    productNameSnapshot: string;
    variantAttributesSnapshot: object;
    delta: number;
    balanceAfter: number;
    reason: StockMovementReasonValue;
    batchId: string | null;
    orderId: string | null;
    counterSaleId: string | null;
    unitCostCents: number | null;
    note: string;
    actorUserId: string | null;
    actorNameSnapshot: string;
    createdAt: Date;
  }[] = [];

  for (const line of lines) {
    const variant = byId.get(line.variantId);
    if (!variant) continue;
    const balanceAfter = line.balanceAfter ?? variant.stock;
    const balanceBefore = balanceAfter - line.delta;
    const snapshot = {
      tenantId,
      variantId: variant.id,
      productNameSnapshot: variant.product.name,
      variantAttributesSnapshot: (variant.attributes ?? {}) as object,
      actorUserId: ledger.actor.userId,
      actorNameSnapshot: ledger.actor.name,
      createdAt: at,
    };
    let seq = nextSeq.get(line.variantId) ?? 1;

    // The balance this ledger found and cannot explain. Needed on a variant's very first movement,
    // and again after any period the module was off — during which the product form, an order or a
    // till sale could still have moved stock. Carries the ledger's actor (the CHECK requires a
    // name) but none of the document's references: an OPENING belongs to the ledger, not to the
    // receipt that happened to trigger it.
    if (lastBalance.get(line.variantId) !== balanceBefore) {
      rows.push({
        ...snapshot,
        variantSeq: seq,
        delta: 0,
        balanceAfter: balanceBefore,
        reason: "OPENING",
        batchId: null,
        orderId: null,
        counterSaleId: null,
        unitCostCents: null,
        note: "",
      });
      seq += 1;
    }

    // An explicit `OPENING` *is* the row above. A variant that arrives on the shelf already
    // holding stock has an opening balance and no movement — emitting a second row would state
    // the same fact twice and give one event two positions in the variant's history. If the
    // balance already reconciled there is nothing to say at all, which is also correct.
    if (ledger.reason === "OPENING") {
      nextSeq.set(line.variantId, seq);
      lastBalance.set(line.variantId, balanceAfter);
      continue;
    }

    rows.push({
      ...snapshot,
      variantSeq: seq,
      delta: line.delta,
      balanceAfter,
      reason: ledger.reason,
      batchId: ledger.batchId ?? null,
      orderId: ledger.orderId ?? null,
      counterSaleId: ledger.counterSaleId ?? null,
      // The line's own cost wins, then the document's, then nothing.
      unitCostCents: line.unitCostCents ?? ledger.unitCostCents ?? null,
      note: ledger.note ?? "",
    });
    nextSeq.set(line.variantId, seq + 1);
    // Both maps advance per line, not per call. Two lines naming the same variant is not how any
    // caller here builds its lines — each dedupes first — but a receipt that listed one variant
    // twice would otherwise get a spurious OPENING between them, which would read as a gap in the
    // history that never happened.
    lastBalance.set(line.variantId, balanceAfter);
  }

  if (rows.length === 0) return;
  // No skipDuplicates: a collision on (variantId, variantSeq) means the row lock assumption above
  // was wrong, and that must surface as an error rather than as a quietly missing history row.
  await tx.stockMovement.createMany({ data: rows });
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
 *
 * Takes no `ledger`, deliberately: both of its callers are writing an order or a sale whose id the
 * movement has to name, and that id does not exist yet. They call `recordStockMovements` after the
 * `create`, with the same lines — see that function for why the split costs nothing.
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

/** The movement lines for a decrement that just succeeded, for the caller's ledger write. */
export function soldLines(wanted: Map<string, number>): StockMovementLine[] {
  return [...wanted.entries()].map(([variantId, qty]) => ({ variantId, delta: -qty }));
}

/**
 * Puts stock back, and reports how many lines it could.
 *
 * The count is the point. A line whose variant has since been deleted has `variantId: null` and
 * cannot be restored — and a caller that assumed every line was restored would tell a merchant
 * their stock was corrected when it was not. `updateProduct` hard-deletes variants the owner
 * removes from the form, so this is a real case rather than a theoretical one.
 *
 * `unitCostCents` on an item is for receiving, where each line of one delivery has its own price.
 * A restore (a cancellation, a void) leaves it out: nobody knows what the returned unit cost, and
 * inventing a figure there would be worse than having none.
 *
 * Must run inside a transaction.
 */
export async function incrementStock(
  tx: TxClient,
  tenantId: string,
  items: { variantId: string | null; quantity: number; unitCostCents?: number | null }[],
  ledger?: StockLedger | null,
): Promise<number> {
  let restored = 0;
  const moved = new Map<string, { quantity: number; unitCostCents: number | null }>();
  for (const item of items) {
    if (!item.variantId) continue;
    const { count } = await tx.productVariant.updateMany({
      where: { id: item.variantId, product: { tenantId } },
      data: { stock: { increment: item.quantity } },
    });
    restored += count;
    // Only what actually moved, and summed: two lines of the same variant are one movement, which
    // is also what keeps the per-variant counter from needing two positions for one event. The
    // first cost given for a variant stands, since the quantities are being merged into one line
    // and a second price would have nothing to attach to.
    if (count === 1) {
      const seen = moved.get(item.variantId);
      moved.set(item.variantId, {
        quantity: (seen?.quantity ?? 0) + item.quantity,
        unitCostCents: seen?.unitCostCents ?? item.unitCostCents ?? null,
      });
    }
  }
  if (ledger && moved.size > 0) {
    await recordStockMovements(
      tx,
      tenantId,
      ledger,
      [...moved.entries()].map(([variantId, m]) => ({
        variantId,
        delta: m.quantity,
        unitCostCents: m.unitCostCents,
      })),
    );
  }
  return restored;
}

export type SetStockOutcome =
  | { ok: true; from: number; to: number }
  /** No such variant in this store. */
  | { ok: false; reason: "NOT_FOUND" }
  /** Somebody changed it between the figure the caller was shown and this write. */
  | { ok: false; reason: "CHANGED"; current: number };

/**
 * Sets one variant's stock to an absolute figure, refusing if it moved underneath the caller.
 *
 * A compare-and-swap, not an assignment, and that is a bug fix riding along (D89). Before this,
 * two staff counting the same shelf clobbered each other silently: whoever saved last won, and
 * neither was told. Now the loser is told the live figure and can decide, which is the only honest
 * answer — the server cannot know which of two counts is right.
 *
 * **`expect` is what makes it a compare-and-swap, and it has to come from the caller.** It is the
 * figure the person was shown when they decided to type a new one. Reading the current value here
 * and swapping against *that* would be no protection at all: the two transactions serialise on the
 * row lock and both succeed, with the second silently overwriting the first — the exact bug this
 * exists to fix, reintroduced one layer down where it is harder to see. A caller that genuinely
 * has no earlier figure (a receipt computing a delta from the live stock inside this transaction)
 * omits it and gets a plain set.
 *
 * `updateMany` matching zero rows is the whole mechanism; the read that follows distinguishes
 * "gone" from "changed" so the refusal can state the live number.
 *
 * A no-op (target already equals current) still issues the UPDATE. It matches, it takes the
 * variant's row lock, and that lock is what `recordStockMovements` relies on — so a stocktake line
 * that agrees with the shelf can still write its zero-delta `COUNT` row safely.
 *
 * Must run inside a transaction.
 */
export async function setStockTo(
  tx: TxClient,
  tenantId: string,
  variantId: string,
  target: number,
  opts: { expect?: number; ledger?: StockLedger | null } = {},
): Promise<SetStockOutcome> {
  const before = await tx.productVariant.findFirst({
    where: { id: variantId, product: { tenantId } },
    select: { stock: true },
  });
  if (!before) return { ok: false, reason: "NOT_FOUND" };
  const expect = opts.expect ?? before.stock;

  const { count } = await tx.productVariant.updateMany({
    where: { id: variantId, product: { tenantId }, stock: expect },
    data: { stock: target },
  });
  if (count !== 1) {
    const fresh = await tx.productVariant.findFirst({
      where: { id: variantId, product: { tenantId } },
      select: { stock: true },
    });
    if (!fresh) return { ok: false, reason: "NOT_FOUND" };
    return { ok: false, reason: "CHANGED", current: fresh.stock };
  }

  if (opts.ledger) {
    await recordStockMovements(tx, tenantId, opts.ledger, [
      { variantId, delta: target - expect },
    ]);
  }
  return { ok: true, from: expect, to: target };
}

export type StockSetApplied = {
  variantId: string;
  /** What was on the shelf when this transaction locked the row. */
  from: number;
  to: number;
  delta: number;
};

/**
 * Sets many variants' stock to absolute figures in one pass, for a stocktake (D94).
 *
 * **A count is authoritative, so there is no `expect` here.** Somebody has walked the shelf and
 * counted; a figure that went stale while they walked must not refuse their count — it is the
 * screen's number that is wrong, not theirs. What the server owes them instead is the truth about
 * what it found, which is why every line comes back with the `from` it actually replaced. The
 * screen reports the variance it applied, and says so when that differs from the one it showed.
 *
 * **The rows are locked before they are read**, with one `SELECT … FOR UPDATE` ordered by id. Not
 * for the balance — `recordStockMovements` would reconcile that anyway — but for the *delta*: a
 * sale landing between an unlocked read of 10 and a write of 8 would record "counted, −2" for a
 * shelf that went 10 → 9 → 8, so the variance would name a discrepancy that never existed. The
 * ordering is what stops two concurrent counts of overlapping shelves deadlocking.
 *
 * A line whose counted figure equals what is there still issues its UPDATE. It matches, it holds
 * the lock `recordStockMovements` needs, and it earns its zero-delta `COUNT` row — which is the
 * only evidence that anybody looked (D94).
 *
 * Must run inside a transaction.
 */
export async function setStockToMany(
  tx: TxClient,
  tenantId: string,
  targets: readonly { variantId: string; to: number }[],
  ledger?: StockLedger | null,
): Promise<StockSetApplied[]> {
  if (targets.length === 0) return [];
  const wanted = new Map<string, number>();
  // The last figure given for a variant wins: a form that somehow listed one shelf twice is one
  // count of it, and summing two absolute figures would be meaningless.
  for (const target of targets) wanted.set(target.variantId, target.to);
  const ids = [...wanted.keys()].sort();

  const locked = await tx.$queryRaw<{ id: string; stock: number }[]>`
    SELECT v."id", v."stock" FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    WHERE v."id" = ANY(${ids}) AND p."tenantId" = ${tenantId}
    ORDER BY v."id"
    FOR UPDATE OF v`;

  const applied: StockSetApplied[] = [];
  for (const row of locked) {
    const to = wanted.get(row.id)!;
    const { count } = await tx.productVariant.updateMany({
      where: { id: row.id, product: { tenantId } },
      data: { stock: to },
    });
    // The row is locked by this transaction, so a miss here is not a race — it is a variant that
    // left the store between the lock and now, which cannot happen. Skipped rather than thrown so
    // one impossible line cannot lose a whole shelf's count.
    if (count !== 1) continue;
    applied.push({ variantId: row.id, from: row.stock, to, delta: to - row.stock });
  }

  if (ledger && applied.length > 0) {
    await recordStockMovements(
      tx,
      tenantId,
      ledger,
      applied.map((row) => ({ variantId: row.variantId, delta: row.delta })),
    );
  }
  return applied;
}

/**
 * Records that a variant's stock ceased to exist, before the row does (D90).
 *
 * `updateProduct` hard-deletes variants the owner removed from the form, which destroys their
 * stock with no record — an owner who removes the wrong row today has no way to find out what was
 * on it. This is written first, so the movement survives the delete through
 * `variantId ON DELETE SET NULL` plus the name and attribute snapshots.
 *
 * `balanceAfter` is 0 and the delta is everything that was there: the shelf is not restocked, the
 * line is gone. Returns the variants it wrote for, so a caller can report what it recorded.
 */
export async function recordVariantRemoval(
  tx: TxClient,
  tenantId: string,
  variantIds: readonly string[],
  ledger: StockLedger,
): Promise<number> {
  if (variantIds.length === 0) return 0;
  // Take the row locks the delete is about to take, here, before the per-variant counter is read.
  // This is the one ledger write whose change to the variant happens *after* the movement, so the
  // lock that every other path gets for free has to be asked for — and it travels with the
  // primitive rather than with the caller, for the reason the id sort does. Ordered, so two
  // concurrent product saves removing overlapping variants cannot deadlock.
  await tx.$queryRaw`
    SELECT v."id" FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    WHERE v."id" = ANY(${[...variantIds].sort()}) AND p."tenantId" = ${tenantId}
    ORDER BY v."id"
    FOR UPDATE OF v`;
  const doomed = await tx.productVariant.findMany({
    where: { id: { in: [...variantIds] }, product: { tenantId } },
    select: { id: true, stock: true },
    orderBy: { id: "asc" },
  });
  const lines = doomed.map((v) => ({ variantId: v.id, delta: -v.stock, balanceAfter: 0 }));
  await recordStockMovements(tx, tenantId, { ...ledger, reason: "VARIANT_REMOVED" }, lines);
  return lines.length;
}

/**
 * Records stock that arrived with a brand-new variant (D90(ii)).
 *
 * Adding a variant with twenty already on hand is legitimate, so the product form keeps its stock
 * input for a *new* row. The figure is written by the `create` itself; this is what leaves a trace
 * of it, as one `OPENING` row — an opening balance, not a movement, because nothing moved: the
 * units came into existence on the shelf along with the line that holds them.
 *
 * Without this, an owner adding a variant with five hundred units through the product form would
 * leave no record at all, which is the silent write this phase exists to end.
 */
export async function recordVariantOpening(
  tx: TxClient,
  tenantId: string,
  variantIds: readonly string[],
  ledger: StockLedger,
): Promise<void> {
  if (variantIds.length === 0) return;
  const created = await tx.productVariant.findMany({
    where: { id: { in: [...variantIds] }, product: { tenantId } },
    select: { id: true },
  });
  await recordStockMovements(
    tx,
    tenantId,
    { ...ledger, reason: "OPENING" },
    created.map((v) => ({ variantId: v.id, delta: 0 })),
  );
}
