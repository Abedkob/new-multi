/** Pure order rules shared by the admin UI and the data layer. */

export const ORDER_STATUSES = ["PENDING", "CONFIRMED", "DELIVERED", "CANCELLED"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const STATUS_LABEL: Record<OrderStatusValue, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/**
 * Pending -> Confirmed -> Delivered, and Cancelled from Pending or Confirmed. Delivered and
 * Cancelled are both final: cancelling restores stock, which is wrong once the goods have left
 * (a return would need its own flow), and un-cancelling would mean taking the stock back again.
 */
export function nextStatuses(from: OrderStatusValue): OrderStatusValue[] {
  switch (from) {
    case "PENDING":
      return ["CONFIRMED", "CANCELLED"];
    case "CONFIRMED":
      return ["DELIVERED", "CANCELLED"];
    case "DELIVERED":
      return [];
    case "CANCELLED":
      return [];
  }
}

export const canTransition = (from: OrderStatusValue, to: OrderStatusValue) =>
  nextStatuses(from).includes(to);

/** Short, human-friendly order reference (not a secret; the full id is the lookup key). */
export const orderRef = (id: string) => `#${id.slice(-6).toUpperCase()}`;

export const orderSubtotal = (items: { priceCentsSnapshot: number; quantity: number }[]) =>
  items.reduce((sum, i) => sum + i.priceCentsSnapshot * i.quantity, 0);

export const orderTotal = (
  items: { priceCentsSnapshot: number; quantity: number }[],
  deliveryFeeCents = 0,
) => orderSubtotal(items) + deliveryFeeCents;

/**
 * Whether an order was placed recently enough that showing its confirmation page counts as "the
 * purchase just happened" for analytics (lib/analytics.tsx's PurchaseTracker). The confirmation
 * URL stays valid forever; revisiting it later must not report the sale again.
 */
export const PURCHASE_TRACKING_WINDOW_MS = 30 * 60_000;
export const isFreshOrder = (createdAt: Date) =>
  Date.now() - createdAt.getTime() < PURCHASE_TRACKING_WINDOW_MS;
