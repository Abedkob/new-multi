"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/permissions";
import {
  CounterSaleError,
  recordCounterSale,
  searchTillItems,
  voidCounterSale,
  type CounterSaleErrorCode,
  type CounterSaleLineInput,
  type TillItem,
} from "@/lib/data/counter-sales";
import { COUNTER_SALE_PAYMENTS, type CounterSalePaymentValue } from "@/lib/counter-sales";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";

/**
 * The till's three endpoints.
 *
 * Each names its own capability in its own body, because a server action is its own HTTP endpoint
 * and the page's guard does not protect it. That also means the feature switch is enforced in the
 * data layer rather than here: a staff member who left the page open after the till was turned
 * off, or who posts straight to this action, is refused by `recordCounterSale` itself.
 */

/** Error codes are mapped to dictionary keys, so a cashier reads them in their own language. */
const ERROR_KEYS: Record<CounterSaleErrorCode, DictionaryKey> = {
  EMPTY: "counter.error.EMPTY",
  INVALID: "counter.error.INVALID",
  FEATURE_OFF: "counter.error.FEATURE_OFF",
  UNAVAILABLE: "counter.error.UNAVAILABLE",
  STOCK: "counter.error.STOCK",
  PRICE_CHANGED: "counter.error.PRICE_CHANGED",
  DISCOUNT_REFUSED: "counter.error.DISCOUNT_REFUSED",
  SUBMISSION_REUSED: "counter.error.SUBMISSION_REUSED",
  NOT_FOUND: "counter.error.NOT_FOUND",
  ALREADY_VOIDED: "counter.error.ALREADY_VOIDED",
};

export type TillSearchResult = { ok: true; items: TillItem[] } | { ok: false; errorKey: DictionaryKey };

export async function searchTillItemsAction(search: string): Promise<TillSearchResult> {
  const { tenantId } = await requireCapability("counter:sell");
  try {
    return { ok: true, items: await searchTillItems(tenantId, search) };
  } catch {
    return { ok: false, errorKey: "counter.error.generic" };
  }
}

export type RecordSaleResult =
  | { ok: true; saleId: string; totalCents: number }
  /** `detail` carries the figures the screen needs to explain a refusal without guessing. */
  | {
      ok: false;
      errorKey: DictionaryKey;
      detail?: { variantId?: string; available?: number; actualCents?: number };
    };

export async function recordCounterSaleAction(input: {
  submissionId: string;
  payment: string;
  lines: CounterSaleLineInput[];
  expectedTotalCents: number;
}): Promise<RecordSaleResult> {
  const member = await requireCapability("counter:sell");
  const payment = COUNTER_SALE_PAYMENTS.find((p) => p === input.payment);
  if (!payment) return { ok: false, errorKey: "counter.error.INVALID" };

  try {
    const sale = await recordCounterSale(member.tenantId, {
      submissionId: input.submissionId,
      payment: payment as CounterSalePaymentValue,
      lines: input.lines,
      // Who sold it comes from the session, never the payload.
      soldByUserId: member.userId,
      soldByName: member.name,
      role: member.role,
      expectedTotalCents: input.expectedTotalCents,
    });
    revalidatePath("/admin/counter");
    return { ok: true, saleId: sale.id, totalCents: sale.totalCents };
  } catch (error) {
    if (error instanceof CounterSaleError) {
      return {
        ok: false,
        errorKey: ERROR_KEYS[error.code],
        detail: {
          variantId: error.detail?.variantId,
          available: error.detail?.available,
          actualCents: error.detail?.actualCents,
        },
      };
    }
    console.error("recordCounterSaleAction failed:", error);
    return { ok: false, errorKey: "counter.error.generic" };
  }
}

export type VoidSaleResult =
  | { ok: true; restoredLines: number; totalLines: number }
  | { ok: false; errorKey: DictionaryKey };

export async function voidCounterSaleAction(
  saleId: string,
  reason: string,
): Promise<VoidSaleResult> {
  // Owner only, for the orders:cancel reason: it puts stock back and rewrites a settled figure.
  const member = await requireCapability("counter:void");
  try {
    const result = await voidCounterSale(member.tenantId, saleId, {
      voidedByName: member.name,
      reason,
      voidedByUserId: member.userId,
    });
    revalidatePath("/admin/counter");
    revalidatePath(`/admin/counter/${saleId}`);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof CounterSaleError) return { ok: false, errorKey: ERROR_KEYS[error.code] };
    console.error("voidCounterSaleAction failed:", error);
    return { ok: false, errorKey: "counter.error.generic" };
  }
}
