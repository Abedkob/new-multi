import { effectivePrice } from "@/lib/variants";

export type DiscountTypeValue = "PERCENTAGE" | "FIXED_AMOUNT";
export type CouponScopeValue = "ORDER_SUBTOTAL" | "SELECTED_PRODUCTS" | "FREE_DELIVERY";

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

export type CouponCandidate = {
  id: string;
  code: string;
  name: string | null;
  scope: CouponScopeValue;
  type: DiscountTypeValue | null;
  value: number | null;
  isEnabled: boolean;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  archivedAt: Date | string | null;
  productIds?: readonly string[];
};

export type CouponLine = {
  key: string;
  productId: string;
  amountCents: number;
};

export type CouponPriceResult = {
  eligibleSubtotalCents: number;
  merchandiseDiscountCents: number;
  deliveryDiscountCents: number;
  discountCents: number;
  allocations: Record<string, number>;
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

export function couponStatus(
  coupon: Pick<CouponCandidate, "isEnabled" | "startsAt" | "endsAt" | "archivedAt">,
  at: Date,
): "ARCHIVED" | "DISABLED" | "SCHEDULED" | "EXPIRED" | "ACTIVE" {
  if (coupon.archivedAt !== null) return "ARCHIVED";
  if (!coupon.isEnabled) return "DISABLED";
  if (coupon.startsAt !== null && millis(coupon.startsAt) > at.getTime()) return "SCHEDULED";
  if (coupon.endsAt !== null && millis(coupon.endsAt) <= at.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Order-level coupon pricing. Automatic product discounts have already been applied to every
 * line's amount. Merchandise coupons are allocated with largest remainder so allocations always
 * add up to the exact order discount, without floating-point rounding drift.
 */
export function calculateCouponDiscount(
  coupon: CouponCandidate,
  lines: readonly CouponLine[],
  deliveryFeeCents: number,
): CouponPriceResult {
  const emptyAllocations = Object.fromEntries(lines.map((line) => [line.key, 0]));
  if (coupon.scope === "FREE_DELIVERY") {
    const deliveryDiscountCents = Math.max(0, deliveryFeeCents);
    return {
      eligibleSubtotalCents: 0,
      merchandiseDiscountCents: 0,
      deliveryDiscountCents,
      discountCents: deliveryDiscountCents,
      allocations: emptyAllocations,
    };
  }

  const selected = new Set(coupon.productIds ?? []);
  const eligible = lines.filter(
    (line) => coupon.scope === "ORDER_SUBTOTAL" || selected.has(line.productId),
  );
  const eligibleSubtotalCents = eligible.reduce((sum, line) => sum + line.amountCents, 0);
  const rawDiscount =
    coupon.type === "PERCENTAGE" && coupon.value !== null
      ? Math.round((eligibleSubtotalCents * coupon.value) / 100)
      : coupon.type === "FIXED_AMOUNT" && coupon.value !== null
        ? coupon.value
        : 0;
  const merchandiseDiscountCents = Math.min(eligibleSubtotalCents, Math.max(0, rawDiscount));
  const allocations = { ...emptyAllocations };

  if (merchandiseDiscountCents > 0 && eligibleSubtotalCents > 0) {
    const denominator = BigInt(eligibleSubtotalCents);
    const shares = eligible.map((line) => {
      const numerator = BigInt(merchandiseDiscountCents) * BigInt(line.amountCents);
      return {
        key: line.key,
        base: Number(numerator / denominator),
        remainder: numerator % denominator,
      };
    });
    let allocated = 0;
    for (const share of shares) {
      allocations[share.key] = share.base;
      allocated += share.base;
    }
    shares.sort((a, b) =>
      a.remainder === b.remainder
        ? a.key.localeCompare(b.key)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
    for (let i = 0; i < merchandiseDiscountCents - allocated; i++) {
      allocations[shares[i].key] += 1;
    }
  }

  return {
    eligibleSubtotalCents,
    merchandiseDiscountCents,
    deliveryDiscountCents: 0,
    discountCents: merchandiseDiscountCents,
    allocations,
  };
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
