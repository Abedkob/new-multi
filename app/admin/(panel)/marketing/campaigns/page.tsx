import { notFound } from "next/navigation";
import { listCampaignLines } from "@/lib/data/campaigns";
import { lastNLocalDays } from "@/lib/analytics/compare";
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
export default async function CampaignsPage() {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  // The store's own zone, like every other report: 28 local days ending today. A fixed window
  // for now — the range picker arrives with the reports in a later commit, and both will read
  // it from the same place rather than each holding their own default.
  const range = lastNLocalDays(28, new Date(), tenant.analyticsTimezone);
  const lines = await listCampaignLines(tenantId, range);

  return (
    <div className="grid gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("campaigns.page.description")}</p>
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
