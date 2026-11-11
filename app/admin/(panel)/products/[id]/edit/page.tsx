import { notFound } from "next/navigation";
import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { getProduct } from "@/lib/data/products";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { parseAttributes } from "@/lib/variants";
import { updateProductAction } from "../../actions";
import { ProductForm } from "../../product-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]/edit">) {
  const { tenantId } = await requireCapability("products:write");
  const t = await getT();
  const { id } = await params;
  // D90: with the module on, a saved variant's stock becomes a figure and a link here, because
  // saving this form no longer writes it. `stockEnabled` and not `hasStockHistory`: switching the
  // module off has to give this form its old behaviour back exactly, or "off is as it was" would
  // be false for the one screen an owner uses every day.
  const tenant = await getTenantById(tenantId);

  // Scoped by tenantId: another store's product id is simply "not found".
  const product = await getProduct(tenantId, id);
  if (!product) notFound();

  const categories = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    depth: c.depth,
  }));

  return (
    <div className="grid">
      <PageHeader
        title={t("products.edit.title")}
        back={{ href: "/admin/products", label: t("nav.products") }}
        description={t("products.edit.description")}
      />
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        categories={categories}
        submitLabel={t("common.saveChanges")}
        stockHref={tenant?.stockEnabled ? `/admin/products/${product.id}/stock` : undefined}
        defaults={{
          name: product.name,
          description: product.description,
          price: (product.basePriceCents / 100).toFixed(2),
          imageUrl: product.imageUrl,
          images: product.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText ?? "" })),
          isBestSeller: product.isBestSeller,
          lowStockThreshold:
            product.lowStockThreshold === null ? "" : String(product.lowStockThreshold),
          categoryId: product.categoryId ?? "",
          variants: product.variants.map((v) => ({
            id: v.id,
            attrs: Object.entries(parseAttributes(v.attributes)).map(([key, value]) => ({ key, value })),
            stock: String(v.stock),
            price: v.priceCentsOverride === null ? "" : (v.priceCentsOverride / 100).toFixed(2),
            imageUrl: v.imageUrl ?? "",
          })),
        }}
      />
    </div>
  );
}
