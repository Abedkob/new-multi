/**
 * The notification ledger: who was told what, and which device got it (§9.8).
 *
 * This module is the whole of Phase 6's deduplication guarantee, so it is worth being precise
 * about which constraint does what (D52):
 *
 *   - **`AdminNotification.dedupeKey` is unique.** The same trigger processed twice — the
 *     instant path and then the catch-up stage for one order — cannot produce two notifications.
 *   - **`AdminNotificationOrder` is unique on (recipientUserId, orderId).** Two *different*
 *     triggers racing (two orders seconds apart, two concurrent `after()` callbacks) each try to
 *     claim the orders they can see. An order can only be claimed once, so the second
 *     transaction claims nothing and rolls back without sending.
 *   - **`AdminNotificationDelivery` carries a lease.** A sender that crashed mid-send leaves a
 *     lease that expires; until it does, nobody else claims that delivery.
 *
 * Three layers because they fail differently, and the alternative — one of them plus careful
 * ordering — is the kind of correctness that holds until the first slow request.
 *
 * Writes go through `withBypass`: these rows are keyed by *recipient*, a notification may be
 * platform-wide (`tenantId` null, invisible under any tenant policy), and the scheduled job has
 * no tenant context when it sweeps. The tenant policy still protects the rows from a store
 * reading another's — see the migration.
 */

import { Prisma } from "@/generated/prisma/client";
import type {
  NotificationAudience,
  NotificationDeliveryState,
  NotificationType,
} from "@/generated/prisma/client";
import { withBypass } from "@/lib/prisma";
import { TYPE_AUDIENCE, mayReceive, type NotifiableRole } from "@/lib/notifications/types";

export class NotificationRefused extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export type NotificationDraft = {
  recipientUserId: string;
  /** The recipient's role, which decides what they may be sent at all (D60). */
  recipientRole: NotifiableRole;
  audience: NotificationAudience;
  type: NotificationType;
  tenantId: string | null;
  title: string;
  body: string;
  destination: string;
  locale: string;
  dedupeKey: string;
  cooldownKey?: string | null;
};

/**
 * The two refusals every write goes through, before any row exists.
 *
 * Checked here rather than at each caller because "a staff account never receives an analytics
 * alert" is only true if it is true of the writer. A sender that forgot is a bug; a writer that
 * cannot be asked is a guarantee.
 */
function assertAllowed(draft: NotificationDraft) {
  if (!mayReceive(draft.recipientRole, draft.type)) {
    throw new NotificationRefused(
      `${draft.recipientRole} may not receive ${draft.type} (D60)`,
    );
  }
  if (TYPE_AUDIENCE[draft.type] !== draft.audience) {
    throw new NotificationRefused(
      `${draft.type} belongs to ${TYPE_AUDIENCE[draft.type]}, not ${draft.audience}`,
    );
  }
}

export type ClaimOutcome =
  | { kind: "claimed"; notificationId: string; orderIds: string[] }
  /** Another sender got there first. Nothing was written, and nothing should be sent. */
  | { kind: "already-sent" };

/**
 * Create a notification and claim the orders it covers, atomically.
 *
 * `orderIds` is what the caller *hopes* to announce. What comes back is what it actually
 * claimed, which may be fewer — another callback may have taken some — and if it claimed none,
 * the whole transaction rolls back and the answer is `already-sent`. The body is therefore
 * written by the caller AFTER this returns, because its wording depends on the count ("a new
 * order" vs "3 new orders", D53); `finalizeBody` is the second half.
 */
export async function claimOrdersForNotification(
  draft: NotificationDraft,
  orderIds: readonly string[],
): Promise<ClaimOutcome> {
  // `async`, so every refusal below is a REJECTED PROMISE rather than a synchronous throw. A
  // function that sometimes throws before it returns a promise is a trap for its callers: the
  // instant path runs inside `after()`, where a synchronous throw escapes a different way from a
  // rejection, and a verification check that awaits it would miss the sync case entirely (which
  // is exactly how this was found).
  assertAllowed(draft);
  if (draft.type !== "NEW_ORDER") {
    throw new NotificationRefused("only NEW_ORDER notifications claim orders");
  }
  if (!draft.tenantId) throw new NotificationRefused("a NEW_ORDER notification needs a store");
  if (orderIds.length === 0) return { kind: "already-sent" };

  return withBypass(async (db) => {
    let notificationId: string;
    try {
      const created = await db.adminNotification.create({
        data: {
          recipientUserId: draft.recipientUserId,
          audience: draft.audience,
          type: draft.type,
          tenantId: draft.tenantId,
          title: draft.title,
          body: draft.body,
          destination: draft.destination,
          locale: draft.locale,
          dedupeKey: draft.dedupeKey,
          cooldownKey: draft.cooldownKey ?? null,
        },
        select: { id: true },
      });
      notificationId = created.id;
    } catch (error) {
      // The same trigger, twice: instant and catch-up, or two runs of the catch-up stage.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { kind: "already-sent" };
      }
      throw error;
    }

    // One insert per order, skipping any already claimed by another notification. This is the
    // race: two senders both get here, both insert, and the unique constraint decides.
    await db.adminNotificationOrder.createMany({
      data: orderIds.map((orderId) => ({
        notificationId,
        orderId,
        recipientUserId: draft.recipientUserId,
        tenantId: draft.tenantId!,
      })),
      skipDuplicates: true,
    });
    const claimed = await db.adminNotificationOrder.findMany({
      where: { notificationId },
      select: { orderId: true },
    });

    if (claimed.length === 0) {
      // Every order we meant to announce was announced by somebody else. Delete our own empty
      // notification rather than leaving a row that says we told the owner nothing.
      await db.adminNotification.delete({ where: { id: notificationId } });
      return { kind: "already-sent" };
    }
    return { kind: "claimed", notificationId, orderIds: claimed.map((row) => row.orderId) };
  });
}

