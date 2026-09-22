import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeScope } from "@/components/theme-scope";
import { CartProvider } from "@/lib/cart/cart";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { parseThemeOverrides, resolveTheme } from "@/lib/theme";
import { StorefrontShell } from "@/templates/render";
import { getTemplate } from "@/templates";
import { TEMPLATE_META, normalizeTemplateId } from "@/templates/meta";

// Plain SSR: always render per request.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: LayoutProps<"/store/[slug]">): Promise<Metadata> {
  const tenant = await loadTenant((await params).slug);
  return tenant ? { title: tenant.name } : {};
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

  // Colors are injected as CSS variables at the storefront root; templates only consume them.
  return (
    <ThemeScope colors={colors} className="min-h-screen">
      {/* The cart lives in React state here; this layout stays mounted across page navigations. */}
      <CartProvider>
        <StorefrontShell template={getTemplate(templateId)} data={data}>
          {children}
        </StorefrontShell>
      </CartProvider>
    </ThemeScope>
  );
}
