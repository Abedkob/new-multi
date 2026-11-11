import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { SheetImportForm } from "@/components/admin/sheet-import-form";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { canMoveStock } from "@/lib/stock";

import { applyStockCountAction, previewStockCountAction } from "./actions";

/**
 * The stock count sheet, at `stock:move` — which staff hold.
 *
 * A stockroom assistant can walk the shelves with a printed sheet and upload what they counted;
 * they still cannot reprice anything, because that is the catalogue sheet behind
 * `products:write`. The capability split IS the feature here, and it is the reason there are two
 * screens rather than one (see the sibling page's note).
 *
 * The 404 below is the module gate, not a refusal: `stock/layout.tsx` already 404s a store whose
 * operator never switched the module on, and `canMoveStock` is the narrower question of whether
 * movements may be recorded *now*. Telling somebody they lack permission would be a lie about why.
 */
export default async function ImportStockCountPage() {
  const { tenantId } = await requireCapability("stock:move");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const license = await getLicenseAccessSnapshot(tenantId);
  if (!canMoveStock({ ...tenant, license })) notFound();

  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader
        title={t("import.stock.title")}
        description={t("import.stock.description")}
        back={{ href: "/admin/stock", label: t("nav.stock") }}
      />
      <SheetImportForm
        mode="stock"
        exportHref="/admin/stock/import/sheet"
        preview={previewStockCountAction}
        apply={applyStockCountAction}
      />
    </div>
  );
}
