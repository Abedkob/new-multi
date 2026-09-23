import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasActiveFilters, parseCatalogFilters } from "@/lib/catalog-filters";
import { listAttributeFacets, listCatalog } from "@/lib/data/products";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { pageMeta, storeImage } from "@/lib/seo";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";
import { CatalogPage } from "@/templates/catalog-page";
import { shopHref } from "@/templates/shared";

export const dynamic = "force-dynamic";

const pageNumber = (v: string | string[] | undefined) =>
  Number.parseInt(Array.isArray(v) ? v[0] : (v ?? "1"), 10) || 1;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/store/[slug]/shop">): Promise<Metadata> {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) return {};
  // Self-referencing per page: page 1 canonicalizes to /shop, later pages to their own ?page=N
  // (a shared canonical across all pages would tell crawlers pages 2+ don't need indexing).
  // Later pages also get "Page N" in the title so they aren't duplicate titles.
  const sp = await searchParams;
  const page = pageNumber(sp.page);
  const heading = data.content["shop.heading"] || "Shop";
  // Sorted/filtered views are endless URL combinations of the same products: kept out of the
  // index, canonical pointing at the plain shop page.
  const filtered = hasActiveFilters(parseCatalogFilters(sp));
  return pageMeta({
    tenant,
    path: page > 1 && !filtered ? `/shop?page=${page}` : "/shop",
    title: page > 1 ? `${heading} – Page ${page}` : heading,
    description: `Browse all products at ${tenant.name}.`,
    images: [storeImage(data.content)],
    noindex: filtered,
  });
}

/** Every product in the store, paginated, with sort + filters. */
export default async function ShopPage({
  params,
  searchParams,
}: PageProps<"/store/[slug]/shop">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  const filters = parseCatalogFilters(sp);
  const [result, facets] = await Promise.all([
    listCatalog(tenant.id, { page: pageNumber(sp.page), filters }),
    listAttributeFacets(tenant.id, {}),
  ]);
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
      basePath={shopHref(data.store)}
      filters={{ value: filters, facets }}
      emptyText={data.content["shop.empty"]}
    />
  );
}
