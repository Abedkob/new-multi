import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fillVars } from "@/lib/content";
import { parseCatalogFilters } from "@/lib/catalog-filters";
import { listAttributeFacets, listCatalog } from "@/lib/data/products";
import { privatePageMeta } from "@/lib/seo";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";
import { CatalogPage } from "@/templates/catalog-page";
import { searchHref } from "@/templates/shared";

export const dynamic = "force-dynamic";

// Never indexed (see lib/seo.ts privatePageMeta).
export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/search">): Promise<Metadata> {
  const data = await loadStorefrontData((await params).slug);
  return privatePageMeta(data?.content["search.heading"] || "Search");
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Case-insensitive "contains" match on product name or description. */
export default async function SearchPage({
  params,
  searchParams,
}: PageProps<"/store/[slug]/search">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const page = Number.parseInt(first(sp.page) ?? "1", 10) || 1;
  const filters = parseCatalogFilters(sp);
  const [result, facets] = q
    ? await Promise.all([
        listCatalog(tenant.id, { q, page, filters }),
        listAttributeFacets(tenant.id, { q }),
      ])
    : [{ items: [], total: 0, page: 1, pages: 1 }, []];

  return (
    <CatalogPage
      template={getTemplate(tenant.templateId)}
      data={data}
      title={q ? `${data.content["search.heading"]}: ${q}` : data.content["search.heading"]}
      showSearch
      products={result.items.map(toStoreProduct)}
      total={result.total}
      page={result.page}
      pages={result.pages}
      basePath={searchHref(data.store)}
      keep={q ? [["q", q]] : []}
      filters={q ? { value: filters, facets } : undefined}
      emptyText={q ? fillVars(data.content["search.empty"], { q }) : data.content["search.placeholder"]}
    />
  );
}
