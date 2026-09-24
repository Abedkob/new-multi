import { z } from "zod";

const feeInput = z
  .string()
  .trim()
  .min(1, "Enter a delivery fee, or 0 for free delivery")
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimal places")
  .refine((value) => Number(value) <= 9999.99, "Delivery fee must be $9,999.99 or less")
  .transform((value) => Math.round(Number(value) * 100));

export const deliverySettingsSchema = z.object({
  deliveryFee: feeInput,
  deliveryNote: z.string().trim().max(200, "Keep the delivery note under 200 characters"),
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
