import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Platform-level robots.txt: gates the admin/platform consoles and points at the sitemap
 * index. Each store's own storefront pages are additionally covered by their own
 * /store/[slug]/robots.txt (see app/store/[slug]/robots.txt/route.ts). */
export async function GET() {
  const body = [
    "User-Agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /platform",
    "Disallow: /login",
    "Disallow: /force-logout",
    "Disallow: /api",
    "",
    `Sitemap: ${env.baseUrl}/sitemap.xml`,
    "",
  ].join("\n");

  return new NextResponse(body, { headers: { "Content-Type": "text/plain" } });
}
