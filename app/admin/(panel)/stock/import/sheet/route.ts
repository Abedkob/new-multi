/**
 * The count sheet: `GET /admin/stock/import/sheet`.
 *
 * At **`stock:move`**, which staff hold — and that is the reason this route exists rather than
 * reusing the catalogue template. A stockroom assistant has to be able to download the sheet they
 * are going to walk the shelves with, and the catalogue template is behind `products:write`, so
 * pointing them at it would hand them a download their own role refuses.
 *
 * It carries every shelf's current figure in the read-only `On the shelf now` column and leaves
 * `Counted` **blank**. A count sheet that arrived pre-filled with the system's own figures would
 * be a stocktake that agrees with itself by construction, which is worse than no stocktake —
 * somebody would sign it off.
 *
 * The products and options sheets come along in the same workbook, filled in. They are read-only
 * to a staff member in the sense that matters: uploading them needs `products:write`, so the worst
 * case is a refusal, and having the catalogue in front of them while counting is useful.
 */

import { notFound } from "next/navigation";

import { workbookResponse } from "@/lib/catalogue-sheet/download";
import { buildWorkbook } from "@/lib/catalogue-sheet/workbook";
import { readCatalogueForExport } from "@/lib/data/catalogue-sheet";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getTenantById } from "@/lib/data/tenants";
import { getLocale } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { canMoveStock } from "@/lib/stock";

export async function GET() {
  const { tenantId } = await requireCapability("stock:move");
  const locale = await getLocale();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  // A layout does not run for a route handler, so the module gate is enforced here too.
  const license = await getLicenseAccessSnapshot(tenantId);
  if (!canMoveStock({ ...tenant, license })) notFound();

  const data = await readCatalogueForExport(tenantId);
  const workbook = await buildWorkbook({ locale, storeName: tenant.name, ...data });
  return workbookResponse(workbook, "stock-count", tenant.name);
}
