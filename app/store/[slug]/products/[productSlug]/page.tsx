import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listRelatedProducts } from "@/lib/data/products";
import { loadProductBySlug, loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { absoluteUrl, jsonLd, pageMeta, plainText } from "@/lib/seo";
import { getStoreUrl, type UrlTenant } from "@/lib/store-url";
import { toStoreProduct } from "@/lib/store-product";
import { getTemplate } from "@/templates";
import type { StoreProduct } from "@/templates/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/products/[productSlug]">): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) return {};
  const product = await loadProductBySlug(tenant.id, productSlug);
  if (!product) return {};
  const p = toStoreProduct(product);
  return pageMeta({
    tenant,
    path: `/products/${p.slug}`,
    title: p.name,
    description: plainText(p.description) || `${p.name} — available at ${tenant.name}.`,
    images: productImages(p),
  });
}

/** Main photo first, then the gallery, then variant photos; no blanks or repeats. */
function productImages(p: StoreProduct): string[] {
  return [...new Set([p.imageUrl, ...p.images.map((i) => i.url), ...p.variants.map((v) => v.imageUrl)])].filter(
    Boolean,
  );
}

const money = (cents: number) => (cents / 100).toFixed(2);
const availability = (inStock: boolean) =>
  inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

/**
 * schema.org Product for Google's product results (price, availability) and free Shopping
 * listings. One variant -> a plain Offer; several -> an AggregateOffer with the price range.
 */
function productJsonLd(tenant: UrlTenant & { name: string }, p: StoreProduct) {
  const url = getStoreUrl(tenant, `/products/${p.slug}`);
  const prices = p.variants.map((v) => v.priceCents);
  const single = p.variants.length === 1 ? p.variants[0] : null;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    ...(p.description.trim() ? { description: plainText(p.description, 5000) } : {}),
    image: productImages(p).map((i) => absoluteUrl(tenant, i)),
    sku: single?.id ?? p.id,
    brand: { "@type": "Brand", name: tenant.name },
    offers: single
      ? {
          "@type": "Offer",
          url,
          priceCurrency: "USD",
          price: money(single.priceCents),
          availability: availability(single.stock > 0),
          itemCondition: "https://schema.org/NewCondition",
        }
      : {
          "@type": "AggregateOffer",
          url,
          priceCurrency: "USD",
          lowPrice: money(Math.min(...prices)),
          highPrice: money(Math.max(...prices)),
          offerCount: p.variants.length,
          availability: availability(p.inStock),
        },
  };
}

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
  const product = await loadProductBySlug(tenant.id, productSlug);
  if (!product) notFound();

  const related = await listRelatedProducts(tenant.id, product.id);
  const { ProductPage } = getTemplate(tenant.templateId);
  const storeProduct = toStoreProduct(product);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(productJsonLd(tenant, storeProduct))} />
      <ProductPage data={data} product={storeProduct} related={related.map(toStoreProduct)} />
    </>
  );
}
