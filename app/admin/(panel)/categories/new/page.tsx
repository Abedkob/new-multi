import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { createCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function NewCategoryPage() {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const parents = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    label: c.name,
    depth: c.depth,
  }));
  return (
    <div className="grid">
      <PageHeader
        title={t("categories.new.title")}
        back={{ href: "/admin/categories", label: t("nav.categories") }}
        description={t("categories.new.description")}
      />
      <CategoryForm action={createCategoryAction} parents={parents} submitLabel={t("categories.form.createSubmit")} />
    </div>
  );
}
