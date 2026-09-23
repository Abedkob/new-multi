import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function NewProductPage() {
  const { tenantId } = await requireOwner();
  const categories = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    depth: c.depth,
  }));
  return (
    <div className="grid">
      <PageHeader
        title="New product"
        back={{ href: "/admin/products", label: "Products" }}
        description="Start with a name, a price and a photo. Everything else is optional and can be added later."
      />
      <ProductForm action={createProductAction} categories={categories} submitLabel="Create product" />
    </div>
  );
}
