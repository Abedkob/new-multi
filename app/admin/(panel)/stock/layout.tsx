import { notFound } from "next/navigation";
import { getTenantById } from "@/lib/data/tenants";
import { requireCapability } from "@/lib/permissions";
import { hasStockHistory } from "@/lib/stock";

/**
 * The module gate for every stock screen, in one place.
 *
 * **A 404, deliberately not `/admin/no-access`.** The refusal page means "your role may not", and
 * this is not about the role: a store whose platform operator never switched the module on has no
 * stockroom for anybody. Telling a staff member they lack permission would be a lie about why —
 * the till's page makes the same distinction, for the same reason.
 *
 * `hasStockHistory`, not `stockEnabled`: switching the module off stops new movements and must not
 * hide the history a store already has. The screens that *write* a movement check `canMoveStock`
 * themselves, which is the narrower question (see lib/stock.ts).
 *
 * Each page below also names its own capability — `verify:permissions` requires it, and a layout
 * is not a security boundary a page should be able to inherit and then forget.
 *
 * It renders no heading, so every page here owns its own `h1` through `PageHeader` (ADMIN_UI.md).
 */
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const { tenantId } = await requireCapability("stock:read");
  const tenant = await getTenantById(tenantId);
  if (!tenant || !hasStockHistory(tenant)) notFound();
  return <>{children}</>;
}
