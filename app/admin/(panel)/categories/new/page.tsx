import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { createCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function NewCategoryPage() {
  const { tenantId } = await requireOwner();
  const parents = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    label: c.name,
    depth: c.depth,
  }));
  return (
    <div className="grid">
      <PageHeader
        title="New category"
        back={{ href: "/admin/categories", label: "Categories" }}
        description="Give it a name. Pick a parent to put it inside another category (e.g. Shoes inside Men)."
      />
      <CategoryForm action={createCategoryAction} parents={parents} submitLabel="Create category" />
    </div>
  );
}
