import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeScope } from "@/components/theme-scope";
import { StoreAnalytics } from "@/lib/analytics";
import { CartProvider } from "@/lib/cart/cart";
import { letterFavicon } from "@/lib/favicon";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { storeIntegrations } from "@/lib/integrations";
import { pageMeta, storeDescription, storeImage } from "@/lib/seo";
import { parseThemeFonts } from "@/lib/fonts";
import { parseThemeOverrides, resolveTheme } from "@/lib/theme";
import { StorefrontShell } from "@/templates/render";
import { getTemplate } from "@/templates";
import { TEMPLATE_META, normalizeTemplateId } from "@/templates/meta";

// Plain SSR: always render per request.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: LayoutProps<"/store/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) return {};
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
    // Search Console (HTML-tag method) and Meta Business domain verification, set by the
    // platform admin. Emitted on every storefront page, which includes the home page they check.
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
  const [tenant, data] = await Promise.all([
    loadTenant(slug),
    loadStorefrontData(slug),
  ]);
  if (!tenant || !data) notFound();

  const templateId = normalizeTemplateId(tenant.templateId);
  const colors = resolveTheme(
    TEMPLATE_META[templateId].defaults,
    parseThemeOverrides(tenant.themeOverrides),
  );

  const shell = (
    // The cart lives in React state here; this layout stays mounted across page navigations.
    <CartProvider>
      <StorefrontShell template={getTemplate(templateId)} data={data}>
        {children}
      </StorefrontShell>
    </CartProvider>
  );
  const { analytics, hasAnalytics } = storeIntegrations(tenant);

  // Colors are injected as CSS variables at the storefront root; templates only consume them.
  // Analytics wraps only the real storefront (this layout) — the admin preview iframes render
  // templates without it, so previewing never sends data into the store's analytics.
  return (
    <ThemeScope colors={colors} fonts={parseThemeFonts(tenant.themeOverrides)} className="min-h-screen">
      {hasAnalytics ? <StoreAnalytics config={analytics}>{shell}</StoreAnalytics> : shell}
    </ThemeScope>
  );
}
