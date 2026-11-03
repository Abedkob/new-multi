import { cache } from "react";
import { categoriesQuery, getCategoryBySlug } from "@/lib/data/categories";
import { contentRowsQuery } from "@/lib/data/content";
import { bestSellersQuery, getProductBySlug, newArrivalsQuery } from "@/lib/data/products";
import { getTenantBySlug } from "@/lib/data/tenants";
import { resolveContent } from "@/lib/content";
import { withTenant, type TxClient } from "@/lib/prisma";
import { buildStorefrontData } from "@/lib/storefront-data";
import { getStoreBasePath } from "@/lib/store-url";
import { toStoreProduct } from "@/lib/store-product";
import { couponStatus } from "@/lib/pricing";

// Runs on a transaction the caller already opened (see loadStorefrontData).
// Only the newest photo of each category (DISTINCT ON), newest first overall — one row per
// category rather than one per product, since this runs on every storefront page load and (in
// the admin preview) is sent to the browser. Picking the newest across a category tree from
// these rows gives the same answer as scanning every product.
async function categoryProductImagesQuery(db: TxClient, tenantId: string) {
  const rows = await db.$queryRaw<{ categoryId: string; imageUrl: string; createdAt: Date }[]>`
    SELECT DISTINCT ON ("categoryId") "categoryId", "imageUrl", "createdAt"
    FROM "Product"
    WHERE "tenantId" = ${tenantId} AND "categoryId" IS NOT NULL AND "imageUrl" <> ''
    ORDER BY "categoryId", "createdAt" DESC`;
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ categoryId, imageUrl }) => ({ categoryId, imageUrl }));
}

// Layout and page both need the tenant/data for a request; cache() dedupes within one
// render only (not across requests), so this stays plain SSR.
/** Light query: which photo belongs to which category (newest products first). */
export function listCategoryProductImages(tenantId: string) {
  return withTenant(tenantId, (db) => categoryProductImagesQuery(db, tenantId));
}

export const loadTenant = cache((slug: string) => getTenantBySlug(slug));

// The page component and generateMetadata each need the same product/category; cache() dedupes
// the two calls into one query within a single request instead of opening two transactions.
export const loadProductBySlug = cache((tenantId: string, slug: string) =>
  getProductBySlug(tenantId, slug),
);
export const loadCategoryBySlug = cache((tenantId: string, slug: string) =>
  getCategoryBySlug(tenantId, slug),
);

export const loadStorefrontData = cache(async (slug: string) => {
  const tenant = await loadTenant(slug);
  if (!tenant) return null;
  // A single shared transaction for all 5 reads instead of 5 independent withTenant() calls:
  // each one is an interactive transaction that holds a pooled connection for its duration, and
  // 5 of them firing concurrently per page load exhausts a small pool fast. See lib/prisma.ts.
  const { content, newArrivals, bestSellers, categories, categoryProductImages, announcedCoupon } = await withTenant(
    tenant.id,
    async (db) => {
      const [rows, newArrivals, bestSellers, categories, categoryProductImages, announcedCoupon] = await Promise.all([
        contentRowsQuery(db, tenant.id),
        newArrivalsQuery(db, tenant.id),
        bestSellersQuery(db, tenant.id),
        categoriesQuery(db, tenant.id),
        categoryProductImagesQuery(db, tenant.id),
        db.coupon.findFirst({ where: { tenantId: tenant.id, isAnnounced: true }, select: { code: true, announcementText: true, isEnabled: true, startsAt: true, endsAt: true, archivedAt: true } }),
      ]);
      return { content: resolveContent(rows), newArrivals, bestSellers, categories, categoryProductImages, announcedCoupon };
    },
  );
  const activeCoupon = announcedCoupon && couponStatus(announcedCoupon, new Date()) === "ACTIVE" ? announcedCoupon : null;
  const couponAnnouncement = activeCoupon ? {
    code: activeCoupon.code,
    text: (activeCoupon.announcementText || "Use {code} at checkout").includes("{code}")
      ? (activeCoupon.announcementText || "Use {code} at checkout").replaceAll("{code}", activeCoupon.code)
      : `${activeCoupon.announcementText} ${activeCoupon.code}`,
  } : null;
  const resolved = couponAnnouncement ? { ...content, "announcement.text": couponAnnouncement.text } : content;
  return { ...buildStorefrontData({
    store: { name: tenant.name, slug: tenant.slug, basePath: getStoreBasePath(tenant) },
    content: resolved,
    sectionVisibility: tenant.sectionVisibility,
    newArrivals: newArrivals.map(toStoreProduct),
    bestSellers: bestSellers.map(toStoreProduct),
    categories,
    categoryProductImages,
    socialLinks: tenant,
  }), couponAnnouncement };
});
