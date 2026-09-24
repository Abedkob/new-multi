import { notFound } from "next/navigation";
import { listCategories } from "@/lib/data/categories";
import { listContentRows } from "@/lib/data/content";
import { listBestSellers, listNewArrivals } from "@/lib/data/products";
import { listCategoryProductImages } from "@/lib/data/storefront";
import { getTenantById } from "@/lib/data/tenants";
import { parseSectionVisibility } from "@/lib/sections";
import { requireOwner } from "@/lib/session";
import { toStoreProduct } from "@/lib/store-product";
import { parseThemeFonts } from "@/lib/fonts";
import { parseThemeOverrides, resolveTheme } from "@/lib/theme";
import { TEMPLATE_META, normalizeTemplateId } from "@/templates/meta";
import { LivePreview } from "./live-preview";

export const dynamic = "force-dynamic";

/**
 * The store owner's live preview, shown inside the content editor's iframe. It is the
 * owner's own storefront (tenant from the session, never from the URL) with their saved
 * template and colors; the editor streams unsaved text into it.
 */
export default async function OwnerPreviewPage() {
  const { tenantId } = await requireOwner();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const [rows, newArrivals, bestSellers, categories, categoryProductImages] = await Promise.all([
    listContentRows(tenantId),
    listNewArrivals(tenantId),
    listBestSellers(tenantId),
    listCategories(tenantId),
    listCategoryProductImages(tenantId),
  ]);
  const templateId = normalizeTemplateId(tenant.templateId);

  return (
    <LivePreview
      // Always path-based here, regardless of tenant.domain: this preview is only ever rendered
      // inside the /admin/preview iframe on the platform's own host, never on the store's real
      // domain, so its links need the /store/[slug] prefix even for a store that already has one.
      store={{ name: tenant.name, slug: tenant.slug, basePath: `/store/${tenant.slug}` }}
      templateId={templateId}
      colors={resolveTheme(
        TEMPLATE_META[templateId].defaults,
        parseThemeOverrides(tenant.themeOverrides),
      )}
      fonts={parseThemeFonts(tenant.themeOverrides)}
      storedValues={Object.fromEntries(rows.map((r) => [r.key, r.value]))}
      visibility={parseSectionVisibility(tenant.sectionVisibility)}
      newArrivals={newArrivals.map(toStoreProduct)}
      bestSellers={bestSellers.map(toStoreProduct)}
      categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, imageUrl: c.imageUrl }))}
      categoryProductImages={categoryProductImages}
      socialLinks={tenant}
    />
  );
}
