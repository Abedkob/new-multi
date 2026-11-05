import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { productReport } from "@/lib/analytics/report";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { ProductsTable } from "./products-table";

/**
 * Analytics -> Products (§5.3, P5-07).
 *
 * The one rule with teeth here is the deleted product. A product's rows outlive it — the views
 * and orders happened — and the recompute snapshots the name it carried that day (D44). So a
 * deleted product reads as the name a merchant will recognise, with a label saying it is gone.
 * The two alternatives are both worse: an empty name, or a row keyed by an id nobody can read.
 */
export default async function ProductsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const { period } = await searchParams;
  const { range, period: current } = rangeFromPeriod(period, tenant.analyticsTimezone);
  const rows = await productReport(tenantId, range);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("productsReport.page.description")}</p>
        <PeriodPicker
          basePath="/admin/analytics/products"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>
      <ProductsTable
        rows={rows.map((row) => ({
          productId: row.productId,
          productName: row.productName,
          viewSessions: row.viewSessions,
          viewerDays: row.viewerDays,
          returningViewerDays: row.returningViewerDays,
          addToCartSessions: row.addToCartSessions,
          whatsappClickSessions: row.whatsappClickSessions,
          purchasingSessions: row.purchasingSessions,
          unitsOrdered: row.unitsOrdered,
          orderValueCents: row.orderValueCents,
          conversionRate: row.conversionRate,
        }))}
      />
    </div>
  );
}
