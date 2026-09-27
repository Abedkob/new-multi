import { notFound } from "next/navigation";
import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { getProduct } from "@/lib/data/products";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { parseAttributes } from "@/lib/variants";
import { updateProductAction } from "../../actions";
import { ProductForm } from "../../product-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]/edit">) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const { id } = await params;

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
        defaults={{
          name: product.name,
          description: product.description,
          price: (product.basePriceCents / 100).toFixed(2),
          imageUrl: product.imageUrl,
          images: product.images.map((img) => ({ id: img.id, url: img.url, altText: img.altText ?? "" })),
          isBestSeller: product.isBestSeller,
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
