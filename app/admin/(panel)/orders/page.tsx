import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { expireStalePendingOrders, listOrdersPage } from "@/lib/data/orders";
import { formatPrice } from "@/lib/format";
import { ORDER_STATUSES, STATUS_LABEL, orderRef, orderTotal, type OrderStatusValue } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { STATUS_DOT, StatusBadge } from "./status-badge";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// What each tab means, in plain words, shown when it's empty.
const EMPTY_TEXT: Record<OrderStatusValue | "ALL", string> = {
  ALL: "When someone buys from your store, the order shows up here.",
  PENDING: "Nothing waiting. New orders land here until you confirm them.",
  CONFIRMED: "No confirmed orders on their way right now.",
  DELIVERED: "Orders you've marked as delivered show up here.",
  CANCELLED: "No cancelled orders.",
};

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const { tenantId } = await requireOwner();
  const sp = await searchParams;
  const requested = Number.parseInt(first(sp.page) ?? "1", 10) || 1;
  const requestedPageSize = Number.parseInt(first(sp.perPage) ?? "25", 10) || 25;
  const status = ORDER_STATUSES.find((s) => s === first(sp.status));

  // Lazy cleanup (no scheduler): release stock held by PENDING orders the owner never acted on,
  // so this page shows accurate state. Best-effort — a failure here must never break the page.
  try {
    await expireStalePendingOrders(tenantId);
  } catch (e) {
    console.error("expireStalePendingOrders failed:", e instanceof Error ? e.message : e);
  }

  const { items: orders, total, page, pages, pageSize, counts } = await listOrdersPage(
    tenantId,
    requested,
    status,
    requestedPageSize,
  );
  const all = ORDER_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const tabs: { key: OrderStatusValue | "ALL"; label: string; count: number; href: string }[] = [
    {
      key: "ALL",
      label: "All",
      count: all,
      href: pageSize === 25 ? "/admin/orders" : `/admin/orders?perPage=${pageSize}`,
    },
    ...ORDER_STATUSES.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: counts[s] ?? 0,
      href: `/admin/orders?${new URLSearchParams({
        status: s,
        ...(pageSize === 25 ? {} : { perPage: String(pageSize) }),
      })}`,
    })),
  ];
  const current = status ?? "ALL";

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Orders"
        description="Customers pay cash when their order arrives. Call to confirm new orders, then mark them delivered once they've been paid."
      />

      <nav aria-label="Filter orders" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === current ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
              t.key === current
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {t.key !== "ALL" && <span className={cn("size-2 rounded-full", STATUS_DOT[t.key])} aria-hidden />}
            {t.label}
            <span className="tabular-nums opacity-70">{t.count}</span>
          </Link>
        ))}
      </nav>

      <AdminPageSizeControl page={page} pageSize={pageSize} total={total} noun="orders" />

      <Card className="gap-0 overflow-hidden py-0">
        {orders.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={status ? `No ${tabs.find((t) => t.key === status)!.label.toLowerCase()} orders` : "No orders yet."}
          >
            {EMPTY_TEXT[current]}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="pl-4">Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow
                  key={o.id}
                  data-testid="order-row"
                  className={cn(o.status === "PENDING" && "bg-amber-50/50 dark:bg-amber-950/20")}
                >
                  <TableCell className="pl-4">
                    <span className="block font-mono text-sm">{orderRef(o.id)}</span>
                    <span
                      className="block text-xs text-muted-foreground"
                      title={o.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    >
                      {timeAgo(o.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {o.customerName}
                    <span className="block text-xs text-muted-foreground">{o.customerPhone}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.items.reduce((n, i) => n + i.quantity, 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatPrice(orderTotal(o.items, o.deliveryFeeCentsSnapshot))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className={buttonVariants({
                        variant: o.status === "PENDING" ? "default" : "outline",
                        size: "sm",
                      })}
                    >
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <AdminPagination
        basePath="/admin/orders"
        page={page}
        pages={pages}
        total={total}
        noun="orders"
        params={{
          ...(status ? { status } : {}),
          ...(pageSize === 25 ? {} : { perPage: String(pageSize) }),
        }}
      />
    </div>
  );
}
