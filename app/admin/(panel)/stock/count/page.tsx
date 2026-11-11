import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { StockDocumentForm } from "@/components/admin/stock/stock-document-form";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { canMoveStock } from "@/lib/stock";

/**
 * A stocktake: every line becomes what was counted.
 *
 * `withCost` is false whatever the role. Counting a shelf establishes how many are there, not what
 * they cost — a cost field on this form would be asking for a figure nobody standing at a shelf
 * has, and the one place it is genuinely known is the moment goods are received.
 *
 * The counted figure is absolute and the server recomputes the variance from what it finds under a
 * row lock (D94), so a number that went stale while somebody walked the shelf cannot corrupt the
 * result — and a line that agrees still writes a zero-delta movement, which is the only evidence
 * the count happened.
 */
export default async function CountStockPage() {
  const { tenantId } = await requireCapability("stock:move");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const license = await getLicenseAccessSnapshot(tenantId);
  if (!canMoveStock({ ...tenant, license })) notFound();

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("stock.count.title")}
        back={{ href: "/admin/stock", label: t("nav.stock") }}
        description={t("stock.count.description")}
      />
      <StockDocumentForm kind="COUNT" withCost={false} />
    </div>
  );
}
