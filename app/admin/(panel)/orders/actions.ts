"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OrderError, updateOrderStatus } from "@/lib/data/orders";
import { ORDER_STATUSES } from "@/lib/orders";
import { requireCapability } from "@/lib/permissions";
import type { FormState } from "@/lib/validation";

/**
 * Moving an order along Pending -> Confirmed -> Delivered, or cancelling it (which puts the
 * stock back). The tenant comes from the session, so another store's order id is simply
 * "not found".
 *
 * One action, two capabilities (D73). Advancing an order is the job and staff do it; cancelling
 * restores stock, is final, and is a decision about a customer rather than a step in serving
 * one, so it is the owner's. The capability is therefore chosen from the requested status —
 * which is read from the argument and so must be validated BEFORE it is used to pick a guard,
 * or an unparseable status would decide which permission applies.
 */
// OrderError is shared with storefront checkout, so its own .message/.code stay English/semantic
// (not i18n keys) — this map translates only the 3 codes updateOrderStatus can actually throw.
const ORDER_ERROR_KEYS = {
  NOT_FOUND: "orders.error.notFound",
  BAD_TRANSITION: "orders.error.badTransition",
  CHANGED: "orders.error.changed",
} as const;

export async function updateOrderStatusAction(id: string, status: string): Promise<FormState> {
  const parsed = z.enum(ORDER_STATUSES).safeParse(status);
  if (!parsed.success) {
    // Refused before any guard runs and before any tenant is known: an unrecognised status
    // names no capability, so there is nothing to check it against.
    return { error: "orders.error.unknownStatus" };
  }
  const { tenantId } = await requireCapability(
    parsed.data === "CANCELLED" ? "orders:cancel" : "orders:advance",
  );

  try {
    await updateOrderStatus(tenantId, id, parsed.data);
  } catch (e) {
    if (e instanceof OrderError) {
      return { error: ORDER_ERROR_KEYS[e.code as keyof typeof ORDER_ERROR_KEYS] ?? "orders.error.badTransition" };
    }
    throw e;
  }
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  return { ok: true };
}
