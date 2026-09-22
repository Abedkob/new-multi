import { notFound } from "next/navigation";
import { getProductBySlug, listRelatedProducts } from "@/lib/data/products";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: PageProps<"/store/[slug]/products/[productSlug]">) {
  const { slug, productSlug } = await params;
  const [tenant, data] = await Promise.all([
    loadTenant(slug),
    loadStorefrontData(slug),
  ]);
  if (!tenant || !data) notFound();

  // Looked up by (tenantId, slug): a product slug from another store 404s here.
  const product = await getProductBySlug(tenant.id, productSlug);
  if (!product) notFound();

  const related = await listRelatedProducts(tenant.id, product.id);
  const { ProductPage } = getTemplate(tenant.templateId);
  return (
    <ProductPage
      data={data}
      product={toStoreProduct(product)}
      related={related.map(toStoreProduct)}
    />
  );
}
