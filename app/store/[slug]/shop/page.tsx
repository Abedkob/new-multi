import { notFound } from "next/navigation";
import { listCatalog } from "@/lib/data/products";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";
import { CatalogPage } from "@/templates/catalog-page";

export const dynamic = "force-dynamic";

const pageNumber = (v: string | string[] | undefined) =>
  Number.parseInt(Array.isArray(v) ? v[0] : (v ?? "1"), 10) || 1;

/** Every product in the store, paginated. */
export default async function ShopPage({
  params,
  searchParams,
}: PageProps<"/store/[slug]/shop">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  const result = await listCatalog(tenant.id, { page: pageNumber(sp.page) });
  return (
    <CatalogPage
      template={getTemplate(tenant.templateId)}
      data={data}
      title={data.content["shop.heading"]}
      chips={data.categoryTiles.map((c) => ({ label: c.label, href: c.href }))}
      products={result.items.map(toStoreProduct)}
      total={result.total}
      page={result.page}
      pages={result.pages}
      basePath={`/store/${slug}/shop`}
      emptyText={data.content["shop.empty"]}
    />
  );
}
