import { effectivePrice } from "@/lib/variants";

export type DiscountTypeValue = "PERCENTAGE" | "FIXED_AMOUNT";

export type DiscountCandidate = {
  id: string;
  name: string;
  type: DiscountTypeValue;
  value: number;
  isEnabled: boolean;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  archivedAt: Date | string | null;
  createdAt: Date | string;
};

export type AppliedDiscount = Pick<DiscountCandidate, "id" | "name" | "type" | "value">;

export type PriceResult = {
  regularPriceCents: number;
  finalPriceCents: number;
  discountCents: number;
  appliedDiscount: AppliedDiscount | null;
};

const millis = (value: Date | string) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export function isDiscountActive(discount: DiscountCandidate, at: Date): boolean {
  const now = at.getTime();
  return (
    discount.isEnabled &&
    discount.archivedAt === null &&
    (discount.startsAt === null || millis(discount.startsAt) <= now) &&
    (discount.endsAt === null || now < millis(discount.endsAt))
  );
}

export function applyDiscount(regularPriceCents: number, discount: DiscountCandidate): number {
  const discounted =
    discount.type === "PERCENTAGE"
      ? regularPriceCents - Math.round((regularPriceCents * discount.value) / 100)
      : regularPriceCents - discount.value;
  return Math.max(0, discounted);
}

/**
 * Canonical application pricing. Discounts never stack: the lowest eligible price wins.
 * Equal prices are resolved by creation time and then id so snapshots stay deterministic.
 */
export function calculatePrice(
  basePriceCents: number,
  priceCentsOverride: number | null,
  discounts: DiscountCandidate[],
  at: Date,
): PriceResult {
  const regularPriceCents = effectivePrice(basePriceCents, priceCentsOverride);
  const eligible = discounts
    .filter((discount) => isDiscountActive(discount, at))
    .map((discount) => ({ discount, price: applyDiscount(regularPriceCents, discount) }))
    .sort(
      (a, b) =>
        a.price - b.price ||
        millis(a.discount.createdAt) - millis(b.discount.createdAt) ||
        a.discount.id.localeCompare(b.discount.id),
    );
  const winner = eligible[0];
  const finalPriceCents = winner?.price ?? regularPriceCents;
  return {
    regularPriceCents,
    finalPriceCents,
    discountCents: regularPriceCents - finalPriceCents,
    appliedDiscount: winner
      ? {
          id: winner.discount.id,
          name: winner.discount.name,
          type: winner.discount.type,
          value: winner.discount.value,
        }
      : null,
  };
}

export function discountStatus(
  discount: Pick<DiscountCandidate, "isEnabled" | "startsAt" | "endsAt" | "archivedAt">,
  at: Date,
): "ARCHIVED" | "DISABLED" | "SCHEDULED" | "ACTIVE" | "ENDED" {
  if (discount.archivedAt !== null) return "ARCHIVED";
  if (!discount.isEnabled) return "DISABLED";
  if (discount.startsAt !== null && millis(discount.startsAt) > at.getTime()) return "SCHEDULED";
  if (discount.endsAt !== null && millis(discount.endsAt) <= at.getTime()) return "ENDED";
  return "ACTIVE";
}

/** Half-open schedules [start, end); null means unbounded. */
export function discountSchedulesOverlap(
  a: { startsAt: Date | string | null; endsAt: Date | string | null },
  b: { startsAt: Date | string | null; endsAt: Date | string | null },
): boolean {
  const aStart = a.startsAt === null ? Number.NEGATIVE_INFINITY : millis(a.startsAt);
  const bStart = b.startsAt === null ? Number.NEGATIVE_INFINITY : millis(b.startsAt);
  const aEnd = a.endsAt === null ? Number.POSITIVE_INFINITY : millis(a.endsAt);
  const bEnd = b.endsAt === null ? Number.POSITIVE_INFINITY : millis(b.endsAt);
  return aStart < bEnd && bStart < aEnd;
}
