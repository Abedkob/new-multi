import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { canSellAtCounter } from "@/lib/counter-sales";
import { getTenantById } from "@/lib/data/tenants";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { Till } from "./till";

/**
 * The till.
 *
 * `notFound()` rather than the refusal page when the store cannot sell: `/admin/no-access` means
 * "your role may not", and this is not about the role — the store either has a till or it does
 * not. The refusal that protects the write is in the data layer, not here.
 */
export default async function NewCounterSalePage() {
  const { tenantId, role } = await requireCapability("counter:sell");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const license = await getLicenseAccessSnapshot(tenantId);
  if (!canSellAtCounter({ ...tenant, license })) notFound();

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("counter.new.title")}
        description={t("counter.new.description")}
        back={{ href: "/admin/counter", label: t("counter.sale.back") }}
      />
      <Till role={role} />
    </div>
  );
}
