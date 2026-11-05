/**
 * Which notifications exist, who may receive them, and which preference governs each one.
 *
 * Pure, and the single source for all three questions. The reason they live together is D60: a
 * role that may receive new orders and nothing else is only a real guarantee if "which types may
 * this recipient receive" is one table that the writer consults — not a condition in the sender,
 * a different condition in the UI, and a third in a scheduled job.
 */

import type { NotificationAudience, NotificationType } from "@/generated/prisma/client";
import type { Role } from "@/lib/roles";

/** Which audience a type belongs to. A type sent to the wrong audience is refused outright. */
export const TYPE_AUDIENCE: Record<NotificationType, NotificationAudience> = {
  NEW_ORDER: "OWNER",
  WEEKLY_SUMMARY: "OWNER",
  PRODUCT_ALERT: "OWNER",
  FUNNEL_ALERT: "OWNER",
  SEARCH_ALERT: "OWNER",
  TRAFFIC_ALERT: "OWNER",
  INACTIVE_STORE: "PLATFORM",
  STORE_DECLINE: "PLATFORM",
  INGESTION_HEALTH: "PLATFORM",
  CONTRACT_REJECTION: "PLATFORM",
  AGGREGATION_HEALTH: "PLATFORM",
  REDIS_FALLBACK: "PLATFORM",
  PUSH_DELIVERY: "PLATFORM",
  PLATFORM_WEEKLY_SUMMARY: "PLATFORM",
};

/** The owner preference column that governs each owner type (§9.7). */
export const OWNER_PREFERENCE_FIELD = {
  NEW_ORDER: "newOrders",
  WEEKLY_SUMMARY: "weeklySummary",
  PRODUCT_ALERT: "productAlerts",
  FUNNEL_ALERT: "funnelAlerts",
  SEARCH_ALERT: "searchAlerts",
  TRAFFIC_ALERT: "trafficAlerts",
} as const satisfies Partial<Record<NotificationType, string>>;

/** The platform preference column that governs each platform type (§9.7). */
export const PLATFORM_PREFERENCE_FIELD = {
  INACTIVE_STORE: "inactiveStoreAlerts",
  STORE_DECLINE: "storeDeclineAlerts",
  INGESTION_HEALTH: "ingestionHealthAlerts",
  // The 400 signal shares the ingestion preference: it is the same operator asking "is
  // collection healthy?", and a separate toggle would let someone switch off the one signal
  // that means our own code is losing data (P6-25).
  CONTRACT_REJECTION: "ingestionHealthAlerts",
  AGGREGATION_HEALTH: "aggregationHealthAlerts",
  REDIS_FALLBACK: "redisFallbackAlerts",
  PUSH_DELIVERY: "pushDeliveryAlerts",
  PLATFORM_WEEKLY_SUMMARY: "weeklyPlatformSummary",
} as const satisfies Partial<Record<NotificationType, string>>;

/**
 * What each role may be sent (D60).
 *
 * `STORE_OWNER` is the person who owns the shop: they get everything on their side, including
 * the analytics alerts, because the numbers are theirs. A future non-owner staff role gets
 * `NEW_ORDER` and nothing else — a shop floor needs to know an order arrived, and "visits fell
 * 40%" is commercially sensitive in a way "a new order" is not.
 *
 * **There is no staff role in this codebase yet.** This table is the gate, built now so that
 * adding the role later is one entry here rather than an audit of every sender. `STAFF` is
 * declared as a key so the refusal can be checked today: `verify:notifications` asks for an
 * analytics alert for a staff-limited recipient and asserts nothing is written.
 */
export const NOTIFIABLE_TYPES: Record<NotifiableRole, readonly NotificationType[]> = {
  PLATFORM_ADMIN: [
    "INACTIVE_STORE",
    "STORE_DECLINE",
    "INGESTION_HEALTH",
    "CONTRACT_REJECTION",
    "AGGREGATION_HEALTH",
    "REDIS_FALLBACK",
    "PUSH_DELIVERY",
    "PLATFORM_WEEKLY_SUMMARY",
  ],
  STORE_OWNER: [
    "NEW_ORDER",
    "WEEKLY_SUMMARY",
    "PRODUCT_ALERT",
    "FUNNEL_ALERT",
    "SEARCH_ALERT",
    "TRAFFIC_ALERT",
  ],
  /** D60. Not a `Role` in the database yet; see the docstring above. */
  STAFF: ["NEW_ORDER"],
};

/** The roles this table knows about: the two that exist, plus D60's future one. */
export type NotifiableRole = Role | "STAFF";

export function mayReceive(role: NotifiableRole, type: NotificationType): boolean {
  return NOTIFIABLE_TYPES[role].includes(type);
}

/** Every type that is an analytics judgement rather than a confirmed fact (D54). */
export const ANALYTICS_ALERT_TYPES: readonly NotificationType[] = [
  "WEEKLY_SUMMARY",
  "PRODUCT_ALERT",
  "FUNNEL_ALERT",
  "SEARCH_ALERT",
  "TRAFFIC_ALERT",
];

/**
 * A new order needs no sample threshold: it is a fact, not an inference (D54). Everything else
 * on the owner's side is a reading of the numbers and must come from `insights.ts`'s thresholds.
 */
export const needsEvidence = (type: NotificationType) => ANALYTICS_ALERT_TYPES.includes(type);
