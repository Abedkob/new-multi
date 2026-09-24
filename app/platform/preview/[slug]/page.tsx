import { notFound } from "next/navigation";
import { ThemeScope } from "@/components/theme-scope";
import { getContentMap } from "@/lib/data/content";
import {
  listBestSellers,
  listNewArrivals,
  listRelatedProducts,
} from "@/lib/data/products";
import { listCategories } from "@/lib/data/categories";
import { listCategoryProductImages } from "@/lib/data/storefront";
import { getTenantBySlug } from "@/lib/data/tenants";
import { requirePlatformAdmin } from "@/lib/session";
import { buildStorefrontData } from "@/lib/storefront-data";
import { toStoreProduct } from "@/lib/store-product";
import { parseThemeFonts } from "@/lib/fonts";
import { parseThemeOverrides, resolveTheme } from "@/lib/theme";
import { getTemplate } from "@/templates";
import { TEMPLATE_META, isTemplateId, normalizeTemplateId } from "@/templates/meta";
import { HomeSections, StorefrontShell } from "@/templates/render";
import { PreviewBridge } from "./preview-bridge";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The store rendered exactly as the public storefront does (real content, products and
 * section visibility), but with no site chrome and with the template chosen in the theme
 * editor's query string. Platform admin only (proxy.ts + requirePlatformAdmin).
 */
export default async function StorePreviewPage({
  params,
  searchParams,
}: PageProps<"/platform/preview/[slug]">) {
  await requirePlatformAdmin();
  const { slug } = await params;
  const sp = await searchParams;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const requested = first(sp.template);
  const templateId =
    requested && isTemplateId(requested) ? requested : normalizeTemplateId(tenant.templateId);
  const view = first(sp.view) === "product" ? "product" : "home";

  const [content, newArrivals, bestSellers, categories, categoryProductImages] = await Promise.all([
    getContentMap(tenant.id),
    listNewArrivals(tenant.id),
    listBestSellers(tenant.id),
    listCategories(tenant.id),
    listCategoryProductImages(tenant.id),
  ]);
  const data = buildStorefrontData({
    // Always path-based, regardless of tenant.domain: this preview only ever renders inside the
    // platform admin's own preview iframe, never on the store's real domain.
    store: { name: tenant.name, slug: tenant.slug, basePath: `/store/${tenant.slug}` },
    content,
    sectionVisibility: tenant.sectionVisibility,
    newArrivals: newArrivals.map(toStoreProduct),
    bestSellers: bestSellers.map(toStoreProduct),
    categories,
    categoryProductImages,
    socialLinks: tenant,
  });
  const product = data.newArrivals[0];
  const related = product
    ? (await listRelatedProducts(tenant.id, product.id)).map(toStoreProduct)
    : [];
  const template = getTemplate(templateId);

  // Saved colors on first paint; the editor then sends any unsaved ones via PreviewBridge.
  const colors = resolveTheme(
    TEMPLATE_META[templateId].defaults,
    parseThemeOverrides(tenant.themeOverrides),
  );

  return (
    <ThemeScope colors={colors} fonts={parseThemeFonts(tenant.themeOverrides)} className="min-h-screen">
      <PreviewBridge />
      <StorefrontShell template={template} data={data}>
        {view === "product" && product ? (
          <template.ProductPage data={data} product={product} related={related} />
        ) : (
          <HomeSections template={template} data={data} />
        )}
      </StorefrontShell>
    </ThemeScope>
  );
}
