import { NextResponse } from "next/server";
import { loadTenant } from "@/lib/data/storefront";
import { buildTenantSitemap, sitemapXml } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/**
 * This store's own sitemap. Reachable today at /store/[slug]/sitemap.xml; once custom-domain
 * routing rewrites acme.com/sitemap.xml to this same route, crawlers hitting acme.com find it
 * without any change here — see lib/store-url.ts for how the URLs inside it already resolve to
 * the right domain.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) return new NextResponse("Not found", { status: 404 });

  const entries = await buildTenantSitemap(tenant);
  return new NextResponse(sitemapXml(entries), {
    headers: { "Content-Type": "application/xml" },
  });
}
