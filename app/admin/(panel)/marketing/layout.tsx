import { PageHeader } from "@/components/admin/page-header";
import { SectionTabs, type SectionTab } from "@/components/admin/section-tabs";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";

/**
 * The Marketing section (D38): what the owner DOES to get traffic, and what came of it.
 *
 * The line against Analytics is drawn in D38 — Analytics is what happened in the store,
 * Marketing is what the owner did about it. The shared number, a campaign's sessions and
 * orders, is computed once in `lib/analytics/report.ts` and Results links through to
 * Acquisition rather than restating the channel view. Two homes for one figure is how two
 * screens come to disagree.
 *
 * `requireCapability` here as well as in each page, not instead of: a layout runs for every route
 * beneath it, but a Server Action imported by one of those pages does not go through it. Every
 * action re-checks on its own.
 *
 * All four tabs exist now. Results is first, and the section index redirects to it, because
 * "what came of it" is what an owner opens Marketing to find out.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireCapability("marketing:read");
  const t = await getT();

  const tabs: SectionTab[] = [
    { href: "/admin/marketing/results", label: t("marketing.tab.results") },
    { href: "/admin/marketing/campaigns", label: t("marketing.tab.campaigns") },
    { href: "/admin/marketing/links", label: t("marketing.tab.links") },
    { href: "/admin/marketing/integrations", label: t("marketing.tab.integrations") },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader title={t("marketing.page.title")} description={t("marketing.page.description")} />
      <SectionTabs tabs={tabs} ariaLabel={t("marketing.page.title")} />
      <div className="pt-2">{children}</div>
    </div>
  );
}
