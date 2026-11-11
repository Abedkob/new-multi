import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { getTenantById } from "@/lib/data/tenants";
import { deliveryFeeInputValue, deliverySettingsFromStore } from "@/lib/delivery";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { DeliverySettingsForm } from "./delivery-settings-form";

export default async function DeliverySettingsPage() {
  const { tenantId } = await requireCapability("settings:write");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const settings = deliverySettingsFromStore(tenant);

  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader
        title={t("nav.delivery")}
        description={t("delivery.page.description")}
      />
      <DeliverySettingsForm
        defaults={{
          deliveryFee: deliveryFeeInputValue(settings.deliveryFeeCents),
          deliveryNote: settings.deliveryNote,
        }}
      />
    </div>
  );
}
