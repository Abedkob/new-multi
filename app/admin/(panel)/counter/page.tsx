import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import {
  canSellAtCounter,
  counterSaleRef,
  counterSaleTotal,
  hasCounterSaleHistory,
  COUNTER_SALE_STATUSES,
  type CounterSaleStatusValue,
} from "@/lib/counter-sales";
import { getCounterTakings, listCounterSalesPage } from "@/lib/data/counter-sales";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getTenantById } from "@/lib/data/tenants";
import { localDayOf, localDayRange } from "@/lib/analytics/local-day";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * The till's history and today's takings.
 *
 * Readable whenever this store has EVER had a till — not only while the switch is on. Turning
 * the feature off stops new sales; hiding the receipts a store already recorded would be a
 * different and much worse thing.
 */
export default async function CounterSalesPage({
  searchParams,
}: PageProps<"/admin/counter">) {
  const { tenantId } = await requireCapability("counter:read");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant || !hasCounterSaleHistory(tenant)) notFound();

  const license = await getLicenseAccessSnapshot(tenantId);
  const canSell = canSellAtCounter({ ...tenant, license });

  const sp = await searchParams;
  const requested = Number.parseInt(first(sp.page) ?? "1", 10) || 1;
  const requestedPageSize = Number.parseInt(first(sp.perPage) ?? "25", 10) || 25;
  const status = COUNTER_SALE_STATUSES.find((s) => s === first(sp.status));

  // "Today" in the store's own zone, through the same pure helpers the reports use, so the
  // figure agrees with every other date the owner sees. This is the only place the till touches
  // lib/analytics, and it is a date boundary — never the rollout gate.
  const today = localDayRange(
    localDayOf(new Date(), tenant.analyticsTimezone),
    tenant.analyticsTimezone,
  );
  const [takings, listing] = await Promise.all([
    getCounterTakings(tenantId, { from: today.start, to: today.end }),
    listCounterSalesPage(tenantId, requested, status, requestedPageSize),
  ]);
  const { items: sales, total, page, pages, pageSize, counts } = listing;

  const countOf = (value: CounterSaleStatusValue) =>
    counts.find((row) => row.status === value)?._count._all ?? 0;
  const all = COUNTER_SALE_STATUSES.reduce((n, s) => n + countOf(s), 0);
  const tabs = [
    { key: "ALL" as const, label: t("counter.status.all"), count: all, href: "/admin/counter" },
    ...COUNTER_SALE_STATUSES.map((s) => ({
      key: s,
      label: t(`counter.status.${s}` as const),
      count: countOf(s),
      href: `/admin/counter?status=${s}`,
    })),
  ];
  const current = status ?? "ALL";

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("counter.page.title")}
        description={t("counter.page.description")}
        actions={
          canSell ? (
            <Link href="/admin/counter/new" className={buttonVariants()}>
              {t("counter.page.newSale")}
            </Link>
          ) : undefined
        }
      />

      {!canSell && (
        <div className="grid gap-1 rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">{t("counter.disabled.title")}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("counter.disabled.body")}</p>
        </div>
      )}

      <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Figure label={t("counter.takings.total")} value={formatPrice(takings.totalCents)} large />
        <Figure label={t("counter.takings.cash")} value={formatPrice(takings.cashCents)} />
        <Figure label={t("counter.takings.card")} value={formatPrice(takings.cardCents)} />
        <Figure label={t("counter.takings.sales")} value={String(takings.saleCount)} />
        <Figure
          label={t("counter.takings.discounts")}
          value={formatPrice(takings.manualDiscountCents)}
        />
      </section>

      <nav
        aria-label={t("counter.page.filterAriaLabel")}
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === current ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
              tab.key === current ? "bg-foreground text-background" : "text-muted-foreground"
            }`}
          >
            {tab.label} ({tab.count})
          </Link>
        ))}
      </nav>

      {sales.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t("counter.page.empty")}
        </p>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("counter.table.ref")}</TableHead>
                  <TableHead>{t("counter.table.when")}</TableHead>
                  <TableHead>{t("counter.table.seller")}</TableHead>
                  <TableHead>{t("counter.table.payment")}</TableHead>
                  <TableHead>{t("counter.table.total")}</TableHead>
                  <TableHead>{t("counter.table.status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => {
                  const reduced = sale.items.some((i) => i.manualDiscountCentsSnapshot > 0);
                  return (
                    <TableRow key={sale.id}>
                      <TableCell className="font-medium">{counterSaleRef(sale.id)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {sale.createdAt.toLocaleString()}
                      </TableCell>
                      <TableCell>{sale.soldByNameSnapshot}</TableCell>
                      <TableCell>{t(`counter.payment.${sale.payment}` as const)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatPrice(counterSaleTotal(sale.items))}
                        {reduced && (
                          <Badge variant="secondary" className="ms-2">
                            {t("counter.table.reduced")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sale.status === "VOIDED" ? "outline" : "secondary"}>
                          {t(`counter.status.${sale.status}` as const)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <Link
                          href={`/admin/counter/${sale.id}`}
                          className="text-sm underline underline-offset-4"
                        >
                          {t("counter.table.view")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <AdminPageSizeControl
              page={page}
              pageSize={pageSize}
              total={total}
              noun={t("counter.page.title")}
            />
            <AdminPagination
              basePath="/admin/counter"
              page={page}
              pages={pages}
              total={total}
              noun={t("counter.page.title")}
              params={status ? { status } : {}}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Figure({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${large ? "text-2xl font-semibold" : "text-lg"}`}>
        {value}
      </span>
    </div>
  );
}
