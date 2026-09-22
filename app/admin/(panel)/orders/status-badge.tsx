import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, type OrderStatusValue } from "@/lib/orders";

const VARIANT: Record<OrderStatusValue, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "secondary",
  CONFIRMED: "default",
  DELIVERED: "outline",
  CANCELLED: "destructive",
};

export function StatusBadge({ status }: { status: OrderStatusValue }) {
  return (
    <Badge variant={VARIANT[status]} data-testid="order-status">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
