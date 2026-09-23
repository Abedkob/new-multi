import { NextResponse } from "next/server";
import { listTenantSlugsWithoutDomain } from "@/lib/data/tenants";
import { sitemapIndexXml } from "@/lib/sitemap";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Index of every store still reachable at /store/[slug] (path-based). Reads the tenant table
 * live on every request, so a store created, renamed, or given its own domain is reflected
 * immediately — nothing here needs updating by hand as stores come and go.
 */
export async function GET() {
  const tenants = await listTenantSlugsWithoutDomain();
  const urls = tenants.map((t) => `${env.baseUrl}/store/${t.slug}/sitemap.xml`);
  return new NextResponse(sitemapIndexXml(urls), {
    headers: { "Content-Type": "application/xml" },
  });
}
