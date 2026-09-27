import { notFound } from "next/navigation";
import { descendantIds, flattenCategories } from "@/lib/categories";
import { getCategory, listCategories } from "@/lib/data/categories";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { updateCategoryAction } from "../../actions";
import { CategoryForm } from "../../category-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function EditCategoryPage({
  params,
}: PageProps<"/admin/categories/[id]/edit">) {
  const { tenantId } = await requireOwner();
  const t = await getT();
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
    <div className="grid">
      <PageHeader
        title={t("categories.edit.title")}
        back={{ href: "/admin/categories", label: t("nav.categories") }}
        description={t("categories.edit.description")}
      />
      <CategoryForm
        action={updateCategoryAction.bind(null, category.id)}
        parents={parents}
        submitLabel={t("common.saveChanges")}
        defaults={{ name: category.name, parentId: category.parentId ?? "", imageUrl: category.imageUrl ?? "" }}
      />
    </div>
  );
}
