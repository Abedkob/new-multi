/**
 * The blank workbook a merchant fills in: `GET /admin/products/import/template`.
 *
 * **This is the first guarded route handler in the repository**, and that is worth a note rather
 * than a shrug. `scripts/verify-permissions.ts` walked `page.tsx`, `layout.tsx` and `actions.ts`
 * and not `route.ts`, because the only route handlers under `/admin` were the two deliberately
 * public manifests — so this file could have shipped with no guard and the suite would still have
 * reported green. The check was extended to cover `route.ts` in the same commit that added this
 * file, and a planted removal of the guard was confirmed to fail it.
 *
 * A layout does not run for a route handler, so `(panel)/layout.tsx`'s `requireTenantMember` is
 * not in front of this. The guard here is the whole guard, after the proxy's optimistic role gate.
 */

import { flattenCategories } from "@/lib/categories";
import { workbookResponse } from "@/lib/catalogue-sheet/download";
import { buildWorkbook } from "@/lib/catalogue-sheet/workbook";
import { listCatalogueNames } from "@/lib/data/catalogue-sheet";
import { listCategories } from "@/lib/data/categories";
import { getTenantById } from "@/lib/data/tenants";
import { getLocale } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";

export async function GET() {
  const { tenantId } = await requireCapability("products:write");
  const locale = await getLocale();
  const [tenant, categories, products] = await Promise.all([
    getTenantById(tenantId),
    listCategories(tenantId),
    listCatalogueNames(tenantId),
  ]);
  const storeName = tenant?.name ?? "store";

  const workbook = await buildWorkbook({
    locale,
    storeName,
    // The full paths, which is the one column format the admin already renders and the parser
    // already reads: "Clothing / Shirts".
    categoryPaths: flattenCategories(categories).map((category) => category.path),
    productNames: products.map((product) => product.name),
  });

  return workbookResponse(workbook, "catalogue-template", storeName);
}
