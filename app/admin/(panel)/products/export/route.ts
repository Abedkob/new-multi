/**
 * The catalogue as a workbook: `GET /admin/products/export`.
 *
 * The same five sheets the template has, filled in — which is what makes "export, edit three
 * cells, upload it back" the safe workflow and the one the screen recommends. A sheet produced
 * here carries the exact current names, so the normal case never renames anything by accident.
 *
 * It sits beside `products/[id]`, and there is no `[id]/page.tsx` (only `[id]/edit` and
 * `[id]/stock`), so a literal segment cannot collide with the dynamic one.
 */

import { workbookResponse } from "@/lib/catalogue-sheet/download";
import { buildWorkbook } from "@/lib/catalogue-sheet/workbook";
import { readCatalogueForExport } from "@/lib/data/catalogue-sheet";
import { getTenantById } from "@/lib/data/tenants";
import { getLocale } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";

export async function GET() {
  const { tenantId } = await requireCapability("products:write");
  const locale = await getLocale();
  const [tenant, data] = await Promise.all([getTenantById(tenantId), readCatalogueForExport(tenantId)]);
  const storeName = tenant?.name ?? "store";

  const workbook = await buildWorkbook({ locale, storeName, ...data });
  return workbookResponse(workbook, "catalogue", storeName);
}
