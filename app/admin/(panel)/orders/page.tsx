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
import { getT } from "@/lib/i18n/locale";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { encodeMessage, resolveMessage } from "@/lib/i18n/types";
import { ORDER_STATUSES, orderRef, orderTotal, type OrderStatusValue } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { STATUS_DOT, StatusBadge } from "./status-badge";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_LABEL_KEYS: Record<OrderStatusValue, DictionaryKey> = {
  PENDING: "orders.status.PENDING",
  CONFIRMED: "orders.status.CONFIRMED",
  DELIVERED: "orders.status.DELIVERED",
  CANCELLED: "orders.status.CANCELLED",
};

// What each tab means, in plain words, shown when it's empty.
const EMPTY_TEXT_KEYS: Record<OrderStatusValue | "ALL", DictionaryKey> = {
  ALL: "orders.empty.all",
  PENDING: "orders.empty.PENDING",
  CONFIRMED: "orders.empty.CONFIRMED",
  DELIVERED: "orders.empty.DELIVERED",
  CANCELLED: "orders.empty.CANCELLED",
};

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const { tenantId } = await requireOwner();
  const t = await getT();
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
      label: t("orders.status.all"),
      count: all,
      href: pageSize === 25 ? "/admin/orders" : `/admin/orders?perPage=${pageSize}`,
    },
    ...ORDER_STATUSES.map((s) => ({
      key: s,
      label: t(STATUS_LABEL_KEYS[s]),
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
        title={t("orders.page.title")}
        description={t("orders.page.description")}
      />

      <nav aria-label={t("orders.page.filterAriaLabel")} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === current ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
              tab.key === current
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.key !== "ALL" && <span className={cn("size-2 rounded-full", STATUS_DOT[tab.key])} aria-hidden />}
            {tab.label}
            <span className="tabular-nums opacity-70">{tab.count}</span>
          </Link>
        ))}
      </nav>

      <AdminPageSizeControl page={page} pageSize={pageSize} total={total} noun={t("orders.page.noun")} />

      <Card className="gap-0 overflow-hidden py-0">
        {orders.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={
              status
                ? resolveMessage(
                    t,
                    encodeMessage("orders.empty.noStatusOrders", tabs.find((tab) => tab.key === status)!.label.toLowerCase()),
                  )
                : t("orders.empty.noOrdersYet")
            }
          >
            {t(EMPTY_TEXT_KEYS[current])}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="ps-4">{t("orders.table.order")}</TableHead>
                <TableHead>{t("orders.table.customer")}</TableHead>
                <TableHead className="text-end">{t("orders.table.items")}</TableHead>
                <TableHead className="text-end">{t("orders.table.total")}</TableHead>
                <TableHead>{t("discounts.table.status")}</TableHead>
                <TableHead className="pe-4 text-end">
                  <span className="sr-only">{t("orders.table.detailsSr")}</span>
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
                  <TableCell className="ps-4">
                    <span className="block font-mono text-sm">{orderRef(o.id)}</span>
                    <span
                      className="block text-xs text-muted-foreground"
                      title={o.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    >
                      {timeAgo(o.createdAt, t)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {o.customerName}
                    <span className="block text-xs text-muted-foreground">{o.customerPhone}</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {o.items.reduce((n, i) => n + i.quantity, 0)}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    {formatPrice(orderTotal(o.items, o.deliveryFeeCentsSnapshot))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="pe-4 text-end">
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className={buttonVariants({
                        variant: o.status === "PENDING" ? "default" : "outline",
                        size: "sm",
                      })}
                    >
                      {t("orders.table.view")}
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
        noun={t("orders.page.noun")}
        params={{
          ...(status ? { status } : {}),
          ...(pageSize === 25 ? {} : { perPage: String(pageSize) }),
        }}
      />
    </div>
  );
}
