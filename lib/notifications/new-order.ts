/**
 * Telling an owner an order arrived (§11.4, §11.6; D51, D52, D53).
 *
 * One function for both paths — the instant one that runs in `after()` and the scheduled
 * catch-up — because two implementations of "which orders has this owner not been told about"
 * would eventually disagree, and the way they would disagree is a duplicate notification or a
 * silent one.
 *
 * The shape, in order, and why each step is where it is:
 *
 *   1. **The order has already committed.** This is never called from inside the order
 *      transaction, and never before it commits (D51). The caller passes an id that exists.
 *   2. **An owner-scoped advisory lock.** The first callback takes it; a second one, for an
 *      order placed a second later, finds it taken and returns immediately. It does not wait,
 *      because the first callback is about to claim its order too.
 *   3. **A short wait.** ~4 seconds, inside `after()`, so a burst from a shared post becomes
 *      one notification rather than five. Nobody's response is delayed by it.
 *   4. **Claim, then write the body.** The count is not known until the claim returns (D53).
 *   5. **Send, recording each device's outcome.** Nothing here throws: the sender returns
 *      verdicts, and an owner's phone being unreachable is not an error in an order.
 *
 * Every step is best-effort by design. A thrown exception inside `after()` is an unhandled
 * rejection, and in Next.js that is an `uncaughtException` — so the entry point swallows
 * everything and records what it can.
 */

import { withBypass } from "@/lib/prisma";
import { wantsNotification, ensureOwnerPreferences } from "@/lib/data/notification-preferences";
import {
  claimOrdersForNotification,
  finalizeBody,
  queueDeliveries,
  claimDelivery,
  recordDeliveryOutcome,
  announcedOrderIds,
} from "@/lib/data/notifications";
import {
  recordDeviceFailure,
  recordDeviceSuccess,
  markDeviceExpired,
  sendableDevices,
} from "@/lib/data/push-subscriptions";
import { decryptPushSecret } from "@/lib/push/crypto";
import { pushConfigured } from "@/lib/push/keys";
import { buildNewOrderPayload, assertPayloadIsSafe } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/send";
import { newOrderText, type NotificationLocale } from "@/lib/notifications/templates";
import { orderTotal } from "@/lib/orders";

/** How long a burst of orders is collapsed into one notification (D53). */
export const BATCH_WINDOW_MS = 4_000;

/** How far back a catch-up or a batch will look for orders nobody has been told about. */
export const CATCH_UP_WINDOW_MS = 30 * 60_000;

export type AnnounceOutcome =
  | { kind: "sent"; notificationId: string; orders: number; devices: number; delivered: number }
  /** Another callback owns this owner's window, and will claim this order too. */
  | { kind: "deferred" }
  /** Nothing to say: already announced, switched off, or no device to say it to. */
  | { kind: "nothing"; reason: string };

/**
 * A Postgres advisory lock keyed on the recipient.
 *
 * `pg_try_advisory_xact_lock` rather than a row: it needs no table, it is released when the
 * transaction ends however the process dies, and "try" means a second caller is told
 * immediately instead of queueing behind a 4-second window it has no reason to wait for.
 *
 * The whole batch runs inside this one transaction, which is also what makes the wait safe: if
 * this process is killed mid-window, the lock goes with it and the catch-up stage finds the
 * orders unclaimed.
 */
