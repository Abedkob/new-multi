import { NextResponse } from "next/server";
import { loadTenant } from "@/lib/data/storefront";
import { listCatalog } from "@/lib/data/products";
import { toStoreProduct } from "@/lib/store-product";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  if (!q) return NextResponse.json([]);

  const tenant = await loadTenant(slug);
  if (!tenant) return NextResponse.json([]);

  const result = await listCatalog(tenant.id, { q, page: 1 });
  const items = result.items.slice(0, 5).map(toStoreProduct);

  return NextResponse.json(items);
}
