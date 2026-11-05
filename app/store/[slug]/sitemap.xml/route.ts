import { NextResponse } from "next/server";
import { loadTenant } from "@/lib/data/storefront";
import { buildTenantSitemap, sitemapXml } from "@/lib/sitemap";
import { canServeTenant } from "@/lib/license/status";

export const dynamic = "force-dynamic";

/**
 * This store's own sitemap. Reachable at /store/[slug]/sitemap.xml, and at the root of a
 * store's own domain: proxy.ts rewrites acme.com/sitemap.xml to this same route, and the URLs
 * inside it resolve to that domain on their own (lib/store-url.ts). pnpm e2e:pages' custom-
 * domain leg reads it from a domain and checks both — the URLs are the domain's, and another
 * store's products are not in it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) return new NextResponse("Not found", { status: 404 });
  if (!canServeTenant(tenant)) {
    return new NextResponse(sitemapXml([]), {
      headers: { "Content-Type": "application/xml", "X-Robots-Tag": "noindex" },
    });
  }

  const entries = await buildTenantSitemap(tenant);
  return new NextResponse(sitemapXml(entries), {
    headers: { "Content-Type": "application/xml" },
  });
}