async function withOwnerLock<T>(
  recipientUserId: string,
  work: () => Promise<T>,
): Promise<T | { kind: "deferred" }> {
  return withBypass(async (db) => {
    const key = lockKeyExpression(`new-order:${recipientUserId}`);
    const [row] = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked
    `;
    if (!row?.locked) return { kind: "deferred" as const };
    return work();
  });
}

/**
 * A stable key for the advisory lock, derived from the recipient.
 *
 * `hashtext()` is Postgres's own, so the number is computed where it is used and there is no
 * second hash implementation here to drift from it. It is not stable across major versions,
 * which does not matter: a lock key only has to agree with itself within one cluster, and a
 * changed key across an upgrade means at worst one notification that batches on its own.
 */
function lockKeyExpression(value: string) {
  return value;
}

/**
 * Announce every order this owner has not been told about yet, triggered by one of them.
 *
 * Returns rather than throws. `trigger` names the order whose commit woke this up, and is what
 * makes the notification's dedupe key stable for the instant and catch-up paths.
 */
export async function announceNewOrder(
  tenantId: string,
  triggerOrderId: string,
  options: { waitMs?: number; now?: Date } = {},
): Promise<AnnounceOutcome> {
  const wait = options.waitMs ?? BATCH_WINDOW_MS;
  const now = options.now ?? new Date();

  const tenant = await withBypass((db) =>
    db.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        defaultLocale: true,
        owner: { select: { id: true, adminLocale: true } },
      },
    }),
  );
  if (!tenant?.owner) return { kind: "nothing", reason: "no owner" };
  const recipientUserId = tenant.owner.id;

  if (!(await wantsNotification(recipientUserId, "STORE_OWNER", "NEW_ORDER"))) {
    return { kind: "nothing", reason: "new-order notifications are switched off" };
  }
  // Checked before the lock and the wait: with no device registered there is nothing to batch
  // for, and holding an owner's lock for four seconds to send nothing is pure cost.
  const devices = await sendableDevices(recipientUserId, "OWNER");
  if (devices.length === 0) return { kind: "nothing", reason: "no registered device" };

  // The language the owner reads, with no request to ask (D58): their own saved choice, then
  // the store's default, then English.
  const locale: NotificationLocale =
    tenant.owner.adminLocale === "ar" || tenant.owner.adminLocale === "en"
      ? tenant.owner.adminLocale
      : tenant.defaultLocale === "ar"
        ? "ar"
        : "en";

  const outcome = await withOwnerLock(recipientUserId, async () => {
    // The batching window. A second order placed during it is claimed below rather than
    // producing its own notification (D53).
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const since = new Date(now.getTime() - CATCH_UP_WINDOW_MS);
    const recent = await withBypass((db) =>
      db.order.findMany({
        where: {
          tenantId,
          createdAt: { gte: since },
          // A cancelled order is not news. One cancelled inside the window simply drops out.
          status: { not: "CANCELLED" },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          deliveryFeeCentsSnapshot: true,
          couponDiscountCentsSnapshot: true,
          items: { select: { priceCentsSnapshot: true, quantity: true } },
        },
        take: 50,
      }),
    );
    const alreadyTold = await announcedOrderIds(recipientUserId, recent.map((order) => order.id));
    const pending = recent.filter((order) => !alreadyTold.has(order.id));
    if (pending.length === 0) {
      return { kind: "nothing" as const, reason: "every recent order was already announced" };
    }

    // The amount, only if the owner asked for it (D50). Read here rather than passed in, so no
    // caller can hand this function a figure it was not allowed to use.
    const preferences = await ensureOwnerPreferences(recipientUserId);
    const totalCents = preferences.showOrderAmount
      ? pending.reduce(
          (sum, order) =>
            sum +
            orderTotal(
              order.items,
              order.deliveryFeeCentsSnapshot,
              order.couponDiscountCentsSnapshot ?? 0,
            ),
          0,
        )
      : null;

    const provisional = newOrderText(locale, { count: pending.length, totalCents });
    const claim = await claimOrdersForNotification(
      {
        recipientUserId,
        recipientRole: "STORE_OWNER",
        audience: "OWNER",
        type: "NEW_ORDER",
        tenantId,
        title: provisional.title,
        body: provisional.body,
        destination: "/admin/orders",
        locale,
        dedupeKey: `owner-order:${recipientUserId}:${triggerOrderId}`,
      },
      pending.map((order) => order.id),
    );
    if (claim.kind === "already-sent") {
      return { kind: "nothing" as const, reason: "another sender claimed these orders" };
    }

    // The count is only now final: another sender may have taken some of them (D53).
    const claimedTotal = preferences.showOrderAmount
      ? pending
          .filter((order) => claim.orderIds.includes(order.id))
          .reduce(
            (sum, order) =>
              sum +
              orderTotal(
                order.items,
                order.deliveryFeeCentsSnapshot,
                order.couponDiscountCentsSnapshot ?? 0,
              ),
            0,
          )
      : null;
    const text = newOrderText(locale, { count: claim.orderIds.length, totalCents: claimedTotal });
    await finalizeBody(claim.notificationId, text);

    const payload = assertPayloadIsSafe(
      buildNewOrderPayload({
        facts: { count: claim.orderIds.length, totalCents: claimedTotal },
        text,
        recipientUserId,
        triggerOrderId,
        locale,
      }),
    );

    await queueDeliveries(claim.notificationId, tenantId, devices.map((device) => device.id));
    const queued = await withBypass((db) =>
      db.adminNotificationDelivery.findMany({
        where: { notificationId: claim.notificationId, state: "PENDING" },
        select: { id: true, subscriptionId: true },
      }),
    );

    let delivered = 0;
    for (const delivery of queued) {
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
        // Push is not configured. The notification stays PENDING, which is the truthful state:
        // the owner was never told, and nothing here pretends otherwise.
        continue;
      } else {
        await recordDeliveryOutcome(delivery.id, {
          state: verdict.state,
          errorCategory: verdict.errorCategory,
        });
        if (verdict.state === "EXPIRED") await markDeviceExpired(device.id);
        else await recordDeviceFailure(device.id);
      }
    }

    return {
      kind: "sent" as const,
      notificationId: claim.notificationId,
      orders: claim.orderIds.length,
      devices: queued.length,
      delivered,
    };
  });

  return outcome as AnnounceOutcome;
}

/**
 * The entry point for the instant path, safe to hand to `after()` (D51).
 *
 * Swallows everything. An order is already the shopper's by the time this runs, and the only
 * thing a failure here may cost is a notification — never the order, never the response, and
 * never the process.
 */
export function announceNewOrderSafely(tenantId: string, orderId: string): Promise<void> {
  if (!pushConfigured()) return Promise.resolve();
  return announceNewOrder(tenantId, orderId)
    .then((outcome) => {
      if (outcome.kind === "sent") {
        console.log(
          `[notify] order ${orderId}: ${outcome.orders} order(s) to ${outcome.delivered}/${outcome.devices} device(s)`,
        );
      }
    })
    .catch((error) => {
      console.error(
        `[notify] order ${orderId} notification failed:`,
        error instanceof Error ? error.message : error,
      );
    });
}
