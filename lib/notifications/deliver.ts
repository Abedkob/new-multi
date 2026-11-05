/**
 * Getting one notification onto every one of a person's devices (§9.8, D52).
 *
 * Extracted so there is one sending loop rather than one per notification type. The loop is
 * where the delivery rules live — claim a lease before sending, record the outcome, expire a
 * device the push service has given up on — and three copies of it would be three chances to
 * get the lease wrong.
 *
 * Never throws. Every caller is either inside `after()` (where an unhandled rejection becomes
 * an uncaughtException) or inside a scheduled stage (where it would fail the whole run for one
 * unreachable phone).
 */

import {
  claimDelivery,
  queueDeliveries,
  recordDeliveryOutcome,
} from "@/lib/data/notifications";
import {
  markDeviceExpired,
  recordDeviceFailure,
  recordDeviceSuccess,
} from "@/lib/data/push-subscriptions";
import { withBypass } from "@/lib/prisma";
import { decryptPushSecret } from "@/lib/push/crypto";
import type { PushPayload } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/send";

export type DeliverableDevice = {
  id: string;
  endpointCiphertext: string;
  p256dhCiphertext: string;
  authCiphertext: string;
};

export type DeliverySummary = { queued: number; delivered: number; failed: number };

export async function deliverNotification(
  notificationId: string,
  tenantId: string | null,
  devices: readonly DeliverableDevice[],
  payload: PushPayload,
): Promise<DeliverySummary> {
  await queueDeliveries(notificationId, tenantId, devices.map((device) => device.id));
  const queued = await withBypass((db) =>
    db.adminNotificationDelivery.findMany({
      where: { notificationId, state: "PENDING" },
      select: { id: true, subscriptionId: true },
    }),
  );

  let delivered = 0;
  let failed = 0;
  for (const delivery of queued) {
    // The lease: if another sender already owns this delivery, leave it alone (D52).
    if (!(await claimDelivery(delivery.id))) continue;
    const device = devices.find((candidate) => candidate.id === delivery.subscriptionId);
    if (!device) continue;

    const verdict = await sendPush(
      {
        endpoint: decryptPushSecret(device.endpointCiphertext),
        p256dh: decryptPushSecret(device.p256dhCiphertext),
        auth: decryptPushSecret(device.authCiphertext),
      },
      payload,
    );
    if (verdict.state === "SENT") {
      delivered += 1;
      await recordDeliveryOutcome(delivery.id, { state: "SENT" });
      await recordDeviceSuccess(device.id);
    } else if (verdict.state === "SKIPPED") {
      // Push is not configured. The delivery stays PENDING, which is the truthful state: the
      // person was not told, and the lease recovery stage will try again if it ever is.
      continue;
    } else {
      failed += 1;
      await recordDeliveryOutcome(delivery.id, {
        state: verdict.state,
        errorCategory: verdict.errorCategory,
      });
      if (verdict.state === "EXPIRED") await markDeviceExpired(device.id);
      else await recordDeviceFailure(device.id);
    }
  }
  return { queued: queued.length, delivered, failed };
}
