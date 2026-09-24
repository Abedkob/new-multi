"use server";

import { revalidatePath } from "next/cache";
import { deliveryFeeInputValue, deliverySettingsSchema } from "@/lib/delivery";
import { updateTenantDeliverySettings } from "@/lib/data/tenants";
import { requireOwner } from "@/lib/session";
import type { FormState } from "@/lib/validation";

type DeliveryValues = { deliveryFee: string; deliveryNote: string };

export type DeliveryActionState = FormState & { values?: DeliveryValues };

export async function saveDeliverySettingsAction(
  _previous: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const { tenantId } = await requireOwner();
  const submitted: DeliveryValues = {
    deliveryFee: String(formData.get("deliveryFee") ?? ""),
    deliveryNote: String(formData.get("deliveryNote") ?? ""),
  };
  const parsed = deliverySettingsSchema.safeParse(submitted);

  if (!parsed.success) {
    return {
      error: "Check the highlighted delivery settings and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: submitted,
    };
  }

  const saved = await updateTenantDeliverySettings(tenantId, {
    deliveryFeeCents: parsed.data.deliveryFee,
    deliveryNote: parsed.data.deliveryNote,
  });
  revalidatePath("/admin/delivery");

  return {
    ok: true,
    values: {
      deliveryFee: deliveryFeeInputValue(saved.deliveryFeeCents),
      deliveryNote: saved.deliveryNote,
    },
  };
}
