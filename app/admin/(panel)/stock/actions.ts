"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/permissions";
import {
  StockBatchError,
  recordStockReceipt,
  recordStocktake,
  type CountLineInput,
  type ReceiptLineInput,
  type StockBatchErrorCode,
} from "@/lib/data/stock-batches";
import { searchStockVariants, type StockSearchRow } from "@/lib/data/stock-ledger";
import { costForRole } from "@/lib/stock";
import { parseAttributes, variantLabel } from "@/lib/variants";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";

/**
 * The stockroom's three endpoints.
 *
 * Each names its own capability in its own body, because a server action is its own HTTP endpoint
 * and the page's guard does not protect it. The module switch is enforced one layer further down,
 * in `lib/data/stock-batches.ts`, so somebody who kept a form open after the platform turned the
 * module off — or who posts straight here — meets the same refusal.
 */

const ERROR_KEYS: Record<StockBatchErrorCode, DictionaryKey> = {
  EMPTY: "stock.error.EMPTY",
  INVALID: "stock.error.INVALID",
  FEATURE_OFF: "stock.error.FEATURE_OFF",
  UNAVAILABLE: "stock.error.UNAVAILABLE",
  OVER_CAPACITY: "stock.error.OVER_CAPACITY",
  SUBMISSION_REUSED: "stock.error.SUBMISSION_REUSED",
};

/** One row of the picker: enough to show it, add it, and say what is on the shelf now. */
export type StockPickerItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  stock: number;
  lowAt: number;
};

export type StockSearchResult =
  | { ok: true; items: StockPickerItem[] }
  | { ok: false; errorKey: DictionaryKey };

/**
 * The picker's search, as a server action rather than a `?q=` param.
 *
 * The overview's search is a plain GET form and is right to be: a URL is better there. Here a
 * server-component re-render would remount the editor and lose every line typed so far, and
 * somebody losing a half-entered delivery because they searched for the next box is the worst bug
 * these screens could have. The till learned this first.
 */
export async function searchStockItemsAction(search: string): Promise<StockSearchResult> {
  const { tenantId } = await requireCapability("stock:move");
  try {
    const rows = await searchStockVariants(tenantId, search);
    return { ok: true, items: rows.map(toPickerItem) };
  } catch {
    return { ok: false, errorKey: "stock.error.generic" };
  }
}

function toPickerItem(row: StockSearchRow): StockPickerItem {
  return {
    variantId: row.variantId,
    productId: row.productId,
    productName: row.productName,
    // Resolved on the server: `parseAttributes` is where a Json column becomes a label, and doing
    // it in the client would ship that logic and the raw attributes to the browser.
    variantLabel: variantLabel(parseAttributes(row.attributes), ""),
    stock: row.stock,
    lowAt: row.lowAt,
  };
}

export type ReceiveResult =
  | { ok: true; batchId: string; lines: number; idempotent: boolean }
  | { ok: false; errorKey: DictionaryKey };

export async function receiveStockAction(input: {
  submissionId: string;
  reference: string;
  note: string;
  lines: ReceiptLineInput[];
}): Promise<ReceiveResult> {
  const member = await requireCapability("stock:move");
  try {
    const batch = await recordStockReceipt(member.tenantId, {
      submissionId: input.submissionId,
      reference: input.reference,
      note: input.note,
      lines: input.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        // D92, the half that is not presentation: the cost is DROPPED for a non-owner, whatever
        // was posted. The form not rendering the field for staff is a courtesy; this is the
        // check, and it is one pure function so the rule has exactly one definition.
        unitCostCents: costForRole(member.role, line.unitCostCents),
      })),
      // Who submitted it comes from the session, never the payload.
      actor: { userId: member.userId, name: member.name },
    });
    revalidatePath("/admin/stock");
    revalidatePath("/admin/stock/history");
    revalidatePath("/admin/products");
    return {
      ok: true,
      batchId: batch.id,
      lines: batch.applied.length,
      idempotent: batch.idempotent,
    };
  } catch (error) {
    if (error instanceof StockBatchError) return { ok: false, errorKey: ERROR_KEYS[error.code] };
    console.error("receiveStockAction failed:", error);
    return { ok: false, errorKey: "stock.error.generic" };
  }
}

export type CountResult =
  | {
      ok: true;
      batchId: string;
      idempotent: boolean;
      /**
       * What was actually applied, per line, as the server found it.
       *
       * Returned rather than assumed, because a count is authoritative and the figure the screen
       * showed as "expected" may not be the one the server replaced (D94). The summary says so when
       * they differ, instead of reporting the variance somebody was shown.
       */
      applied: { variantId: string; from: number; to: number; delta: number }[];
    }
  | { ok: false; errorKey: DictionaryKey };

export async function countStockAction(input: {
  submissionId: string;
  reference: string;
  note: string;
  lines: CountLineInput[];
}): Promise<CountResult> {
  const member = await requireCapability("stock:move");
  try {
    const batch = await recordStocktake(member.tenantId, {
      submissionId: input.submissionId,
      reference: input.reference,
      note: input.note,
      lines: input.lines,
      actor: { userId: member.userId, name: member.name },
    });
    revalidatePath("/admin/stock");
    revalidatePath("/admin/stock/history");
    revalidatePath("/admin/products");
    return {
      ok: true,
      batchId: batch.id,
      idempotent: batch.idempotent,
      applied: batch.applied,
    };
  } catch (error) {
    if (error instanceof StockBatchError) return { ok: false, errorKey: ERROR_KEYS[error.code] };
    console.error("countStockAction failed:", error);
    return { ok: false, errorKey: "stock.error.generic" };
  }
}
