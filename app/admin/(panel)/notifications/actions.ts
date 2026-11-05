"use server";

import { revalidatePath } from "next/cache";
import { recordAnalyticsAudit } from "@/lib/analytics/audit";
import {
  ensureOwnerPreferences,
  saveOwnerPreferences,
  type OwnerPreferences,
} from "@/lib/data/notification-preferences";
import {
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
import { buildNewOrderPayload } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/send";
import { requireOwner } from "@/lib/session";

/**
 * The owner's own notification settings (§11.2).
 *
 * `requireOwner` on every action, not just the page: a Server Action imported by a page does not
 * go through that page's layout. The user id comes from the session and the device id is checked
 * against it, so the worst a crafted call can do is remove a device the caller already owns.
 */

export type DeviceInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  deviceClass: string;
};

/**
 * Store a subscription the browser just created.
 *
 * The browser does the subscribing — permission can only be granted by a user gesture (P6-17) —
 * and hands the result here. This never asks for permission and never could.
 */
export async function registerDeviceAction(input: DeviceInput) {
  const owner = await requireOwner();
  if (!pushConfigured()) return { error: "notifications.error.unavailable" };
  if (!input.endpoint || !input.p256dh || !input.auth) {
    return { error: "notifications.error.incomplete" };
  }
  try {
    await registerDevice({
      userId: owner.userId,
      tenantId: owner.tenantId,
      audience: "OWNER",
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      deviceLabel: input.deviceLabel || "This device",
      deviceClass: input.deviceClass || "unknown",
    });
  } catch (error) {
    if (error instanceof PushUnavailable) return { error: "notifications.error.unavailable" };
    throw error;
  }
  revalidatePath("/admin/notifications");
  return {};
}

export async function removeDeviceAction(deviceId: string) {
  const owner = await requireOwner();
  const removed = await revokeDevice(owner.userId, deviceId);
  if (!removed) return { error: "notifications.error.deviceGone" };
  revalidatePath("/admin/notifications");
  return {};
}

export async function saveOwnerPreferencesAction(values: OwnerPreferences) {
  const owner = await requireOwner();
  const before = await ensureOwnerPreferences(owner.userId);
  // Booleans only, and only the known keys: the form is the owner's, but the shape of what is
  // written must not be.
  const next: OwnerPreferences = {
    newOrders: !!values.newOrders,
    weeklySummary: !!values.weeklySummary,
    productAlerts: !!values.productAlerts,
    funnelAlerts: !!values.funnelAlerts,
    searchAlerts: !!values.searchAlerts,
    trafficAlerts: !!values.trafficAlerts,
    showOrderAmount: !!values.showOrderAmount,
  };
  await saveOwnerPreferences(owner.userId, next);

  // One line in the audit trail when the amount setting changes, and only then. It is the only
  // preference that changes what leaves this platform and lands on a lock screen (D50), so
  // "who turned that on?" deserves an answer; the other six change nothing outside this account.
  if (before.showOrderAmount !== next.showOrderAmount) {
    await recordAnalyticsAudit({
      tenantId: owner.tenantId,
      actorUserId: owner.userId,
      actorEmail: owner.email,
      action: "INTEGRATION_CHANGE",
      subject: "owner",
      detail: `showOrderAmount: ${before.showOrderAmount} -> ${next.showOrderAmount}`,
    });
  }

  revalidatePath("/admin/notifications");
  return { ok: true as const, values: next };
}

/**
 * Send one notification to this owner's own devices, now (§11.2).
 *
 * Deliberately NOT written to the notification ledger: it is not a fact about the store, it is
 * the owner testing their phone, and a test row would sit in the trail looking like an order
 * that never existed. What it does share with a real send is the payload builder and the sender,
 * so a test that arrives proves the real path — the point of having one.
 */
export async function sendTestNotificationAction() {
  const owner = await requireOwner();
  if (!pushConfigured()) return { error: "notifications.error.unavailable" };

  const devices = await sendableDevices(owner.userId, "OWNER");
  if (devices.length === 0) return { error: "notifications.error.noDevices" };

  const payload = buildNewOrderPayload({
    facts: { count: 1, totalCents: null },
    text: { title: "Test notification", body: "Notifications are working." },
    recipientUserId: owner.userId,
    triggerOrderId: `test-${Date.now()}`,
    locale: "en",
    destination: "/admin/notifications",
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

  revalidatePath("/admin/notifications");
  const total = (await listDevices(owner.userId, "OWNER")).length;
  return sent > 0
    ? { ok: true as const, sent, total }
    : { error: "notifications.error.testFailed" };
}
