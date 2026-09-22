import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const { tenantId } = await requireOwner();
  const categories = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    depth: c.depth,
  }));
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">New product</h1>
      <ProductForm action={createProductAction} categories={categories} submitLabel="Create product" />
    </div>
  );
}
