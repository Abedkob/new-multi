import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryChain, descendantIds } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { hasActiveFilters, parseCatalogFilters } from "@/lib/catalog-filters";
import { listAttributeFacets, listCatalog } from "@/lib/data/products";
import { loadCategoryBySlug, loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { pageMeta, storeImage } from "@/lib/seo";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";
import { CatalogPage } from "@/templates/catalog-page";
import { storeHref } from "@/templates/shared";

export const dynamic = "force-dynamic";

const pageNumber = (v: string | string[] | undefined) =>
  Number.parseInt(Array.isArray(v) ? v[0] : (v ?? "1"), 10) || 1;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/store/[slug]/category/[categorySlug]">): Promise<Metadata> {
  const { slug, categorySlug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) return {};
  const category = await loadCategoryBySlug(tenant.id, categorySlug);
  if (!category) return {};
  // Self-referencing per page, matching the shop page's pagination canonical strategy.
  const sp = await searchParams;
  const page = pageNumber(sp.page);
  // Sorted/filtered views: not indexed, canonical to the plain category page (see shop page).
  const filtered = hasActiveFilters(parseCatalogFilters(sp));
  const path =
    page > 1 && !filtered ? `/category/${categorySlug}?page=${page}` : `/category/${categorySlug}`;
  return pageMeta({
    tenant,
    path,
    noindex: filtered,
    title: page > 1 ? `${category.name} – Page ${page}` : category.name,
    description: `Shop ${category.name} at ${tenant.name}.`,
    images: [category.imageUrl || storeImage(data.content)],
  });
}

/**
 * Products in a category AND all of its subcategories. Choosing "Men" should show the shoes
 * filed under Men > Shoes too; the subcategory chips let shoppers narrow it down.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/store/[slug]/category/[categorySlug]">) {
  const { slug, categorySlug } = await params;
  const sp = await searchParams;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  // Looked up by (tenantId, slug): another store's category slug 404s here.
  const category = await loadCategoryBySlug(tenant.id, categorySlug);
  if (!category) notFound();

  const all = await listCategories(tenant.id);
  const ids = [...descendantIds(all, category.id)];
  const chain = categoryChain(all, category.id);
  const children = all.filter((c) => c.parentId === category.id).sort((a, b) => a.name.localeCompare(b.name));
  const filters = parseCatalogFilters(sp);
  const [result, facets] = await Promise.all([
    listCatalog(tenant.id, { categoryIds: ids, page: pageNumber(sp.page), filters }),
    listAttributeFacets(tenant.id, { categoryIds: ids }),
  ]);

  const base = data.store.basePath;
  return (
    <CatalogPage
      template={getTemplate(tenant.templateId)}
      data={data}
      title={category.name}
      breadcrumb={[
        { label: data.store.name, href: storeHref(data.store) },
        { label: data.content["shop.heading"], href: `${base}/shop` },
        ...chain.map((c, i) => ({
          label: c.name,
          href: i < chain.length - 1 ? `${base}/category/${c.slug}` : undefined,
        })),
      ]}
      chips={children.map((c) => ({ label: c.name, href: `${base}/category/${c.slug}` }))}
      products={result.items.map(toStoreProduct)}
      total={result.total}
      page={result.page}
      pages={result.pages}
      basePath={`${base}/category/${categorySlug}`}
      filters={{ value: filters, facets }}
      emptyText={data.content["category.empty"]}
    />
  );
}
