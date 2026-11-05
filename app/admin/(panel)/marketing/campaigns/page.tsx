import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { listCampaignLines } from "@/lib/data/campaigns";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { CampaignTable } from "./campaign-table";

/**
 * Campaigns (D39): every campaign the owner saved, and every campaign the data saw.
 *
 * The two halves are deliberately different things, and the screen says which is which. A saved
 * campaign with no traffic shows zeros rather than being absent (P5-13) — the link you built a
 * minute ago is listed, with nothing yet, which is the truth and reads as working. A campaign
 * that only exists in the data is listed too (P5-14), because the visits happened whether or
 * not anyone wrote the name down.
 *
 * The numbers are `campaignResults`'s, the same function Marketing's Results uses (D38). One
 * figure, computed once: two places that each add up their own sessions are two places that
 * come to disagree.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  // The store's own zone and the one shared set of periods (lib/analytics/range.ts), so this
  // tab and Results cannot offer two different "last month"s.
  const { period } = await searchParams;
  const { range, period: current } = rangeFromPeriod(period, tenant.analyticsTimezone);
  const lines = await listCampaignLines(tenantId, range);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("campaigns.page.description")}</p>
        <PeriodPicker
          basePath="/admin/marketing/campaigns"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>
      <CampaignTable
        lines={lines.map((line) => ({
          utmCampaign: line.utmCampaign,
          label: line.label,
          savedId: line.saved?.id ?? null,
          channel: line.saved?.channel ?? null,
          archived: !!line.saved?.archivedAt,
          sessions: line.observed?.sessions ?? null,
          orders: line.observed?.orders ?? null,
          orderValueCents: line.observed?.orderValueCents ?? null,
        }))}
      />
    </div>
  );
}
