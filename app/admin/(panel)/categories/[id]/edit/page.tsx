import { notFound } from "next/navigation";
import { descendantIds, flattenCategories } from "@/lib/categories";
import { getCategory, listCategories } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { updateCategoryAction } from "../../actions";
import { CategoryForm } from "../../category-form";

export default async function EditCategoryPage({
  params,
}: PageProps<"/admin/categories/[id]/edit">) {
  const { tenantId } = await requireOwner();
  const { id } = await params;

  // Scoped by tenantId: another store's category id is simply "not found".
  const category = await getCategory(tenantId, id);
  if (!category) notFound();

  // The dropdown never offers the category itself or anything below it (that would create a
  // loop). The server action enforces the same rule.
  const all = await listCategories(tenantId);
  const excluded = descendantIds(all, category.id);
  const parents = flattenCategories(all)
    .filter((c) => !excluded.has(c.id))
    .map((c) => ({ id: c.id, label: c.name, depth: c.depth }));

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Edit category</h1>
      <CategoryForm
        action={updateCategoryAction.bind(null, category.id)}
        parents={parents}
        submitLabel="Save changes"
        defaults={{ name: category.name, parentId: category.parentId ?? "", imageUrl: category.imageUrl ?? "" }}
      />
    </div>
  );
}