/**
 * Create a notification that is not about orders, once.
 *
 * The unique `dedupeKey` is the whole mechanism: an alert keyed on
 * `<type>:<recipient>:<entity>:<local day>` can be evaluated by every run of the scheduled
 * command and written once. `null` means it already exists, which is a normal answer and not an
 * error — most runs of the alert stage produce nothing but nulls.
 */
export async function claimNotification(draft: NotificationDraft): Promise<{ id: string } | null> {
  assertAllowed(draft);
  try {
    return await withBypass((db) =>
      db.adminNotification.create({
        data: {
          recipientUserId: draft.recipientUserId,
          audience: draft.audience,
          type: draft.type,
          tenantId: draft.tenantId,
          title: draft.title,
          body: draft.body,
          destination: draft.destination,
          locale: draft.locale,
          dedupeKey: draft.dedupeKey,
          cooldownKey: draft.cooldownKey ?? null,
        },
        select: { id: true },
      }),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/** The body, once the count is known (D53). Called before any delivery is created. */
export function finalizeBody(
  notificationId: string,
  text: { title: string; body: string },
): Promise<void> {
  return withBypass(async (db) => {
    await db.adminNotification.update({ where: { id: notificationId }, data: text });
  });
}

/**
 * Create one PENDING delivery per active subscription, and nothing for a device that is gone.
 *
 * Idempotent: `skipDuplicates` on (notificationId, subscriptionId), so a retried sender adds no
 * second row for a device it already queued.
 */
export function queueDeliveries(
  notificationId: string,
  tenantId: string | null,
  subscriptionIds: readonly string[],
): Promise<number> {
  if (subscriptionIds.length === 0) return Promise.resolve(0);
  return withBypass(async (db) => {
    const result = await db.adminNotificationDelivery.createMany({
      data: subscriptionIds.map((subscriptionId) => ({
        notificationId,
        subscriptionId,
        tenantId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  });
}

export const LEASE_MS = 60_000;

/**
 * Take ownership of a delivery for `LEASE_MS`, or find that somebody else has it.
 *
 * A conditional UPDATE, not a read-then-write: the `WHERE` names the states a delivery may be
 * claimed from, so two senders issuing this at the same moment produce one winner and one
 * `count: 0`. The same shape as the stock deduction in checkout, for the same reason.
 */
export async function claimDelivery(deliveryId: string, now = new Date()): Promise<boolean> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const claimed = await withBypass((db) =>
    db.adminNotificationDelivery.updateMany({
      where: {
        id: deliveryId,
        OR: [
          { state: "PENDING" },
          // A crashed sender's lease has run out: the delivery is free again.
          { state: "SENDING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: { state: "SENDING", leaseExpiresAt: lease, attempts: { increment: 1 } },
    }),
  );
  return claimed.count === 1;
}

export function recordDeliveryOutcome(
  deliveryId: string,
  outcome:
    | { state: "SENT" }
    | { state: "FAILED" | "EXPIRED"; errorCategory: string },
): Promise<void> {
  return withBypass(async (db) => {
    await db.adminNotificationDelivery.update({
      where: { id: deliveryId },
      data:
        outcome.state === "SENT"
          ? { state: "SENT", sentAt: new Date(), leaseExpiresAt: null, errorCategory: null }
          : {
              state: outcome.state,
              leaseExpiresAt: null,
              errorCategory: outcome.errorCategory.slice(0, 40),
            },
    });
  });
}

/** Deliveries a crashed sender left behind, for the scheduled recovery stage. */
export function listExpiredLeases(now = new Date(), take = 200) {
  return withBypass((db) =>
    db.adminNotificationDelivery.findMany({
      where: { state: "SENDING", leaseExpiresAt: { lt: now } },
      select: { id: true, notificationId: true, subscriptionId: true, attempts: true },
      take,
    }),
  );
}

/** Which of these orders has already been announced to this person (for the catch-up stage). */
export async function announcedOrderIds(
  recipientUserId: string,
  orderIds: readonly string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const rows = await withBypass((db) =>
    db.adminNotificationOrder.findMany({
      where: { recipientUserId, orderId: { in: [...orderIds] } },
      select: { orderId: true },
    }),
  );
  return new Set(rows.map((row) => row.orderId));
}

/** The newest notification for a cooldown key, which is what a cooldown is measured from (D54). */
export function lastNotificationFor(cooldownKey: string) {
  return withBypass((db) =>
    db.adminNotification.findFirst({
      where: { cooldownKey },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, type: true },
    }),
  );
}

/** For the checks and the platform health view: what a notification actually said. */
export function notificationWithDeliveries(notificationId: string) {
  return withBypass((db) =>
    db.adminNotification.findUnique({
      where: { id: notificationId },
      include: {
        orders: { select: { orderId: true } },
        deliveries: {
          select: { id: true, subscriptionId: true, state: true, attempts: true, errorCategory: true },
        },
      },
    }),
  );
}

export type DeliveryState = NotificationDeliveryState;
