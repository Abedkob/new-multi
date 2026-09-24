import { NextResponse } from "next/server";
import { loadTenant } from "@/lib/data/storefront";
import { getStorePathname, getStoreUrl } from "@/lib/store-url";
import { canServeTenant } from "@/lib/license/status";

export const dynamic = "force-dynamic";

/**
 * This store's own robots.txt. Has no effect today (crawlers only read robots.txt at the host
 * root, and today's host root is the platform's own app/robots.txt), but is reachable at
 * /store/[slug]/robots.txt and is exactly where a future acme.com/robots.txt rewrite should
 * point — see app/store/[slug]/sitemap.xml/route.ts for the same reasoning.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) return new NextResponse("Not found", { status: 404 });

  if (!canServeTenant(tenant)) {
    return new NextResponse("User-Agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain" },
    });
  }

  const disallow = ["/cart", "/checkout", "/order-confirmation", "/search"].map((p) =>
    getStorePathname(tenant, p),
  );
  const body = [
    "User-Agent: *",
    "Allow: /",
    ...disallow.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${getStoreUrl(tenant, "/sitemap.xml")}`,
    "",
  ].join("\n");

  return new NextResponse(body, { headers: { "Content-Type": "text/plain" } });
}
