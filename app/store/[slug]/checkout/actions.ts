"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { OrderError, placeOrder } from "@/lib/data/orders";
import { getTenantBySlug } from "@/lib/data/tenants";
import { RATE_LIMITS, clientIp, rateLimit, retryAfterText } from "@/lib/rate-limit";
import { cartLinesSchema, checkoutSchema } from "@/lib/validation";
import { canServeTenant } from "@/lib/license/status";

/**
 * Public on purpose (guest checkout). The store comes from the slug; prices come from the
 * database, never from the client; stock is deducted atomically inside placeOrder.
 */

export type PlaceOrderResult = {
  ok?: true;
  orderId?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set when stock ran short so the page can refresh what it shows. */
  stockChanged?: boolean;
  /** Set when checkout blocked a price increase so the summary can refresh before retrying. */
  priceChanged?: boolean;
};

export async function placeOrderAction(
  slug: string,
  input: {
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    deliveryLocation: string;
    notes: string;
    lines: { variantId: string; quantity: number; expectedPriceCents?: number }[];
  },
): Promise<PlaceOrderResult> {
  const tenant = typeof slug === "string" ? await getTenantBySlug(slug) : null;
  if (!tenant) return { error: "This store could not be found." };
  if (!canServeTenant(tenant)) return { error: "This store is temporarily unavailable and cannot accept orders." };

  // One flood of pending orders can tie up a store's stock, so cap orders per source per store.
  const ip = clientIp(await headers());
  const limit = await rateLimit(`checkout:${tenant.id}:${ip}`, RATE_LIMITS.checkout);
  if (!limit.ok) {
    return {
      error: `Too many orders from here. Please try again in ${retryAfterText(limit.retryAfterMs)}.`,
    };
  }

  const customer = checkoutSchema.safeParse(input);
  if (!customer.success) {
    return { error: "Please check the highlighted fields.", fieldErrors: z.flattenError(customer.error).fieldErrors };
  }
  const lines = cartLinesSchema.safeParse(input?.lines);
  if (!lines.success) {
    return { error: lines.error.issues[0]?.message ?? "Your cart is empty." };
  }

  try {
    const order = await placeOrder(tenant.id, customer.data, lines.data);
    return { ok: true, orderId: order.id };
  } catch (e) {
    if (e instanceof OrderError) {
      return {
        error: e.message,
        stockChanged: e.code === "STOCK" || e.code === "UNAVAILABLE",
        priceChanged: e.code === "PRICE_CHANGED",
      };
    }
    console.error("placeOrder failed:", e instanceof Error ? e.message : e);
    return { error: "Something went wrong placing your order. Please try again." };
  }
}
