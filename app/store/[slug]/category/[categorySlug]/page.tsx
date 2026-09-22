import { notFound } from "next/navigation";
import { categoryChain, descendantIds } from "@/lib/categories";
import { getCategoryBySlug, listCategories } from "@/lib/data/categories";
import { listCatalog } from "@/lib/data/products";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";
import { CatalogPage } from "@/templates/catalog-page";

export const dynamic = "force-dynamic";

const pageNumber = (v: string | string[] | undefined) =>
  Number.parseInt(Array.isArray(v) ? v[0] : (v ?? "1"), 10) || 1;

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
  const category = await getCategoryBySlug(tenant.id, categorySlug);
  if (!category) notFound();

  const all = await listCategories(tenant.id);
  const ids = [...descendantIds(all, category.id)];
  const chain = categoryChain(all, category.id);
  const children = all.filter((c) => c.parentId === category.id).sort((a, b) => a.name.localeCompare(b.name));
  const result = await listCatalog(tenant.id, { categoryIds: ids, page: pageNumber(sp.page) });

  const base = `/store/${slug}`;
  return (
    <CatalogPage
      template={getTemplate(tenant.templateId)}
      data={data}
      title={category.name}
      breadcrumb={[
        { label: data.store.name, href: base },
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
      emptyText={data.content["category.empty"]}
    />
  );
}
