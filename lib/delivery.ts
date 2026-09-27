import { z } from "zod";

// Admin-only schema: messages are i18n dictionary keys (see lib/i18n/dictionaries), not English text.
const feeInput = z
  .string()
  .trim()
  .min(1, "validation.delivery.feeRequired")
  .regex(/^\d+(?:\.\d{1,2})?$/, "validation.delivery.feeInvalid")
  .refine((value) => Number(value) <= 9999.99, "validation.delivery.feeTooLarge")
  .transform((value) => Math.round(Number(value) * 100));

export const deliverySettingsSchema = z.object({
  deliveryFee: feeInput,
  deliveryNote: z.string().trim().max(200, "validation.delivery.noteTooLong"),
});

export type DeliverySettings = {
  deliveryFeeCents: number;
  deliveryNote: string;
};

export function deliverySettingsFromStore(store: Partial<DeliverySettings>): DeliverySettings {
  return {
    deliveryFeeCents:
      Number.isInteger(store.deliveryFeeCents) && (store.deliveryFeeCents ?? 0) >= 0
        ? store.deliveryFeeCents!
        : 0,
    deliveryNote: store.deliveryNote?.trim() ?? "",
  };
}

export const deliveryFeeInputValue = (cents: number) => (cents / 100).toFixed(2);
