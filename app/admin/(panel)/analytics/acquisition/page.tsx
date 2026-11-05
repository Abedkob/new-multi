import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { acquisitionReport, type AttributionBasis } from "@/lib/analytics/report";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { AcquisitionTable } from "./acquisition-table";

/**
 * Analytics -> Acquisition (§5.5, P5-19): where the traffic came from, and what it did.
 *
 * The channel view lives here and only here (D38). Marketing's Results answers "what came of my
 * campaigns" from the same `report.ts` functions and links to this page for the full picture,
 * rather than keeping its own copy of it.
 *
 * `?basis=first` switches which touch gets the credit. Both are stored per source by the
 * recompute, so this is a read of a different column and not a re-apportionment: nothing on this
 * page divides a store-wide total between sources (D48). Last touch is the default because it is
 * the one a merchant means by "where did this order come from".
 */
export default async function AcquisitionReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; basis?: string }>;
}) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const { period, basis } = await searchParams;
  const { range, period: current } = rangeFromPeriod(period, tenant.analyticsTimezone);
  const attribution: AttributionBasis = basis === "first" ? "first" : "last";
  const rows = await acquisitionReport(tenantId, range, attribution);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("acquisition.page.description")}
        </p>
        <PeriodPicker
          basePath="/admin/analytics/acquisition"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>

      <nav aria-label={t("acquisition.basis.label")} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("acquisition.basis.label")}:</span>
        {(["last", "first"] as const).map((option) => (
          <Link
            key={option}
            href={`/admin/analytics/acquisition?period=${current}&basis=${option}`}
            aria-current={option === attribution ? "true" : undefined}
            className={
              option === attribution
                ? "rounded-md border border-primary bg-primary/10 px-3 py-1.5 font-medium"
                : "rounded-md border border-input px-3 py-1.5 text-muted-foreground"
            }
          >
            {t(option === "last" ? "acquisition.basis.last" : "acquisition.basis.first")}
          </Link>
        ))}
      </nav>

      <AcquisitionTable
        basis={attribution}
        rows={rows.map((row) => ({
          key: `${row.sourceKind}|${row.source}|${row.medium}|${row.campaign}`,
          sourceKind: row.sourceKind,
          source: row.source,
          medium: row.medium,
          campaign: row.campaign,
          sessions: row.sessions,
          visitorDays: row.visitorDays,
          orders: row.orders,
          orderValueCents: row.orderValueCents,
          whatsappClickSessions: row.whatsappClickSessions,
          conversionRate: row.conversionRate,
        }))}
      />
    </div>
  );
}
