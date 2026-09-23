import { notFound } from "next/navigation";
import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { getProduct } from "@/lib/data/products";
import { requireOwner } from "@/lib/session";
import { parseAttributes } from "@/lib/variants";
import { updateProductAction } from "../../actions";
import { ProductForm } from "../../product-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]/edit">) {
  const { tenantId } = await requireOwner();
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
        title="Edit product"
        back={{ href: "/admin/products", label: "Products" }}
        description="Changes show in your store as soon as you save."
      />
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        categories={categories}
        submitLabel="Save changes"
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
