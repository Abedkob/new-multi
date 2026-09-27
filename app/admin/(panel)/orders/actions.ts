"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OrderError, updateOrderStatus } from "@/lib/data/orders";
import { ORDER_STATUSES } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import type { FormState } from "@/lib/validation";

/**
 * Store owners move an order along Pending -> Confirmed -> Delivered, or cancel it (which
 * puts the stock back). The tenant comes from the session, so another store's order id is
 * simply "not found".
 */
// OrderError is shared with storefront checkout, so its own .message/.code stay English/semantic
// (not i18n keys) — this map translates only the 3 codes updateOrderStatus can actually throw.
const ORDER_ERROR_KEYS = {
  NOT_FOUND: "orders.error.notFound",
  BAD_TRANSITION: "orders.error.badTransition",
  CHANGED: "orders.error.changed",
} as const;

export async function updateOrderStatusAction(id: string, status: string): Promise<FormState> {
  const { tenantId } = await requireOwner();

  const parsed = z.enum(ORDER_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "orders.error.unknownStatus" };

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
