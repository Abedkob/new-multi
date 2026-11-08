/**
 * The till's rules, with no database and no environment.
 *
 * Same shape as lib/orders.ts: pure functions a server component, a server action and a
 * verification script can all import, so "may this store sell at the counter" and "how much may
 * this person discount" have exactly one definition each.
 */

import { canServeTenant, type LicenseAccessSnapshot } from "@/lib/license/status";
import type { AdminRole } from "@/lib/roles";

export const COUNTER_SALE_STATUSES = ["RECORDED", "VOIDED"] as const;
export type CounterSaleStatusValue = (typeof COUNTER_SALE_STATUSES)[number];

export const COUNTER_SALE_PAYMENTS = ["CASH", "CARD"] as const;
export type CounterSalePaymentValue = (typeof COUNTER_SALE_PAYMENTS)[number];

/** Short, human-friendly sale reference. Mirrors orderRef; not a secret. */
export const counterSaleRef = (id: string) => `#${id.slice(-6).toUpperCase()}`;

export const counterSaleTotal = (items: { priceCentsSnapshot: number; quantity: number }[]) =>
  items.reduce((sum, i) => sum + i.priceCentsSnapshot * i.quantity, 0);

export const counterSaleManualDiscountTotal = (
  items: { manualDiscountCentsSnapshot: number; quantity: number }[],
) => items.reduce((sum, i) => sum + i.manualDiscountCentsSnapshot * i.quantity, 0);

/** The fields a till decision needs. Structural, so a `select`ed row fits. */
export type TillTenant = {
  counterSalesEnabled: boolean;
  isPaused: boolean;
  license?: LicenseAccessSnapshot | null;
};

/**
 * Whether this store may record a sale right now.
 *
 * Composes `canServeTenant` rather than sitting beside it: pausing a store is the platform's
 * commercial lever, and leaving a revenue channel open while the storefront is dark would defeat
 * it. So an unlicensed or paused store cannot sell through any channel.
 */
export function canSellAtCounter(tenant: TillTenant, now = new Date()): boolean {
  return tenant.counterSalesEnabled && canServeTenant(tenant, now);
}

/**
 * Whether this store's till history may be read.
 *
 * Deliberately NOT the same question as `canSellAtCounter`. Switching the feature off stops new
 * sales; it must not hide the receipts and takings a store has already recorded, so this keys on
 * the first-enabled timestamp, which is never cleared.
 */
export function hasCounterSaleHistory(tenant: {
  counterSalesEnabled: boolean;
  counterSalesFirstEnabledAt: Date | null;
}): boolean {
  return tenant.counterSalesEnabled || tenant.counterSalesFirstEnabledAt !== null;
}

/**
 * The ceiling on a manual reduction, as a percentage of the line's price after any automatic
 * campaign discount.
 *
 * One constant and one comparison, rather than a per-tenant setting: a configurable cap is a
 * settings screen, a column and a migration, and nobody has asked for one. The owner is uncapped
 * because the owner already sets the catalogue price — a ceiling there would protect nothing.
 * Staff are capped because the alternative is a staff member able to move arbitrary money, which
 * is also why `counter:void` is owner-only.
 */
export const STAFF_MAX_MANUAL_DISCOUNT_PERCENT = 20;

/**
 * The largest manual discount `role` may apply to one unit of a line, in cents.
 *
 * Rounded DOWN, so the stated percentage is a true ceiling rather than something a rounding rule
 * can nudge past.
 */
export function maxManualDiscountCents(role: AdminRole, priceAfterAutomaticCents: number): number {
  if (priceAfterAutomaticCents <= 0) return 0;
  if (role !== "STAFF") return priceAfterAutomaticCents;
  return Math.floor((priceAfterAutomaticCents * STAFF_MAX_MANUAL_DISCOUNT_PERCENT) / 100);
}
