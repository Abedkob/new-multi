import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { getTenantById } from "@/lib/data/tenants";
import { deliveryFeeInputValue, deliverySettingsFromStore } from "@/lib/delivery";
import { requireOwner } from "@/lib/session";
import { DeliverySettingsForm } from "./delivery-settings-form";

export default async function DeliverySettingsPage() {
  const { tenantId } = await requireOwner();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const settings = deliverySettingsFromStore(tenant);

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Delivery"
        description="Set one delivery fee for orders anywhere in Lebanon."
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
