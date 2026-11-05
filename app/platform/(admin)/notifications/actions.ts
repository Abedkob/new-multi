"use server";

import { revalidatePath } from "next/cache";
import {
  savePlatformPreferences,
  type PlatformPreferences,
} from "@/lib/data/notification-preferences";
import {
  PushEndpointRefused,
  PushUnavailable,
  listDevices,
  recordDeviceFailure,
  recordDeviceSuccess,
  registerDevice,
  revokeDevice,
  sendableDevices,
} from "@/lib/data/push-subscriptions";
import { decryptPushSecret } from "@/lib/push/crypto";
import { pushConfigured } from "@/lib/push/keys";
import { buildAlertPayload } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/send";
import { requirePlatformAdmin } from "@/lib/session";

/**
 * The platform admin's own notification settings (§11.9).
 *
 * The same data layer as the owner's, with `audience: "PLATFORM"` and no tenant — which is what
 * keeps the two inboxes apart (P6-19). A platform subscription has a null `tenantId`, so no
 * tenant-scoped query can ever see it, and the audience is part of every lookup.
 *
 * `requirePlatformAdmin` on every action, not just the page: an action imported by a page does
 * not go through that page's layout.
 */

export async function registerPlatformDeviceAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  deviceClass: string;
}) {
  const admin = await requirePlatformAdmin();
  if (!pushConfigured()) return { error: "Notifications are not configured on this platform." };
  if (!input.endpoint || !input.p256dh || !input.auth) {
    return { error: "This device did not provide everything needed to register it." };
  }
  try {
    await registerDevice({
      userId: admin.userId,
      // Null on purpose: a platform admin's device belongs to no store.
      tenantId: null,
      audience: "PLATFORM",
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      deviceLabel: input.deviceLabel || "This device",
      deviceClass: input.deviceClass || "unknown",
    });
  } catch (error) {
    if (error instanceof PushUnavailable) {
      return { error: "Notifications are not configured on this platform." };
    }
    if (error instanceof PushEndpointRefused) {
      return { error: "That notification address is not one this platform recognises." };
    }
    throw error;
  }
  revalidatePath("/platform/notifications");
  return {};
}

export async function removePlatformDeviceAction(deviceId: string) {
  const admin = await requirePlatformAdmin();
  const removed = await revokeDevice(admin.userId, deviceId);
  if (!removed) return { error: "That device has already been removed." };
  revalidatePath("/platform/notifications");
  return {};
}

export async function savePlatformPreferencesAction(values: PlatformPreferences) {
  const admin = await requirePlatformAdmin();
  const next: PlatformPreferences = {
    inactiveStoreAlerts: !!values.inactiveStoreAlerts,
    storeDeclineAlerts: !!values.storeDeclineAlerts,
    ingestionHealthAlerts: !!values.ingestionHealthAlerts,
    aggregationHealthAlerts: !!values.aggregationHealthAlerts,
    redisFallbackAlerts: !!values.redisFallbackAlerts,
    pushDeliveryAlerts: !!values.pushDeliveryAlerts,
    weeklyPlatformSummary: !!values.weeklyPlatformSummary,
  };
  await savePlatformPreferences(admin.userId, next);
  revalidatePath("/platform/notifications");
  return { ok: true as const };
}

/** A test notification to this admin's own devices. Not written to the ledger (see the owner's). */
export async function sendPlatformTestAction() {
  const admin = await requirePlatformAdmin();
  if (!pushConfigured()) return { error: "Notifications are not configured on this platform." };
  const devices = await sendableDevices(admin.userId, "PLATFORM");
  if (devices.length === 0) return { error: "No device is registered yet." };

  const payload = buildAlertPayload({
    type: "PLATFORM_WEEKLY_SUMMARY",
    text: { title: "Test notification", body: "Platform notifications are working." },
    recipientUserId: admin.userId,
    entityKey: "test",
    locale: "en",
    destination: "/platform/notifications",
  });

  let sent = 0;
  for (const device of devices) {
    const verdict = await sendPush(
      {
        endpoint: decryptPushSecret(device.endpointCiphertext),
        p256dh: decryptPushSecret(device.p256dhCiphertext),
        auth: decryptPushSecret(device.authCiphertext),
      },
      payload,
    );
    if (verdict.state === "SENT") {
      sent += 1;
      await recordDeviceSuccess(device.id);
    } else if (verdict.state !== "SKIPPED") {
      await recordDeviceFailure(device.id);
    }
  }
  revalidatePath("/platform/notifications");
  const total = (await listDevices(admin.userId, "PLATFORM")).length;
  return sent > 0
    ? { ok: true as const, sent, total }
    : { error: "The test could not be delivered to any of your devices." };
}
