/**
 * The two documents a person submits: a delivery received, and a shelf counted.
 *
 * Both write through `lib/data/stock.ts` — the one file allowed to move stock — so neither can
 * acquire a stock write of its own, and every line they move leaves a movement naming the document
 * it came from.
 *
 * What is shared, and why it is one table (D93): the same lifecycle (created once, never edited,
 * listed newest-first, opened to read its lines), the same idempotency mechanism, the same actor
 * snapshot, and the same query shape. What differs is one number per line — a quantity received
 * against a quantity counted — and that is a difference in the caller, not in the table.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withTenant, type TxClient } from "@/lib/prisma";
import { isLicenseActive } from "@/lib/license/status";
import {
  incrementStock,
  setStockToMany,
  type StockActor,
  type StockSetApplied,
} from "@/lib/data/stock";
import {
  MAX_STOCK_LINES,
  MAX_STOCK_LINE_QUANTITY,
  countedCeiling,
  type StockBatchKindValue,
} from "@/lib/stock";
import { MAX_STOCK } from "@/lib/variants";

export type StockBatchErrorCode =
  /** No lines, or every line was zero.*/
  | "EMPTY"
  /** A malformed payload: not a variant id, not a whole number, out of range, too many lines. */
  | "INVALID"
  /** The store does not have the module switched on (or is paused, or unlicensed). */
  | "FEATURE_OFF"
  /** A line named a variant this store does not have (any more). */
  | "UNAVAILABLE"
  /** A received line would push a shelf past MAX_STOCK. */
  | "OVER_CAPACITY"
  /** The same submission id arrived again with different lines. */
  | "SUBMISSION_REUSED";

export class StockBatchError extends Error {
  constructor(
    readonly code: StockBatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StockBatchError";
  }
}

export type ReceiptLineInput = {
  variantId: string;
  /** How many arrived. Positive; a correction downwards is an adjustment or a count, not a receipt. */
  quantity: number;
  /** Owner only. The action drops whatever a non-owner posted (D92). */
  unitCostCents?: number | null;
};

export type CountLineInput = {
  variantId: string;
  /** What was actually on the shelf. An absolute figure, never a difference (D94). */
  counted: number;
};

/**
 * A hash of what was submitted, so a replayed id with different contents is refused rather than
 * silently answered with the first write. The till's mechanism, verbatim.
 *
 * Sorted, so the fingerprint of a document cannot depend on the order the lines were typed in —
 * which is also what makes a retry after an ambiguous network failure a retry rather than a new
 * document.
 */
export function stockBatchFingerprint(
  kind: StockBatchKindValue,
  lines: readonly { variantId: string; quantity: number; unitCostCents?: number | null }[],
): string {
  const parts = lines
    .map((l) => `${l.variantId}:${l.quantity}:${l.unitCostCents ?? ""}`)
    .sort();
  return createHash("sha256").update(`${kind}|${parts.join("|")}`).digest("hex");
}

function normalizeSubmissionId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 64) {
    throw new StockBatchError("INVALID", "Missing submission id.");
  }
  return id;
}

/**
 * The whole of the validation that needs no database, so a bad request costs nothing.
 *
 * Duplicate lines for one variant are merged the way the screen merges them, so what somebody sees
 * is what gets recorded — and so one variant can never need two positions in its own movement
 * counter for one document.
 */
function normalizeReceiptLines(lines: readonly ReceiptLineInput[]) {
  if (lines.length === 0) throw new StockBatchError("EMPTY", "Add at least one line.");
  if (lines.length > MAX_STOCK_LINES) {
    throw new StockBatchError("INVALID", "Too many lines in one delivery.");
  }
  const merged = new Map<string, { quantity: number; unitCostCents: number | null }>();
  for (const line of lines) {
    if (typeof line.variantId !== "string" || !line.variantId) {
      throw new StockBatchError("INVALID", "A line is missing its product option.");
    }
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_STOCK_LINE_QUANTITY
    ) {
      throw new StockBatchError("INVALID", "Invalid quantity.");
    }
    const cost = line.unitCostCents;
    if (cost !== undefined && cost !== null && (!Number.isInteger(cost) || cost < 0)) {
      throw new StockBatchError("INVALID", "Invalid unit cost.");
    }
    const seen = merged.get(line.variantId);
    merged.set(line.variantId, {
      quantity: (seen?.quantity ?? 0) + line.quantity,
      unitCostCents: seen?.unitCostCents ?? cost ?? null,
    });
  }
  return merged;
}

