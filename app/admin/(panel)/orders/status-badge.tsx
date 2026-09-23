import { STATUS_LABEL, type OrderStatusValue } from "@/lib/orders";
import { cn } from "@/lib/utils";

// One colour per step, used everywhere an order status appears: amber = needs you,
// blue = on its way, green = done, grey = cancelled.
export const STATUS_TONE: Record<OrderStatusValue, string> = {
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  CONFIRMED: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  CANCELLED: "bg-muted text-muted-foreground ring-border",
};

export const STATUS_DOT: Record<OrderStatusValue, string> = {
  PENDING: "bg-amber-500",
  CONFIRMED: "bg-blue-500",
  DELIVERED: "bg-emerald-500",
  CANCELLED: "bg-muted-foreground/50",
};

export function StatusBadge({ status }: { status: OrderStatusValue }) {
  return (
    <span
      data-testid="order-status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        STATUS_TONE[status],
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
