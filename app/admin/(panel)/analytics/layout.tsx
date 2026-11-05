import { PageHeader } from "@/components/admin/page-header";
import { SectionTabs, type SectionTab } from "@/components/admin/section-tabs";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";

/**
 * The Analytics section: what happened in the store (D38).
 *
 * The other half of the line D38 draws. Marketing is what the owner did to bring people in;
 * this is what those people did once they arrived. The campaign figure that belongs to both
 * screens is computed once in lib/analytics/report.ts and Marketing's Results links here
 * rather than restating the channel view.
 *
 * `requireOwner` here as well as in each page: a layout runs for every route beneath it, but a
 * Server Action imported by one of those pages does not go through it.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  const t = await getT();

  const tabs: SectionTab[] = [
    { href: "/admin/analytics", label: t("analytics.tab.overview"), exact: true },
    { href: "/admin/analytics/products", label: t("analytics.tab.products") },
    { href: "/admin/analytics/funnel", label: t("analytics.tab.funnel") },
    { href: "/admin/analytics/acquisition", label: t("analytics.tab.acquisition") },
    { href: "/admin/analytics/searches", label: t("analytics.tab.searches") },
    { href: "/admin/analytics/heatmap", label: t("analytics.tab.heatmap") },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader title={t("analytics.page.title")} description={t("analytics.page.description")} />
      <SectionTabs tabs={tabs} ariaLabel={t("analytics.page.title")} />
      <div className="pt-2">{children}</div>
    </div>
  );
}
