import { cache } from "react";
import { notFound } from "next/navigation";
import { getTenantForAdmin } from "@/lib/data/tenants";
import { storeIntegrations } from "@/lib/integrations";
import { requirePlatformAdmin } from "@/lib/session";

/**
 * The store for every page under this sidebar layout. Deduped per request with cache(), so the
 * layout and the page share one query. Re-checks the platform admin role itself, so no page
 * here depends on the layout having run first.
 */
export const loadStore = cache(async (slug: string) => {
  await requirePlatformAdmin();
  const tenant = await getTenantForAdmin(slug);
  if (!tenant) notFound();
  return tenant;
});

/** What's set up and what isn't, for the sidebar dots and the overview checklist. */
export function setupStatus(tenant: Awaited<ReturnType<typeof loadStore>>) {
  const i = storeIntegrations(tenant);
  return {
    domain: !!tenant.domain,
    // A DNS-TXT-verified Search Console property leaves nothing to store here, so this can only
    // say "the HTML-tag token is set"; the checklist wording accounts for that.
    searchConsoleTag: !!i.googleSiteVerification,
    ga: !!i.analytics.gaId,
    ads: !!(i.analytics.adsId && i.analytics.adsPurchaseLabel),
    metaPixel: !!i.analytics.metaPixelId,
    metaDomain: !!i.metaDomainVerification,
  };
}
