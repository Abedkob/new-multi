import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { campaignResults } from "@/lib/analytics/report";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { listSavedCampaigns } from "@/lib/data/campaigns";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { ResultsTable } from "./results-table";

/**
 * Marketing -> Results (D38, P5-19): what the owner's own campaigns brought in.
 *
 * The line D38 draws is kept here literally. This page answers "what came of what I did" —
 * campaign by campaign — and it does not restate the channel view: that is Analytics ->
 * Acquisition, which arrives in the next commit and which this page will link to rather than
 * copy. Two screens that each add up their own sessions are two screens that come to disagree,
 * so every figure here comes from `campaignResults` in lib/analytics/report.ts, the same
 * function Campaigns reads.
 *
 * Three figures, kept apart (P5-19, §3.4):
 *
 *   - visits and orders, which are website facts;
 *   - order value, which is money someone actually owes;
 *   - WhatsApp clicks and their potential value, which is interest and nothing more.
 *
 * The last two are never added together anywhere in this codebase (P4-22 checks that), and they
 * are not added here either — they sit in their own columns, under their own heading.
 */
export default async function MarketingResultsPage({
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

  const [rows, saved] = await Promise.all([
    campaignResults(tenantId, range),
    listSavedCampaigns(tenantId, true),
  ]);
  // The owner's own name for a campaign, where they gave one. Everything else about this page
  // comes from the data, including campaigns nobody ever saved (P5-14).
  const names = new Map(saved.map((c) => [c.utmCampaign, c.name]));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("results.page.description")}</p>
        <PeriodPicker
          basePath="/admin/marketing/results"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>
      {/* The channel view lives in Analytics (D38). A link, not a second copy of it. */}
      <p className="text-sm">
        <Link
          href={`/admin/analytics/acquisition?period=${current}`}
          className="underline underline-offset-4"
        >
          {t("results.seeAcquisition")}
        </Link>
      </p>
      <ResultsTable
        rows={rows.map((row) => ({
          campaign: row.campaign,
          label: names.get(row.campaign) ?? row.campaign,
          sessions: row.sessions,
          visitorDays: row.visitorDays,
          orders: row.orders,
          orderValueCents: row.orderValueCents,
          whatsappClickSessions: row.whatsappClickSessions,
          whatsappPotentialValueCents: row.whatsappPotentialValueCents,
          conversionRate: row.conversionRate,
        }))}
      />
    </div>
  );
}
