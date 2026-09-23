import { NextResponse } from "next/server";
import { loadTenant } from "@/lib/data/storefront";
import { listCatalog } from "@/lib/data/products";
import { RATE_LIMITS, clientIp, rateLimit } from "@/lib/rate-limit";
import { toStoreProduct } from "@/lib/store-product";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Public, unauthenticated endpoint: bound it per source against scraping/abuse.
  const ip = clientIp(req.headers);
  const limit = await rateLimit(`search:${ip}`, RATE_LIMITS.search);
  if (!limit.ok) {
    return NextResponse.json([], {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
    });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  if (!q) return NextResponse.json([]);

  const tenant = await loadTenant(slug);
  if (!tenant) return NextResponse.json([]);

  const result = await listCatalog(tenant.id, { q, page: 1, pageSize: 5 });
  const items = result.items.map(toStoreProduct);

  return NextResponse.json(items);
}
