import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { createCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";

export default async function NewCategoryPage() {
  const { tenantId } = await requireOwner();
  const parents = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    label: c.name,
    depth: c.depth,
  }));
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">New category</h1>
      <CategoryForm action={createCategoryAction} parents={parents} submitLabel="Create category" />
    </div>
  );
}
