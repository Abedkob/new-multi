import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { InsightList } from "@/components/admin/analytics/insight-list";
import { SeriesTable } from "@/components/admin/analytics/series-table";
import { StatTile } from "@/components/admin/analytics/stat-tile";
import { lastNLocalDays } from "@/lib/analytics/compare";
import { buildInsights } from "@/lib/analytics/insights";
import { rangeFromPeriod } from "@/lib/analytics/range";
import {
  acquisitionReport,
  funnelReport,
  productReport,
  searchReport,
  storeOverview,
} from "@/lib/analytics/report";
import { activeVisitors } from "@/lib/analytics/presence";
import { rolloutIncludes } from "@/lib/analytics/rollout";
import { countConsentReceipts } from "@/lib/data/consent";
import { getTenantById } from "@/lib/data/tenants";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { FreshnessNote } from "./freshness-note";
import { LiveVisitors } from "./live-visitors";
import { NotMeasuring } from "./not-measuring";

/**
 * Analytics -> Overview (§5.1): the store's own period, and §6's insights beside it.
 *
 * What this page is careful about:
 *
 *   - **Order value and WhatsApp interest are two tiles, never one** (P5-03). They are
 *     deliberately not adjacent either: the money tiles sit together, and the WhatsApp pair sits
 *     under its own heading with the sentence that says what it is not.
 *   - **A small number is shown exactly** (P5-02), and a trend verdict only appears where
 *     `compare.ts` was willing to give one — with the sentence that produced it (P5-09).
 *   - **The insights come from one module** (lib/analytics/insights.ts) and the activity-shift
 *     insight re-uses the same trend reading as the tile above it, so the two cannot disagree.
 *
 * The month window is fetched because §6's `unnoticed-product` is defined over 30 days
 * regardless of the period on screen: a product nobody has seen this week is not news.
 */
export default async function AnalyticsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const { period } = await searchParams;
  const zone = tenant.analyticsTimezone;
  const { range, period: current } = rangeFromPeriod(period, zone);
  const monthRange = lastNLocalDays(30, new Date(), zone);

  // Sequential, deliberately. Each of these opens its own `withTenant` transaction (that is how
  // RLS context is set), and seven at once starved the pool on the first run of
  // verify:report-ui — "Unable to start a transaction in the given time", a 500 on the page.
  // An admin overview is not a hot path, and seven short round trips cost a merchant less than
  // seven connections cost every storefront request sharing the pool. The faster fix is one
  // transaction doing all seven reads, like `loadStorefrontData`; it needs report.ts's internals
  // to take a client, which is a refactor this screen does not need yet.
  const overview = await storeOverview(tenantId, range);
  const products = await productReport(tenantId, range);
  const funnel = await funnelReport(tenantId, range);
  const searches = await searchReport(tenantId, range);
  const sources = await acquisitionReport(tenantId, range);
  const monthProducts = await productReport(tenantId, monthRange);
  const monthOverview = await storeOverview(tenantId, monthRange);

  // Presence is Redis-backed and allowed to be unavailable (P5-27); a count of 0 and an
  // unreachable Redis are different claims, and the tile says which one it is.
  const presence = await activeVisitors(tenantId);

  const insights = buildInsights({
    products,
    monthProducts,
    monthSeries: monthOverview.series,
    series: overview.series,
    website: funnel.website,
    whatsapp: funnel.whatsapp,
    searches,
    sources,
    sessionTrend: overview.trends.sessions,
  });

  const { totals, deltas, rates, trends } = overview;

  // Nothing computed and nothing counted: the honest answer is not a grid of zeros (P5-25).
  // Checked on lastComputedAt rather than on the totals, because a store that really did have a
  // quiet week HAS been measured and should see its zeros as the fact they are.
  const measured = overview.lastComputedAt !== null || totals.sessions > 0;
  if (!measured) {
    return (
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FreshnessNote lastComputedAt={null} />
          <PeriodPicker
            basePath="/admin/analytics"
            current={current}
            ariaLabel={t("results.period.label")}
          />
        </div>
        <NotMeasuring
          inRollout={rolloutIncludes(tenant)}
          hasConsentReceipts={(await countConsentReceipts(tenantId)) > 0}
        />
        <LiveVisitors presence={presence} />
      </div>
    );
  }
  const verdict = (key: "sessions" | "orders" | "whatsappClicks") => {
    const reading = trends[key];
    return reading.verdict === "insufficient"
      ? undefined
      : { verdict: t(`reports.trend.${reading.verdict}`), evidence: reading.evidence };
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FreshnessNote lastComputedAt={overview.lastComputedAt?.toISOString() ?? null} />
        <PeriodPicker
          basePath="/admin/analytics"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t("overview.heading.traffic")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("overview.tile.sessions")}
            value={String(totals.sessions)}
            delta={deltas.sessions}
            trend={verdict("sessions")}
          />
          <StatTile
            label={t("overview.tile.visitorDays")}
            value={String(totals.visitorDays)}
            delta={deltas.visitorDays}
            hint={t("overview.tile.visitorDays.hint")}
          />
          <StatTile
            label={t("overview.tile.newVisitors")}
            value={String(totals.newVisitors)}
            delta={deltas.newVisitors}
            hint={
              rates.newVisitorShareOfVisitorDays === null
                ? undefined
                : `${(rates.newVisitorShareOfVisitorDays * 100).toFixed(1)}% ${t("overview.tile.newVisitors.hint")}`
            }
          />
          <StatTile
            label={t("overview.tile.searchSessions")}
            value={String(totals.searchSessions)}
            delta={deltas.searchSessions}
          />
          <LiveVisitors presence={presence} />
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t("overview.heading.orders")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("overview.tile.orders")}
            value={String(totals.orders)}
            delta={deltas.orders}
            trend={verdict("orders")}
          />
          <StatTile
            label={t("overview.tile.orderValue")}
            value={formatPrice(totals.orderValueCents)}
            delta={deltas.orderValueCents}
          />
          <StatTile
            label={t("overview.tile.conversion")}
            value={rates.conversionRate === null ? "—" : `${(rates.conversionRate * 100).toFixed(1)}%`}
            hint={rates.conversionRate === null ? t("overview.tile.conversion.none") : undefined}
          />
          <StatTile
            label={t("overview.tile.aov")}
            value={
              rates.averageOrderValueCents === null
                ? "—"
                : formatPrice(rates.averageOrderValueCents)
            }
            hint={rates.averageOrderValueCents === null ? t("overview.tile.aov.none") : undefined}
          />
        </div>
      </section>

      {/* Its own section, with the sentence that says what it is not. The WhatsApp figures are
          never placed in the money row above, and never added to anything in it (§3.4). */}
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t("overview.heading.whatsapp")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("overview.tile.whatsappClicks")}
            value={String(totals.whatsappClickSessions)}
            delta={deltas.whatsappClickSessions}
            trend={verdict("whatsappClicks")}
          />
          <StatTile
            label={t("overview.tile.whatsappValue")}
            value={formatPrice(totals.whatsappPotentialValueCents)}
            delta={deltas.whatsappPotentialValueCents}
            hint={t("overview.tile.whatsappValue.hint")}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("overview.whatsapp.note")}</p>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t("overview.heading.insights")}</h2>
        <InsightList insights={insights} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t("overview.heading.byDay")}</h2>
        <SeriesTable
          label={t("overview.series.label")}
          points={overview.series.map((point) => ({
            day: point.day,
            sessions: point.sessions,
            orders: point.orders,
          }))}
        />
      </section>
    </div>
  );
}