function normalizeCountLines(lines: readonly CountLineInput[]) {
  if (lines.length === 0) throw new StockBatchError("EMPTY", "Count at least one line.");
  if (lines.length > MAX_STOCK_LINES) {
    throw new StockBatchError("INVALID", "Too many lines in one stocktake.");
  }
  const merged = new Map<string, number>();
  for (const line of lines) {
    if (typeof line.variantId !== "string" || !line.variantId) {
      throw new StockBatchError("INVALID", "A line is missing its product option.");
    }
    // Shape only. The ceiling is checked against the live shelf inside the transaction
    // (`countedCeiling`), because a count of a shelf already above it must still be possible.
    if (!Number.isInteger(line.counted) || line.counted < 0) {
      throw new StockBatchError("INVALID", "Invalid counted figure.");
    }
    // Zero is a real count — an empty shelf — which is why the floor here is 0 and not 1.
    merged.set(line.variantId, line.counted);
  }
  return merged;
}

/**
 * Reads the shelves a document is about to touch, and refuses the WHOLE document if any line
 * cannot be applied.
 *
 * Partial application was the bug: `incrementStock` silently skips a line whose variant has gone,
 * and the receipt reported its own submitted line count regardless — so staging two lines, having
 * one product deleted underneath, and submitting said "2 lines received" over a document holding
 * one movement. Refusing everything is the honest answer: the person picked that option minutes
 * ago, it is gone, and a summary that quietly counted it is worse than a refusal they can act on.
 *
 * Returns the live stock per variant, which the capacity check below needs anyway.
 */
async function readShelves(
  tx: TxClient,
  tenantId: string,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const rows = await tx.productVariant.findMany({
    where: { id: { in: [...variantIds] }, product: { tenantId } },
    select: { id: true, stock: true },
  });
  const shelves = new Map(rows.map((row) => [row.id, row.stock]));
  if (shelves.size !== variantIds.length) {
    throw new StockBatchError(
      "UNAVAILABLE",
      "One of those options is no longer in this store. Remove it and submit again.",
    );
  }
  return shelves;
}

type Header = {
  submissionId: string;
  reference?: string;
  note?: string;
  actor: StockActor;
};

export type RecordedStockBatch<Applied> = {
  id: string;
  /** True when this submission had already been recorded and is being returned again. */
  idempotent: boolean;
  /** What actually moved. Empty on a replay: the first write already moved it. */
  applied: Applied[];
};

/**
 * Reads the store's gate columns under a lock, for the reason `recordCounterSale` does: a switch
 * flipped mid-submission either waits for this document or takes effect before it.
 *
 * The gate is enforced HERE and not only on the page, because a server action is its own HTTP
 * endpoint — somebody who kept the screen open after the module was switched off, or who posts
 * straight to the action, meets the same refusal.
 */
async function assertCanMove(tx: TxClient, tenantId: string) {
  const rows = await tx.$queryRaw<{ isPaused: boolean; stockEnabled: boolean }[]>`
    SELECT "isPaused", "stockEnabled" FROM "Tenant" WHERE id = ${tenantId} FOR SHARE`;
  const licenses = await tx.$queryRaw<
    { status: string; expiresAt: Date | null; offlineGraceUntil: Date | null }[]
  >`
    SELECT status, "expiresAt", "offlineGraceUntil"
    FROM "TenantLicense" WHERE "tenantId" = ${tenantId} FOR SHARE`;
  const tenant = rows[0];
  if (!tenant || !tenant.stockEnabled || tenant.isPaused || !isLicenseActive(licenses[0])) {
    throw new StockBatchError("FEATURE_OFF", "This store cannot record stock movements.");
  }
}

/** The batch a replayed submission already created, with enough to judge whether it is the same. */
function findBySubmission(tenantId: string, submissionId: string) {
  return withTenant(tenantId, (db) =>
    db.stockBatch.findFirst({
      where: { tenantId, submissionId },
      select: { id: true, linesFingerprint: true },
    }),
  );
}

/**
 * Answers a replay, or refuses an id reused for different contents.
 *
 * The unique index on (tenantId, submissionId) is the mechanism: the losing transaction has already
 * rolled back, stock included, so answering with the document that did commit is both correct and
 * the whole point. A retry is a success, not an error.
 */
async function answerReplay<A>(
  tenantId: string,
  submissionId: string,
  fingerprint: string,
  error: unknown,
): Promise<RecordedStockBatch<A>> {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    throw error;
  }
  const existing = await findBySubmission(tenantId, submissionId);
  if (!existing) throw error;
  if (existing.linesFingerprint !== fingerprint) {
    throw new StockBatchError(
      "SUBMISSION_REUSED",
      "That was already submitted with different lines. Start a new one.",
    );
  }
  return { id: existing.id, idempotent: true, applied: [] };
}

export type ReceivedLine = { variantId: string; quantity: number };

/**
 * Records a delivery: every line goes up by what arrived.
 *
 * Additive and idempotent, which is why the screen needs no confirmation dialog for it — receiving
 * the same delivery twice is refused by the submission id rather than by asking.
 */
