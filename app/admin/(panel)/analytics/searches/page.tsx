import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { searchReport } from "@/lib/analytics/report";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { SearchesView } from "./searches-view";

/**
 * Analytics -> Searches (§5.6, P5-20): what shoppers asked for, and what they did not find.
 *
 * The rule that matters is the redacted row (D22, P4-12). Phase 4 flags a phrase that looked
 * like a phone number, an email or a card number and stores it as a single redacted bucket. It
 * still **counts** — leaving it out would understate how much searching happened — but it is
 * never suggested as demand: "your customers are looking for 03 123 456" is the kind of line
 * that costs a merchant their trust in the whole screen, and the person who typed it was not
 * shopping. `report.ts` already excludes it from `demand`; this page keeps the two apart on
 * screen too, under headings that say which is which.
 */
export default async function SearchesReportPage({
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
  const report = await searchReport(tenantId, range);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("searches.page.description")}</p>
        <PeriodPicker
          basePath="/admin/analytics/searches"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>
      <SearchesView
        totalSearches={report.totalSearches}
        rows={report.rows.map((row) => ({
          phrase: row.phrase,
          redacted: row.redacted,
          searches: row.searches,
          searchSessions: row.searchSessions,
          noResultSearches: row.noResultSearches,
          resultClickSessions: row.resultClickSessions,
          noResultRate: row.noResultRate,
        }))}
        demand={report.demand.map((row) => ({
          phrase: row.phrase,
          noResultSearches: row.noResultSearches,
          searches: row.searches,
        }))}
      />
    </div>
  );
}
