import { PageHeader } from "@/components/admin/page-header";
import { SheetImportForm } from "@/components/admin/sheet-import-form";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";

import { applyCatalogueAction, previewCatalogueAction } from "./actions";

/**
 * The catalogue sheet, at `products:write` — owner only.
 *
 * **Why this is a separate screen from `/admin/stock/import`.** A page names one capability, and
 * the stock sheet is `stock:move`, which staff hold. Putting both behind this page would mean
 * either gating it at `products:write`, so a staff member could never reach the stock sheet at
 * all, or gating it at `stock:move` and hiding half of it — which is the "a link that offers what
 * the page refuses" failure the capability table exists to prevent. So the stock sheet lives with
 * the stock screens, which is also where a merchant would look for it.
 */
export default async function ImportCataloguePage() {
  await requireCapability("products:write");
  const t = await getT();

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("import.catalogue.title")}
        description={t("import.catalogue.description")}
        back={{ href: "/admin/products", label: t("nav.products") }}
      />
      <SheetImportForm
        mode="catalogue"
        templateHref="/admin/products/import/template"
        exportHref="/admin/products/export"
        preview={previewCatalogueAction}
        apply={applyCatalogueAction}
      />
    </div>
  );
}
