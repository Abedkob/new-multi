/**
 * The stock module's rules, with no database and no environment.
 *
 * Same shape as lib/counter-sales.ts and lib/orders.ts: pure functions a server component, a
 * server action and a verification script can all import, so "may this store record a movement"
 * and "may this person see what it cost" have exactly one definition each.
 */

import { canServeTenant, type LicenseAccessSnapshot } from "@/lib/license/status";
import type { AdminRole } from "@/lib/roles";

export const STOCK_MOVEMENT_REASONS = [
  "OPENING",
  "RECEIPT",
  "COUNT",
  "ADJUST",
  "SALE",
  "ORDER_CANCELLED",
  "COUNTER_SALE",
  "COUNTER_VOID",
  "VARIANT_REMOVED",
] as const;
export type StockMovementReasonValue = (typeof STOCK_MOVEMENT_REASONS)[number];

export const STOCK_BATCH_KINDS = ["RECEIPT", "COUNT"] as const;
export type StockBatchKindValue = (typeof STOCK_BATCH_KINDS)[number];

/**
 * How many lines one submitted document may hold.
 *
 * The same figure the till and the checkout use for a cart, and chosen the same way: it is the
 * point past which a person is no longer reading what they are submitting. A shop counting four
 * hundred lines does it as several stocktakes, which is also how it would walk the shelves.
 */
export const MAX_STOCK_LINES = 50;

/** The largest quantity one received line may carry, matching the one stock ceiling (D89). */
export const MAX_STOCK_LINE_QUANTITY = 1_000_000;

/** The fields a stock decision needs. Structural, so a `select`ed row fits. */
export type StockTenant = {
  stockEnabled: boolean;
  isPaused: boolean;
  license?: LicenseAccessSnapshot | null;
};

/**
 * Whether this store may record a movement a person submitted — a receipt, a count.
 *
 * Composes `canServeTenant` for the reason `canSellAtCounter` does: pausing a store is the
 * platform's commercial lever, and leaving a back-office channel open while the storefront is
 * dark would blunt it.
 *
 * Deliberately NOT the gate on the ledger itself. A paused store's stock can still move — a
 * cancellation restores it, the owner can still correct a figure — and those movements are
 * exactly what the ledger exists to record. The ledger's own gate is `stockEnabled` alone.
 */
export function canMoveStock(tenant: StockTenant, now = new Date()): boolean {
  return tenant.stockEnabled && canServeTenant(tenant, now);
}

/**
 * Whether this store's ledger may be read.
 *
 * Switching the module off stops new movements; it must not hide the history a store already
 * has. So this keys on the first-enabled timestamp, which is never cleared — `hasCounterSaleHistory`,
 * for the same reason.
 */
export function hasStockHistory(tenant: {
  stockEnabled: boolean;
  stockFirstEnabledAt: Date | null;
}): boolean {
  return tenant.stockEnabled || tenant.stockFirstEnabledAt !== null;
}

/**
 * Whether this person may see what stock cost.
 *
 * A role rule rather than a third capability, following `maxManualDiscountCents`: the capability
 * table describes *what a person does*, and "receives a delivery" is one job whether or not the
 * cost of it is any of their business. Splitting it would mean two capabilities for one screen and
 * a grant nobody would ever give separately.
 *
 * Unit cost is a purchasing fact about the owner's margins. Staff receive the goods; they do not
 * need the invoice. Enforced in the action as well as the markup, because a hidden field is not a
 * permission check.
 */
export function maySeeStockCost(role: AdminRole): boolean {
  return role === "STORE_OWNER";
}

/**
 * The unit cost that may actually be stored for this role, whatever was posted.
 *
 * A pure function rather than a line of the action, for two reasons. It is the enforcing half of
 * D92 — the form not rendering the field for staff is a courtesy, and this is the check — so it
 * deserves a test that does not need a session to run. And a rule written inline in one action is
 * a rule the second action will implement slightly differently.
 */
export function costForRole(
  role: AdminRole,
  posted: number | null | undefined,
): number | null {
  return maySeeStockCost(role) ? (posted ?? null) : null;
}

/**
 * The actor snapshot for a movement nobody made.
 *
 * `StockMovement.actorNameSnapshot` is NOT NULL and non-empty (a CHECK), because a history row
 * that cannot say where it came from is not an audit record. A storefront sale and an automatic
 * expiry have no person behind them, so they name the channel instead — listed here once so the
 * two of them cannot drift into four spellings, and so the history screen can translate a known
 * token instead of printing an English string into an Arabic table.
 */
export const STOCK_SYSTEM_ACTORS = {
  /** A shopper's own order, placed on the storefront. */
  storefront: "Online store",
  /** expireStalePendingOrders: a PENDING order older than 24 hours, cancelled with no operator. */
  automatic: "Automatic",
} as const;

export type StockSystemActor = (typeof STOCK_SYSTEM_ACTORS)[keyof typeof STOCK_SYSTEM_ACTORS];

/**
 * The dictionary key for a system actor, or null for a person's name.
 *
 * A stored snapshot is a fixed English string — it has to be, since it is written by a scheduled
 * job with no locale and must stay the same once written. So the Arabic history screen looks the
 * label up here rather than printing it, and a person's own name is never translated. The map lives
 * beside the labels so adding a third system actor without a translation is a compile error at the
 * call site rather than an English word in an Arabic table.
 */
export const STOCK_SYSTEM_ACTOR_KEYS = {
  [STOCK_SYSTEM_ACTORS.storefront]: "stock.actor.storefront",
  [STOCK_SYSTEM_ACTORS.automatic]: "stock.actor.automatic",
} as const satisfies Record<StockSystemActor, string>;

export function stockActorKey(
  name: string,
): (typeof STOCK_SYSTEM_ACTOR_KEYS)[StockSystemActor] | null {
  return (STOCK_SYSTEM_ACTOR_KEYS as Record<string, (typeof STOCK_SYSTEM_ACTOR_KEYS)[StockSystemActor]>)[name] ?? null;
}
