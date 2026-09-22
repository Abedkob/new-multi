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
export async function updateOrderStatusAction(id: string, status: string): Promise<FormState> {
  const { tenantId } = await requireOwner();

  const parsed = z.enum(ORDER_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "Unknown status." };

  try {
    await updateOrderStatus(tenantId, id, parsed.data);
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  return { ok: true };
}
