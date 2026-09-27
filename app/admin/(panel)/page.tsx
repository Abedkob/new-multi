import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  DollarSign,
  ExternalLink,
  Package,
  PackageOpen,
  Plus,
  ShoppingBag,
} from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { StockBadge } from "@/components/admin/stock-badge";
import { Thumb } from "@/components/admin/thumb";
import { CopyText } from "@/components/copy-text";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboard } from "@/lib/data/dashboard";
import { getTenantById } from "@/lib/data/tenants";
import { formatPrice } from "@/lib/format";
import { resolveMessage } from "@/lib/i18n/context";
import { getT } from "@/lib/i18n/locale";
import { encodeMessage } from "@/lib/i18n/types";
import { orderRef, orderTotal } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import { getStoreUrl } from "@/lib/store-url";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { parseAttributes, variantLabel } from "@/lib/variants";
import { StatusBadge } from "./orders/status-badge";

export default async function AdminHome() {
  const { tenantId, name } = await requireOwner();
  const t = await getT();
  const [tenant, d] = await Promise.all([getTenantById(tenantId), getDashboard(tenantId)]);
  if (!tenant) notFound();

  const storeUrl = getStoreUrl(tenant);
  const pending = d.orderCounts.PENDING;

  // The first things a new owner should do, in order. Hidden once all are done.
  const steps = [
    {
      done: d.hasLogo,
      title: t("dashboard.step1.title"),
      text: t("dashboard.step1.text"),
      href: "/admin/content",
      cta: t("dashboard.step1.cta"),
    },
    {
      done: d.hasHero,
      title: t("dashboard.step2.title"),
      text: t("dashboard.step2.text"),
      href: "/admin/content",
      cta: t("dashboard.step2.cta"),
    },
    {
      done: d.categoryCount > 0,
      title: t("dashboard.step3.title"),
      text: t("dashboard.step3.text"),
      href: "/admin/categories/new",
      cta: t("categories.page.newCategory"),
    },
    {
      done: d.productCount > 0,
      title: t("dashboard.step4.title"),
      text: t("dashboard.step4.text"),
      href: "/admin/products/new",
      cta: t("dashboard.addProduct"),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={resolveMessage(t, encodeMessage("dashboard.welcomeBack", name))}
        description={t("dashboard.subtitle")}
        actions={
          <>
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              <ExternalLink className="size-4" aria-hidden /> {t("dashboard.viewStore")}
            </a>
            <Link href="/admin/products/new" className={buttonVariants()}>
              <Plus className="size-4" aria-hidden /> {t("dashboard.addProduct")}
            </Link>
          </>
        }
      />

      {pending > 0 && (
        <Link
          href="/admin/orders?status=PENDING"
          className="flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
            <BellRing className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              {resolveMessage(
                t,
                encodeMessage("dashboard.pendingBanner.title", pending, t(pending === 1 ? "dashboard.order" : "dashboard.orders")),
              )}
            </span>
            <span className="block text-sm opacity-80">{t("dashboard.pendingBanner.subtitle")}</span>
          </span>
          <ArrowRight className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={BellRing}
          label={t("dashboard.stat.newOrders")}
          hint={t("dashboard.stat.newOrdersHint")}
          href="/admin/orders?status=PENDING"
          tone={pending > 0 ? "amber" : "default"}
        >
          <span data-testid="pending-orders">{pending}</span>
        </Stat>
        <Stat
          icon={DollarSign}
          label={t("dashboard.stat.salesThisMonth")}
          hint={resolveMessage(t, encodeMessage("dashboard.stat.confirmedOrDelivered", d.paidOrdersThisMonth))}
        >
          {formatPrice(d.salesThisMonthCents)}
        </Stat>
        <Stat
          icon={CalendarDays}
          label={t("dashboard.stat.ordersThisWeek")}
          hint={t("dashboard.stat.last7Days")}
          href="/admin/orders"
        >
          {d.ordersThisWeek}
        </Stat>
        <Stat
          icon={Package}
          label={t("nav.products")}
          hint={`${d.categoryCount} ${t(d.categoryCount === 1 ? "categories.singular" : "categories.page.noun")}`}
          href="/admin/products"
        >
          {d.productCount}
        </Stat>
      </div>

      {doneCount < steps.length && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t("dashboard.checklist.title")}</CardTitle>
              <span className="text-sm text-muted-foreground">
                {resolveMessage(t, encodeMessage("dashboard.checklist.doneOfTotal", doneCount, steps.length))}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2">
              {steps.map((s) => (
                <li
                  key={s.title}
                  className={cn(
                    "flex flex-wrap items-center gap-3 rounded-lg border p-3",
                    s.done && "bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border-2",
                      s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30",
                    )}
                    aria-label={s.done ? t("dashboard.checklist.doneAria") : t("dashboard.checklist.todoAria")}
                  >
                    {s.done && <Check className="size-4" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-medium", s.done && "text-muted-foreground line-through")}>
                      {s.title}
                    </span>
                    {!s.done && <span className="block text-xs text-muted-foreground">{s.text}</span>}
                  </span>
                  {!s.done && (
                    <Link href={s.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {s.cta}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("dashboard.orders.title")}</CardTitle>
              <Link href="/admin/orders" className="text-sm text-muted-foreground hover:text-foreground">
                {t("dashboard.orders.seeAll")}{" "}
                <span aria-hidden className="inline-block rtl:-scale-x-100">
                  &rarr;
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {d.recentOrders.length === 0 ? (
              <EmptyState icon={ShoppingBag} title={t("dashboard.orders.empty")}>
                {t("orders.empty.all")}
              </EmptyState>
            ) : (
              <ul className="-mx-2 grid">
                {d.recentOrders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                        {[...o.customerName.trim()][0]?.toUpperCase() ?? "?"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{o.customerName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {orderRef(o.id)} · {timeAgo(o.createdAt, t)}
                        </span>
                      </span>
                      <span className="text-sm font-medium tabular-nums">{formatPrice(orderTotal(o.items, o.deliveryFeeCentsSnapshot))}</span>
                      <StatusBadge status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("dashboard.lowStock.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {d.lowStock.length === 0 ? (
              <EmptyState icon={PackageOpen} title={t("dashboard.lowStock.empty")}>
                {t("dashboard.lowStock.emptyBody")}
              </EmptyState>
            ) : (
              <ul className="-mx-2 grid">
                {d.lowStock.map((v) => {
                  const label = variantLabel(parseAttributes(v.attributes), "");
                  return (
                    <li key={v.id}>
                      <Link
                        href={`/admin/products/${v.product.id}/edit`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted"
                      >
                        <Thumb src={v.product.imageUrl} className="size-9" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{v.product.name}</span>
                          {label && <span className="block truncate text-xs text-muted-foreground">{label}</span>}
                        </span>
                        <StockBadge stock={v.stock} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.share.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <CopyText value={storeUrl} className="min-w-0" />
          <a
            href={`https://wa.me/?text=${encodeURIComponent(resolveMessage(t, encodeMessage("dashboard.share.whatsappText", tenant.name, storeUrl)))}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("dashboard.share.whatsapp")}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  hint,
  href,
  tone = "default",
  children,
}: {
  icon: typeof Package;
  label: string;
  hint: string;
  href?: string;
  tone?: "default" | "amber";
  children: React.ReactNode;
}) {
  const body = (
    <Card
      className={cn(
        "h-full transition-colors",
        href && "hover:border-foreground/20",
        tone === "amber" && "border-amber-300 dark:border-amber-800",
      )}
    >
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span
            className={cn(
              "grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground",
              tone === "amber" && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <div className="text-3xl font-semibold tabular-nums">{children}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

