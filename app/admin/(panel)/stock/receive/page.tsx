import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { StockDocumentForm } from "@/components/admin/stock/stock-document-form";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { canMoveStock, maySeeStockCost } from "@/lib/stock";

/**
 * Goods in: every line goes up by what arrived.
 *
 * `canMoveStock` rather than the layout's `hasStockHistory`, because this writes. A store whose
 * module was switched off keeps its history readable and loses this screen — and a paused or
 * unlicensed store loses it too, for the reason `canSellAtCounter` composes the same check: a
 * back-office channel left open while the storefront is dark would blunt the platform's one
 * commercial lever.
 *
 * The unit cost column is decided here and enforced again in the action (D92). A staff member who
 * posts one anyway has it dropped.
 */
export default async function ReceiveStockPage() {
  const { tenantId, role } = await requireCapability("stock:move");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const license = await getLicenseAccessSnapshot(tenantId);
  if (!canMoveStock({ ...tenant, license })) notFound();

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("stock.receive.title")}
        back={{ href: "/admin/stock", label: t("nav.stock") }}
        description={t("stock.receive.description")}
      />
      <StockDocumentForm kind="RECEIPT" withCost={maySeeStockCost(role)} />
    </div>
  );
}
