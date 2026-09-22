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
 * Pending -> Confirmed -> Delivered, and Cancelled from any state that isn't already
 * Cancelled. Cancelled is final (un-cancelling would mean taking the stock back again).
 */
export function nextStatuses(from: OrderStatusValue): OrderStatusValue[] {
  switch (from) {
    case "PENDING":
      return ["CONFIRMED", "CANCELLED"];
    case "CONFIRMED":
      return ["DELIVERED", "CANCELLED"];
    case "DELIVERED":
      return ["CANCELLED"];
    case "CANCELLED":
      return [];
  }
}

export const canTransition = (from: OrderStatusValue, to: OrderStatusValue) =>
  nextStatuses(from).includes(to);

/** Short, human-friendly order reference (not a secret; the full id is the lookup key). */
export const orderRef = (id: string) => `#${id.slice(-6).toUpperCase()}`;

export const orderTotal = (items: { priceCentsSnapshot: number; quantity: number }[]) =>
  items.reduce((sum, i) => sum + i.priceCentsSnapshot * i.quantity, 0);
