import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { expireStalePendingOrders, listOrders } from "@/lib/data/orders";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/format";
import { orderRef, orderTotal } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import { StatusBadge } from "./status-badge";

export default async function OrdersPage() {
  const { tenantId } = await requireOwner();

  // Lazy cleanup (no scheduler): release stock held by PENDING orders the owner never acted on,
  // so this page shows accurate state. Best-effort — a failure here must never break the page.
  const cutoff = new Date(Date.now() - env.ORDER_PENDING_TTL_HOURS * 3_600_000);
  try {
    await expireStalePendingOrders(tenantId, cutoff);
  } catch (e) {
    console.error("expireStalePendingOrders failed:", e instanceof Error ? e.message : e);
  }

  const orders = await listOrders(tenantId);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-muted-foreground">
          Cash-on-delivery orders from your storefront, newest first.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Placed</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">Items</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                No orders yet.
              </TableCell>
            </TableRow>
          )}
          {orders.map((o) => (
            <TableRow key={o.id} data-testid="order-row">
              <TableCell className="font-mono text-sm">{orderRef(o.id)}</TableCell>
              <TableCell>
                {o.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </TableCell>
              <TableCell>
                {o.customerName}
                <span className="block text-xs text-muted-foreground">{o.customerPhone}</span>
              </TableCell>
              <TableCell className="text-right">
                {o.items.reduce((n, i) => n + i.quantity, 0)}
              </TableCell>
              <TableCell className="text-right">{formatPrice(orderTotal(o.items))}</TableCell>
              <TableCell>
                <StatusBadge status={o.status} />
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/admin/orders/${o.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  View
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
