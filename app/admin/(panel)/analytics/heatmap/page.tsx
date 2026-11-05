import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { activityHeatmap, type HeatmapMeasure } from "@/lib/analytics/report";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { HeatmapGrid } from "./heatmap-grid";

const MEASURES: HeatmapMeasure[] = ["sessions", "orders", "orderValueCents"];

/**
 * Analytics -> Heatmap (§5.7): when the store is busy, in the store's own clock.
 *
 * One measure at a time, chosen in the URL. A grid shaded by sessions and labelled with orders
 * is read as whichever the reader expected, so `activityHeatmap` takes one measure and this page
 * never draws two.
 *
 * An hour with no row is an hour that was never recorded — including the hour a spring-forward
 * day skipped entirely — and renders as blank rather than as a zero that reads as a dead hour.
 */
export default async function HeatmapReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; measure?: string }>;
}) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const { period, measure } = await searchParams;
  const { range, period: current } = rangeFromPeriod(period, tenant.analyticsTimezone);
  const chosen: HeatmapMeasure = MEASURES.includes(measure as HeatmapMeasure)
    ? (measure as HeatmapMeasure)
    : "sessions";
  const cells = await activityHeatmap(tenantId, range, chosen);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("heatmap.page.description")}</p>
        <PeriodPicker
          basePath="/admin/analytics/heatmap"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>

      <nav aria-label={t("heatmap.measure.label")} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("heatmap.measure.label")}:</span>
        {MEASURES.map((option) => (
          <Link
            key={option}
            href={`/admin/analytics/heatmap?period=${current}&measure=${option}`}
            aria-current={option === chosen ? "true" : undefined}
            className={
              option === chosen
                ? "rounded-md border border-primary bg-primary/10 px-3 py-1.5 font-medium"
                : "rounded-md border border-input px-3 py-1.5 text-muted-foreground"
            }
          >
            {t(
              option === "sessions"
                ? "heatmap.measure.sessions"
                : option === "orders"
                  ? "heatmap.measure.orders"
                  : "heatmap.measure.orderValue",
            )}
          </Link>
        ))}
      </nav>

      <HeatmapGrid cells={cells} measure={chosen} timeZone={tenant.analyticsTimezone} />
    </div>
  );
}
