import { cache } from "react";
import { listCategories } from "@/lib/data/categories";
import { getContentMap } from "@/lib/data/content";
import { listBestSellers, listNewArrivals } from "@/lib/data/products";
import { getTenantBySlug } from "@/lib/data/tenants";
import { prisma } from "@/lib/prisma";
import { buildStorefrontData } from "@/lib/storefront-data";
import { toStoreProduct } from "@/lib/store-product";

// Layout and page both need the tenant/data for a request; cache() dedupes within one
// render only (not across requests), so this stays plain SSR.
/** Light query: which photo belongs to which category (newest products first). */
export function listCategoryProductImages(tenantId: string) {
  return prisma.product.findMany({
    where: { tenantId, categoryId: { not: null }, imageUrl: { not: "" } },
    orderBy: { createdAt: "desc" },
    select: { categoryId: true, imageUrl: true },
  });
}

export const loadTenant = cache((slug: string) => getTenantBySlug(slug));

export const loadStorefrontData = cache(async (slug: string) => {
  const tenant = await loadTenant(slug);
  if (!tenant) return null;
  const [content, newArrivals, bestSellers, categories, categoryProductImages] = await Promise.all([
    getContentMap(tenant.id),
    listNewArrivals(tenant.id),
    listBestSellers(tenant.id),
    listCategories(tenant.id),
    listCategoryProductImages(tenant.id),
  ]);
  return buildStorefrontData({
    store: { name: tenant.name, slug: tenant.slug },
    content,
    sectionVisibility: tenant.sectionVisibility,
    newArrivals: newArrivals.map(toStoreProduct),
    bestSellers: bestSellers.map(toStoreProduct),
    categories,
    categoryProductImages,
  });
});
