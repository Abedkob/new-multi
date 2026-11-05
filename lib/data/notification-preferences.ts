/**
 * What each person wants to be told about (§9.7, D60).
 *
 * Two rules from §11.2, both of them easy to break by accident:
 *
 *   - **Everything defaults on**, except the order amount (D50). A merchant who installs the app
 *     and switches on notifications expects to hear about orders, not to find six toggles off.
 *   - **Preferences belong to the person, not the device.** Adding a device inherits them, and
 *     removing one changes nothing. Both fall out of the row being keyed by `userId` — which is
 *     the whole reason it is, and why neither needs code of its own.
 *
 * `ensure*` reads through a create: the row does not exist until someone looks, so a store
 * created in Phase 1 needs no backfill and a new user needs no hook at signup.
 */

import type { NotificationType } from "@/generated/prisma/client";
import { withBypass } from "@/lib/prisma";
import {
  OWNER_PREFERENCE_FIELD,
  PLATFORM_PREFERENCE_FIELD,
  mayReceive,
  type NotifiableRole,
} from "@/lib/notifications/types";

export type OwnerPreferences = {
  newOrders: boolean;
  weeklySummary: boolean;
  productAlerts: boolean;
  funnelAlerts: boolean;
  searchAlerts: boolean;
  trafficAlerts: boolean;
  showOrderAmount: boolean;
};

export type PlatformPreferences = {
  inactiveStoreAlerts: boolean;
  storeDeclineAlerts: boolean;
  ingestionHealthAlerts: boolean;
  aggregationHealthAlerts: boolean;
  redisFallbackAlerts: boolean;
  pushDeliveryAlerts: boolean;
  weeklyPlatformSummary: boolean;
};

const OWNER_SELECT = {
  newOrders: true,
  weeklySummary: true,
  productAlerts: true,
  funnelAlerts: true,
  searchAlerts: true,
  trafficAlerts: true,
  showOrderAmount: true,
} as const;

const PLATFORM_SELECT = {
  inactiveStoreAlerts: true,
  storeDeclineAlerts: true,
  ingestionHealthAlerts: true,
  aggregationHealthAlerts: true,
  redisFallbackAlerts: true,
  pushDeliveryAlerts: true,
  weeklyPlatformSummary: true,
} as const;

export function ensureOwnerPreferences(userId: string): Promise<OwnerPreferences> {
  return withBypass(async (db) => {
    const existing = await db.ownerNotificationPreference.findUnique({
      where: { userId },
      select: OWNER_SELECT,
    });
    if (existing) return existing;
    // The defaults live in the schema, so creating the row IS reading the defaults — there is no
    // second list here to disagree with it.
    return db.ownerNotificationPreference.create({ data: { userId }, select: OWNER_SELECT });
  });
}

export function ensurePlatformPreferences(userId: string): Promise<PlatformPreferences> {
  return withBypass(async (db) => {
    const existing = await db.platformNotificationPreference.findUnique({
      where: { userId },
      select: PLATFORM_SELECT,
    });
    if (existing) return existing;
    return db.platformNotificationPreference.create({ data: { userId }, select: PLATFORM_SELECT });
  });
}

export function saveOwnerPreferences(
  userId: string,
  values: OwnerPreferences,
): Promise<OwnerPreferences> {
  return withBypass((db) =>
    db.ownerNotificationPreference.upsert({
      where: { userId },
      create: { userId, ...values },
      update: values,
      select: OWNER_SELECT,
    }),
  );
}

export function savePlatformPreferences(
  userId: string,
  values: PlatformPreferences,
): Promise<PlatformPreferences> {
  return withBypass((db) =>
    db.platformNotificationPreference.upsert({
      where: { userId },
      create: { userId, ...values },
      update: values,
      select: PLATFORM_SELECT,
    }),
  );
}

/**
 * May this person be sent this, right now?
 *
 * Both halves in one place: the role gate (D60) and the person's own switch. A sender that
 * checked only the preference would deliver an analytics alert to an account whose role forbids
 * it the moment someone's preference row said true.
 */
export async function wantsNotification(
  userId: string,
  role: NotifiableRole,
  type: NotificationType,
): Promise<boolean> {
  if (!mayReceive(role, type)) return false;

  const ownerField = OWNER_PREFERENCE_FIELD[type as keyof typeof OWNER_PREFERENCE_FIELD];
  if (ownerField) {
    const prefs = await ensureOwnerPreferences(userId);
    return prefs[ownerField as keyof OwnerPreferences];
  }
  const platformField =
    PLATFORM_PREFERENCE_FIELD[type as keyof typeof PLATFORM_PREFERENCE_FIELD];
  if (platformField) {
    const prefs = await ensurePlatformPreferences(userId);
    return prefs[platformField as keyof PlatformPreferences];
  }
  // A type with no preference governing it is a type nobody can switch off, which is not a
  // decision this function may make on its own.
  return false;
}
