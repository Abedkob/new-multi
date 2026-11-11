import { z } from "zod";

// Admin-only schema: messages are i18n dictionary keys (see lib/i18n/dictionaries), not English text.
const feeInput = z
  .string()
  .trim()
  // One verdict per field, in priority order.
  //
  // `.regex(...).refine(...)` ran BOTH checks on the same string, and `Number("9.9.9")` is NaN —
  // and `NaN <= 9999.99` is false — so a malformed figure failed the range check as well, and the
  // field showed "Enter a valid amount with up to 2 decimal places" and "Delivery fee must be
  // $9,999.99 or less" together. Two incompatible verdicts on one input, one of them a lie.
  //
  // A transform that returns `z.NEVER` stops at the first failure, which is the shape
  // `lowStockThresholdString` already uses in lib/validation.ts. The ceiling is compared in cents
  // so the limit is an integer rather than a float comparison.
  .transform((value, ctx) => {
    if (!value) {
      ctx.addIssue({ code: "custom", message: "validation.delivery.feeRequired" });
      return z.NEVER;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "validation.delivery.feeInvalid" });
      return z.NEVER;
    }
    const cents = Math.round(Number(value) * 100);
    if (cents > 999_999) {
      ctx.addIssue({ code: "custom", message: "validation.delivery.feeTooLarge" });
      return z.NEVER;
    }
    return cents;
  });

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