export async function recordStockReceipt(
  tenantId: string,
  input: Header & { lines: readonly ReceiptLineInput[] },
): Promise<RecordedStockBatch<ReceivedLine>> {
  const lines = normalizeReceiptLines(input.lines);
  const submissionId = normalizeSubmissionId(input.submissionId);
  const items = [...lines.entries()].map(([variantId, l]) => ({
    variantId,
    quantity: l.quantity,
    unitCostCents: l.unitCostCents,
  }));
  const fingerprint = stockBatchFingerprint("RECEIPT", items);
  const reference = (input.reference ?? "").trim().slice(0, 200);
  const note = (input.note ?? "").trim().slice(0, 500);

  try {
    return await withTenant(tenantId, async (tx) => {
      await assertCanMove(tx, tenantId);
      const batch = await tx.stockBatch.create({
        data: {
          tenantId,
          kind: "RECEIPT",
          submissionId,
          linesFingerprint: fingerprint,
          reference,
          note,
          actorUserId: input.actor.userId,
          actorNameSnapshot: input.actor.name,
        },
        select: { id: true },
      });

      // The ledger write names the batch, which is why the batch is created first — unlike an
      // order, whose id this layer does not control. `incrementStock` reports how many lines it
      // could actually move: a line naming another store's variant moves nothing and is not
      // recorded, which is what makes the "every line was foreign" case detectable below.
      // Every line still exists, or nothing is applied.
      const shelves = await readShelves(
        tx,
        tenantId,
        items.map((item) => item.variantId),
      );
      // And no shelf may be pushed past the ceiling. The cap cannot live in `incrementStock`,
      // which is also how a cancellation and a void give stock BACK: a restore must never be
      // refused, or a cancelled order could not return what it took. A receipt is somebody's
      // intent and is refusable; that is the difference.
      for (const item of items) {
        const shelf = shelves.get(item.variantId)!;
        if (shelf + item.quantity > MAX_STOCK) {
          throw new StockBatchError(
            "OVER_CAPACITY",
            `That would put a shelf past ${MAX_STOCK} units, which is the most this system holds.`,
          );
        }
      }

      await incrementStock(tx, tenantId, items, {
        reason: "RECEIPT",
        actor: input.actor,
        batchId: batch.id,
        note,
      });
      return {
        id: batch.id,
        idempotent: false,
        applied: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
      };
    });
  } catch (error) {
    if (error instanceof StockBatchError) throw error;
    return answerReplay<ReceivedLine>(tenantId, submissionId, fingerprint, error);
  }
}

/**
 * Records a stocktake: every line becomes what was counted.
 *
 * The difference is computed on the server, inside the transaction, from the figure it finds under
 * a row lock (D94) — so a number that went stale while somebody walked the shelf cannot corrupt the
 * result, and the variance that gets recorded is the one that was really there. A line that agrees
 * with the shelf is kept and written as a zero-delta `COUNT`, which is the only evidence the count
 * happened.
 */
export async function recordStocktake(
  tenantId: string,
  input: Header & { lines: readonly CountLineInput[] },
): Promise<RecordedStockBatch<StockSetApplied>> {
  const lines = normalizeCountLines(input.lines);
  const submissionId = normalizeSubmissionId(input.submissionId);
  const targets = [...lines.entries()].map(([variantId, counted]) => ({
    variantId,
    to: counted,
  }));
  const fingerprint = stockBatchFingerprint(
    "COUNT",
    targets.map((t) => ({ variantId: t.variantId, quantity: t.to })),
  );
  const reference = (input.reference ?? "").trim().slice(0, 200);
  const note = (input.note ?? "").trim().slice(0, 500);

  try {
    return await withTenant(tenantId, async (tx) => {
      await assertCanMove(tx, tenantId);
      const batch = await tx.stockBatch.create({
        data: {
          tenantId,
          kind: "COUNT",
          submissionId,
          linesFingerprint: fingerprint,
          reference,
          note,
          actorUserId: input.actor.userId,
          actorNameSnapshot: input.actor.name,
        },
        select: { id: true },
      });

      // Every line still exists, or nothing is applied — the same rule as a receipt, so a count
      // can never report more shelves than it touched.
      const shelves = await readShelves(
        tx,
        tenantId,
        targets.map((target) => target.variantId),
      );
      // A count may always name what is actually there, even for a shelf that somehow sits above
      // the ceiling: refusing it would leave nobody able to bring that figure back into range.
      for (const target of targets) {
        if (target.to > countedCeiling(shelves.get(target.variantId)!)) {
          throw new StockBatchError(
            "OVER_CAPACITY",
            `A count cannot be more than ${MAX_STOCK} units.`,
          );
        }
      }

      const applied = await setStockToMany(tx, tenantId, targets, {
        reason: "COUNT",
        actor: input.actor,
        batchId: batch.id,
        note,
      });
      return { id: batch.id, idempotent: false, applied };
    });
  } catch (error) {
    if (error instanceof StockBatchError) throw error;
    return answerReplay<StockSetApplied>(tenantId, submissionId, fingerprint, error);
  }
}
