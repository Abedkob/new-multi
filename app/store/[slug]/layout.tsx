import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageViewTracker } from "@/components/analytics/page-view";
import { AnalyticsTracker } from "@/components/analytics/tracker";
import { ConsentProvider } from "@/components/consent/consent-provider";
import { ThemeScope } from "@/components/theme-scope";
import { StoreAnalytics } from "@/lib/analytics";
import { CartProvider } from "@/lib/cart/cart";
import { rolloutIncludes } from "@/lib/analytics/rollout";
import { mintBootstrapToken } from "@/lib/analytics/token";
import { readStoreConsent } from "@/lib/consent/read";
import { getStoreBasePath } from "@/lib/store-url";
import { letterFavicon } from "@/lib/favicon";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { grantedConfig, storeIntegrations } from "@/lib/integrations";
import { pageMeta, storeDescription, storeImage } from "@/lib/seo";
import { parseThemeFonts } from "@/lib/fonts";
import { parseThemeOverrides, resolveTheme } from "@/lib/theme";
import { StorefrontShell } from "@/templates/render";
import { getTemplate } from "@/templates";
import { TEMPLATE_META, normalizeTemplateId } from "@/templates/meta";
import { canServeTenant } from "@/lib/license/status";

// Plain SSR: always render per request.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: LayoutProps<"/store/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) return {};
  if (!canServeTenant(tenant)) {
    return {
      title: `${tenant.name} temporarily unavailable`,
      robots: { index: false, follow: false },
    };
  }
  const data = await loadStorefrontData(slug);
  if (!data) return {};
  const { googleSiteVerification, metaDomainVerification } = storeIntegrations(tenant);
  // Set by the platform admin (Branding); otherwise a letter icon in the store's primary color.
  const favicon =
    tenant.faviconUrl ||
    letterFavicon(
      tenant.name,
      resolveTheme(
        TEMPLATE_META[normalizeTemplateId(tenant.templateId)].defaults,
        parseThemeOverrides(tenant.themeOverrides),
      ).primaryColor,
    );
  return {
    // Defaults for every storefront page (pages override what they know better). Without a
    // description here, pages inherited the platform's root-layout one.
    ...pageMeta({
      tenant,
      description: storeDescription(tenant.name, data.content),
      images: [storeImage(data.content)],
    }),
    // Child pages set just their own title ("Linen Shirt"); the template adds the store name.
    title: { default: tenant.name, template: `%s | ${tenant.name}` },
    icons: { icon: favicon, apple: tenant.faviconUrl || undefined },
    // Search Console (HTML-tag method) and Meta Business domain verification, set by the owner
    // in Marketing > Integrations or by a platform admin. Emitted on every storefront page,
    // which includes the home page they check — and for every visitor, consent or not (D40a):
    // these prove who owns the domain, set no cookie and identify the site rather than the
    // reader, so withholding them from someone who declined would break verification for a
    // share of visitors while protecting none of them.
    verification: {
      ...(googleSiteVerification ? { google: googleSiteVerification } : {}),
      ...(metaDomainVerification
        ? { other: { "facebook-domain-verification": metaDomainVerification } }
        : {}),
    },
  };
}

export default async function StoreLayout({
  children,
  params,
}: LayoutProps<"/store/[slug]">) {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) notFound();

  if (!canServeTenant(tenant)) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 py-16 text-center">
        <div className="grid max-w-lg gap-3">
          <h1 className="text-2xl font-semibold">This store is temporarily unavailable</h1>
          <p className="text-muted-foreground">Please check back later.</p>
        </div>
      </main>
    );
  }

  const data = await loadStorefrontData(slug);
  if (!data) notFound();

  const templateId = normalizeTemplateId(tenant.templateId);
  const colors = resolveTheme(
    TEMPLATE_META[templateId].defaults,
    parseThemeOverrides(tenant.themeOverrides),
  );

  // Decoded from the store's own signed cookie. Undecided means "ask", and until a visitor has
  // answered, nothing non-essential runs — see StoreAnalytics below, which is only given the
  // categories this decision actually granted.
  const consent = await readStoreConsent(tenant);

  // First-party collection needs BOTH: the visitor granted analytics, and this store is inside
  // the rollout. Consent alone is not enough (a store may not be switched on yet) and rollout
  // alone is never enough (that would be collecting without permission).
  const collecting = consent.grants.analytics && rolloutIncludes(tenant);

  const inner = (
    // The cart lives in React state here; this layout stays mounted across page navigations.
    <CartProvider>
      <StorefrontShell template={getTemplate(templateId)} data={data}>
        {children}
      </StorefrontShell>
    </CartProvider>
  );

  // Mounted only while collecting, so withdrawing consent unmounts the tracker and its queued
  // events die with it rather than being flushed after the visitor said no.
  const shell = collecting ? (
    <AnalyticsTracker basePath={getStoreBasePath(tenant)} token={mintBootstrapToken(tenant.id)}>
      <PageViewTracker basePath={getStoreBasePath(tenant)} />
      {inner}
    </AnalyticsTracker>
  ) : (
    inner
  );
  const { analytics, hasAnalytics } = storeIntegrations(tenant);

  // Colors are injected as CSS variables at the storefront root; templates only consume them.
  // Analytics wraps only the real storefront (this layout) — the admin preview iframes render
  // templates without it, so previewing never sends data into the store's analytics.
  return (
    <ThemeScope colors={colors} fonts={parseThemeFonts(tenant.themeOverrides)} className="min-h-screen">
      <ConsentProvider
        slug={tenant.slug}
        storeName={tenant.name}
        privacyHref={`${getStoreBasePath(tenant)}/privacy`}
        initialState={consent}
      >
        {hasAnalytics ? (
          // The ids are narrowed to the consented ones HERE, on the server, before they are
          // serialized into the page. StoreAnalytics narrows them again for its own sake, but
          // doing it only there left a declining visitor's page carrying the pixel id in its
          // props — no request, no tracking, and still an id the browser was never meant to
          // receive, waiting for the first piece of code that reads `config` instead of the
          // granted one. Found by verify:integrations (P5-16).
          <StoreAnalytics config={grantedConfig(analytics, consent.grants)} grants={consent.grants}>
            {shell}
          </StoreAnalytics>
        ) : (
          shell
        )}
      </ConsentProvider>
    </ThemeScope>
  );
}
