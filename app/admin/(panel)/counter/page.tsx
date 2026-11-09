import Link from "next/link";
import { Receipt } from "lucide-react";
import { notFound } from "next/navigation";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { SectionCard } from "@/components/admin/section-card";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusFilter, type StatusFilterTab } from "@/components/admin/status-filter";
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
  const tabs: StatusFilterTab[] = [
    { key: "ALL", label: t("counter.status.all"), count: all, href: "/admin/counter" },
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
        <SectionCard
          className="border-dashed"
          title={t("counter.disabled.title")}
          description={t("counter.disabled.body")}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label={t("counter.takings.total")} value={formatPrice(takings.totalCents)} />
        <StatTile label={t("counter.takings.cash")} value={formatPrice(takings.cashCents)} />
        <StatTile label={t("counter.takings.card")} value={formatPrice(takings.cardCents)} />
        <StatTile label={t("counter.takings.sales")} value={String(takings.saleCount)} />
        <StatTile
          label={t("counter.takings.discounts")}
          value={formatPrice(takings.manualDiscountCents)}
        />
      </div>

      <StatusFilter
        tabs={tabs}
        current={current}
        ariaLabel={t("counter.page.filterAriaLabel")}
      />

      {sales.length === 0 ? (
        <SectionCard bodyClassName="p-0">
          <EmptyState
            icon={Receipt}
            title={t("counter.page.empty")}
            action={
              canSell ? (
                <Link href="/admin/counter/new" className={buttonVariants()}>
                  {t("counter.page.newSale")}
                </Link>
              ) : undefined
            }
          />
        </SectionCard>
      ) : (
        <>
          <SectionCard bodyClassName="p-0">
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
          </SectionCard>

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

