import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";
import { PageHeader } from "@/components/admin/page-header";

export default async function NewProductPage() {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const categories = flattenCategories(await listCategories(tenantId)).map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    depth: c.depth,
  }));
  return (
    <div className="grid">
      <PageHeader
        title={t("products.new.title")}
        back={{ href: "/admin/products", label: t("nav.products") }}
        description={t("products.new.description")}
      />
      <ProductForm action={createProductAction} categories={categories} submitLabel={t("products.form.createSubmit")} />
    </div>
  );
}
