import { formatPrice } from "@/lib/format";

/**
 * Split out of discount-summary.tsx: this one has no i18n text (just formatted numbers) and is
 * the only export of that file used from the client discount-product-picker.tsx. Keeping it here
 * means that client component never pulls in discount-summary.tsx's next/headers-based getT().
 */
export function DiscountPricePreview({
  regularPriceCents,
  discountedPriceCents,
}: {
  regularPriceCents: number;
  discountedPriceCents: number;
}) {
  return (
    <span className="flex items-baseline gap-2 tabular-nums">
      <span className="text-muted-foreground line-through">{formatPrice(regularPriceCents)}</span>
      <span className="font-semibold">{formatPrice(discountedPriceCents)}</span>
    </span>
  );
}
