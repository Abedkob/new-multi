import { NextResponse } from "next/server";
import { loadTenant } from "@/lib/data/storefront";
import { getStorePathname, getStoreUrl } from "@/lib/store-url";
import { canServeTenant } from "@/lib/license/status";

export const dynamic = "force-dynamic";

/**
 * This store's own robots.txt.
 *
 * On the shared host it sits at /store/[slug]/robots.txt, where no crawler will ever look —
 * crawlers read robots.txt at the host root, and that root is the platform's own
 * app/robots.txt. For a store with its own domain it IS the host root: proxy.ts excludes
 * robots.txt and sitemap.xml from its static-file passthrough so acme.com/robots.txt lands
 * here. pnpm e2e:pages' custom-domain leg holds that down — it reads this file from a store's
 * domain and checks the Disallow paths and the Sitemap line are the domain's, not /store/<slug>'s.
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
