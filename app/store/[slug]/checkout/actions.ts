"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { resolveOrderAttribution } from "@/lib/analytics/order-attribution";
import { announceNewOrderSafely } from "@/lib/notifications/new-order";
import { OrderError, placeOrder, previewCoupon } from "@/lib/data/orders";
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
  /** Set when the store changed its delivery fee after this checkout page loaded. */
  deliveryChanged?: boolean;
  couponChanged?: boolean;
};

export type CouponPreviewResult = {
  ok?: true; error?: string; code?: string; name?: string | null; scope?: string;
  merchandiseDiscountCents?: number; deliveryDiscountCents?: number; discountCents?: number; totalCents?: number;
};

export async function previewCouponAction(slug: string, code: string, inputLines: { variantId: string; quantity: number }[]): Promise<CouponPreviewResult> {
  const tenant = typeof slug === "string" ? await getTenantBySlug(slug) : null;
  if (!tenant || !canServeTenant(tenant)) return { error: "We couldn’t apply that code. Check it and try again." };
  const lines = cartLinesSchema.safeParse(inputLines);
  if (!lines.success || typeof code !== "string" || code.trim().length > 32) return { error: "We couldn’t apply that code. Check it and try again." };
  const ip = clientIp(await headers());
  const limit = await rateLimit(`coupon:${tenant.id}:${ip}`, RATE_LIMITS.coupon);
  if (!limit.ok) return { error: `Too many attempts. Try again in ${retryAfterText(limit.retryAfterMs)}.` };
  try {
    return { ok: true, ...(await previewCoupon(tenant.id, code, lines.data)) };
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    return { error: "We couldn’t apply that code. Check it and try again." };
  }
}

export async function placeOrderAction(
  slug: string,
  input: {
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    deliveryLocation: string;
    notes: string;
    expectedDeliveryFeeCents?: number;
    couponCode?: string;
    expectedTotalCents?: number;
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
  if (
    input.expectedDeliveryFeeCents !== undefined &&
    (!Number.isInteger(input.expectedDeliveryFeeCents) ||
      input.expectedDeliveryFeeCents < 0 ||
      input.expectedDeliveryFeeCents > 999_999)
  ) {
    return { error: "The displayed delivery fee is invalid. Refresh and try again." };
  }
  if (input.expectedTotalCents !== undefined && (!Number.isInteger(input.expectedTotalCents) || input.expectedTotalCents < 0 || input.expectedTotalCents > 100_000_000)) {
    return { error: "The displayed total is invalid. Refresh and try again." };
  }

  // Resolved before the order transaction opens, and undefined whenever anything is missing or
  // wrong — no consent, no session, an unreachable analytics pool. The order is then recorded
  // with nulls and is otherwise identical. Measurement is never allowed to cost a sale.
  const attribution = await resolveOrderAttribution(tenant);

  try {
    const order = await placeOrder(tenant.id, customer.data, lines.data, {
      expectedDeliveryFeeCents: input.expectedDeliveryFeeCents,
      couponCode: input.couponCode?.trim() || undefined,
      expectedTotalCents: input.expectedTotalCents,
      attribution,
    });
    // Tell the owner, AFTER the transaction committed and AFTER this response is on its way
    // (D51). Three rules hold here, and all three are about the order rather than the
    // notification:
    //
    //   - `after()`, never inline: the shopper waits for nothing, and a push service that
    //     hangs costs the sender's own 2.5s timeout in a callback nobody is waiting on.
    //   - After commit, never inside the transaction: a notification for an order that then
    //     rolled back is worse than a missed one, and a push call inside a transaction holds a
    //     database connection open on a network round trip.
    //   - `announceNewOrderSafely` swallows everything. An unhandled rejection in `after()`
    //     becomes an uncaughtException in Next.js, which would turn a quiet push failure into
    //     a crashed request — exactly what Phase 5 hit with Redis.
    //
    // Anything missed here (a deploy mid-flight, a 10s container shutdown) is picked up by the
    // scheduled catch-up stage, which is why this path is allowed to be best-effort.
    after(() => announceNewOrderSafely(tenant.id, order.id));
    return { ok: true, orderId: order.id };
  } catch (e) {
    if (e instanceof OrderError) {
      return {
        error: e.message,
        stockChanged: e.code === "STOCK" || e.code === "UNAVAILABLE",
        priceChanged: e.code === "PRICE_CHANGED",
        deliveryChanged: e.code === "DELIVERY_CHANGED",
        couponChanged: e.code === "COUPON_INVALID" || e.code === "COUPON_CHANGED",
      };
    }
    console.error("placeOrder failed:", e instanceof Error ? e.message : e);
    return { error: "Something went wrong placing your order. Please try again." };
  }
}
