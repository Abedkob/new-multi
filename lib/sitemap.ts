import type { ContentKey } from "@/lib/content";
import { resolveContent } from "@/lib/content";
import { categorySitemapQuery } from "@/lib/data/categories";
import { contentRowsQuery } from "@/lib/data/content";
import { productSitemapQuery } from "@/lib/data/products";
import { PAGE_SLUGS } from "@/lib/pages";
import { withTenant } from "@/lib/prisma";
import { getStoreUrl, type UrlTenant } from "@/lib/store-url";

export type SitemapTenant = UrlTenant & { id: string };
export type SitemapEntry = { url: string; lastModified?: Date };

/**
 * Every indexable URL for one store: home, shop, each category, each product, and each written
 * content page. Mirrors exactly what's reachable and non-404 in the storefront — a content page
 * only exists once its body is non-empty (see app/store/[slug]/[page]/page.tsx), so this reads
 * resolveContent() the same way that page does rather than the raw TenantContent rows.
 */
export async function buildTenantSitemap(tenant: SitemapTenant): Promise<SitemapEntry[]> {
  // One shared transaction for all three reads, same reasoning as loadStorefrontData: each
  // withTenant() call holds a pooled connection for its duration.
  const { products, categories, content } = await withTenant(tenant.id, async (db) => {
    const [products, categories, rows] = await Promise.all([
      productSitemapQuery(db, tenant.id),
      categorySitemapQuery(db, tenant.id),
      contentRowsQuery(db, tenant.id),
    ]);
    return { products, categories, content: resolveContent(rows) };
  });

  const entries: SitemapEntry[] = [
    { url: getStoreUrl(tenant) },
    { url: getStoreUrl(tenant, "/shop") },
  ];
  for (const category of categories) {
    entries.push({ url: getStoreUrl(tenant, `/category/${category.slug}`) });
  }
  for (const product of products) {
    entries.push({ url: getStoreUrl(tenant, `/products/${product.slug}`), lastModified: product.updatedAt });
  }
  for (const page of PAGE_SLUGS) {
    if (content[`${page}.body` as ContentKey]?.trim()) {
      entries.push({ url: getStoreUrl(tenant, `/${page}`) });
    }
  }
  return entries;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastModified ? `<lastmod>${e.lastModified.toISOString()}</lastmod>` : "";
      return `<url><loc>${escapeXml(e.url)}</loc>${lastmod}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function sitemapIndexXml(sitemapUrls: string[]): string {
  const entries = sitemapUrls.map((u) => `<sitemap><loc>${escapeXml(u)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}
