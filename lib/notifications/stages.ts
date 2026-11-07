/**
 * The notification work the scheduled command does (§10, §11.4).
 *
 * Three stages, and each exists because something that should have happened in a request did
 * not:
 *
 *   - `new-order-catch-up` — a deploy mid-checkout, a container stopped before its `after()`
 *     callback ran, push unconfigured when the order arrived. The instant path is best-effort by
 *     design (D51), and this is what makes that acceptable rather than lossy.
 *   - `delivery-lease-recovery` — a sender that died holding a lease. Its deliveries become
 *     claimable again once the lease expires, and this is what claims them.
 *   - `push-cleanup` — devices the push service has given up on, and ledger rows past their
 *     retention window. Without it, `PushSubscription` only ever grows and every send walks
 *     endpoints that have been dead for a year.
 *
 * All three are idempotent, bounded, and honour `dryRun` (D35): a first production run must be
 * able to report what it would do without doing it.
 */

import type { Stage, StageContext } from "@/lib/analytics/scheduled";
import { jobPrisma, withJobBypass } from "@/lib/prisma-job";
import { participationWhere } from "@/lib/analytics/rollout";
import { CATCH_UP_WINDOW_MS, announceNewOrder } from "@/lib/notifications/new-order";
import { claimDelivery, recordDeliveryOutcome } from "@/lib/data/notifications";
import { decryptPushSecret } from "@/lib/push/crypto";
import { pushConfigured } from "@/lib/push/keys";
import { sendPush } from "@/lib/push/send";
import { markDeviceExpired, recordDeviceFailure, recordDeviceSuccess } from "@/lib/data/push-subscriptions";
import {
  evaluateOwnerAlerts,
  sendWeeklySummary,
  weeklySummaryDue,
} from "@/lib/notifications/owner-alerts";
import {
  evaluatePlatformAlerts,
  findPlatformIssues,
  platformWeeklyDue,
  sendPlatformWeeklySummary,
} from "@/lib/notifications/platform-alerts";

/** How many stores, deliveries or devices one run will touch. */
const BATCH = 50;

/** After this many tries a device is left alone until it subscribes again. */
const MAX_DELIVERY_ATTEMPTS = 5;

/** How long a revoked or dead subscription is kept before it is removed for good. */
const DEAD_DEVICE_RETENTION_DAYS = 30;

/** How long the notification ledger is kept. Long enough to answer "was I told?", not forever. */
const NOTIFICATION_RETENTION_DAYS = 180;

/**
 * Orders nobody has been told about (§11.4 step 6).
 *
 * Driven from the ORDERS rather than from a queue: there is no "to notify" list to get out of
 * step with reality, and a store whose owner has notifications switched off simply yields
 * nothing. `announceNewOrder` does the claiming, so the instant path and this stage cannot
 * disagree about what counts as already told (D52).
 */
export const newOrderCatchUp: Stage = {
  name: "new-order-catch-up",
  async run(ctx: StageContext) {
    if (!pushConfigured()) {
      return { items: 0, detail: "push is not configured; nothing to catch up" };
    }
    const since = new Date(ctx.now.getTime() - CATCH_UP_WINDOW_MS);

    // One query for the candidates: recent, not cancelled, and with no notification row linking
    // them to this store's owner. A left join in Prisma's terms — `none` on the relation.
    const orders = await withJobBypass((db) =>
      db.order.findMany({
        where: {
          createdAt: { gte: since },
          status: { not: "CANCELLED" },
          notificationLinks: { none: {} },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, tenantId: true },
        take: BATCH,
      }),
    );
    if (orders.length === 0) return { items: 0, detail: "every recent order was announced" };

    // One notification per STORE, not per order: the first order of each store claims the rest
    // of that store's backlog, exactly as the instant path would have.
    const byTenant = new Map<string, string>();
    for (const order of orders) {
      if (!byTenant.has(order.tenantId)) byTenant.set(order.tenantId, order.id);
    }
    if (ctx.dryRun) {
      return {
        items: byTenant.size,
        detail: `would announce ${orders.length} order(s) across ${byTenant.size} store(s)`,
      };
    }

    let sent = 0;
    let orderCount = 0;
    for (const [tenantId, triggerOrderId] of byTenant) {
      // No batching window here: these orders are already minutes old, and waiting four more
      // seconds per store would only slow the run down.
      const outcome = await announceNewOrder(tenantId, triggerOrderId, { waitMs: 0, now: ctx.now });
      if (outcome.kind === "sent") {
        sent += 1;
        orderCount += outcome.orders;
      }
    }
    return {
      items: sent,
      detail: `${sent} notification(s) covering ${orderCount} order(s) across ${byTenant.size} store(s)`,
    };
  },
};

/**
 * Deliveries a dead sender left behind (§10, D52).
 *
 * The lease is what makes this safe: a delivery is only picked up once its lease has expired,
 * so this stage can never race the sender that owns it. An attempt count stops a device that
 * will never work from being retried forever — it is left FAILED and the owner sees "needs
 * enabling again" on their device list.
 */
export const deliveryLeaseRecovery: Stage = {
  name: "delivery-lease-recovery",
  async run(ctx: StageContext) {
    if (!pushConfigured()) return { items: 0, detail: "push is not configured" };

    const stranded = await withJobBypass((db) =>
      db.adminNotificationDelivery.findMany({
        where: { state: "SENDING", leaseExpiresAt: { lt: ctx.now } },
        select: {
          id: true,
          attempts: true,
          notification: { select: { title: true, body: true, destination: true, locale: true, dedupeKey: true } },
          subscription: {
            select: {
              id: true,
              endpointCiphertext: true,
              p256dhCiphertext: true,
              authCiphertext: true,
              revokedAt: true,
              expiredAt: true,
            },
          },
        },
        take: BATCH,
      }),
    );
    if (stranded.length === 0) return { items: 0, detail: "no stranded deliveries" };
    if (ctx.dryRun) {
      return { items: stranded.length, detail: `would retry ${stranded.length} stranded delivery(s)` };
    }

    let retried = 0;
    let abandoned = 0;
    for (const delivery of stranded) {
      if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
        await recordDeliveryOutcome(delivery.id, { state: "FAILED", errorCategory: "gave-up" });
        abandoned += 1;
        continue;
      }
      // A device removed or expired since the delivery was queued: nothing to retry.
      if (delivery.subscription.revokedAt || delivery.subscription.expiredAt) {
        await recordDeliveryOutcome(delivery.id, { state: "EXPIRED", errorCategory: "gone" });
        abandoned += 1;
        continue;
      }
      if (!(await claimDelivery(delivery.id, ctx.now))) continue;

      const payload = {
        title: delivery.notification.title,
        body: delivery.notification.body,
        // The notification's own dedupe key IS the tag: that is what makes a retry replace the
        // earlier banner on the device rather than buzzing twice (D52).
        tag: delivery.notification.dedupeKey,
        destination: delivery.notification.destination,
        lang: delivery.notification.locale === "ar" ? ("ar" as const) : ("en" as const),
        dir: delivery.notification.locale === "ar" ? ("rtl" as const) : ("ltr" as const),
      };
      const verdict = await sendPush(
        {
          endpoint: decryptPushSecret(delivery.subscription.endpointCiphertext),
          p256dh: decryptPushSecret(delivery.subscription.p256dhCiphertext),
          auth: decryptPushSecret(delivery.subscription.authCiphertext),
        },
        payload,
      );
      if (verdict.state === "SENT") {
        await recordDeliveryOutcome(delivery.id, { state: "SENT" });
        await recordDeviceSuccess(delivery.subscription.id);
        retried += 1;
      } else if (verdict.state !== "SKIPPED") {
        await recordDeliveryOutcome(delivery.id, {
          state: verdict.state,
          errorCategory: verdict.errorCategory,
        });
        if (verdict.state === "EXPIRED") await markDeviceExpired(delivery.subscription.id);
        else await recordDeviceFailure(delivery.subscription.id);
      }
    }
    return {
      items: retried,
      detail: `${retried} recovered, ${abandoned} given up, of ${stranded.length} stranded`,
    };
  },
};

/**
 * Dead devices and old ledger rows (§10).
 *
 * Deleted, not archived: a revoked subscription's only remaining value is the device label on a
 * delivery row, and those rows go at the same time. The windows are generous on purpose — "was
 * I told about this order?" is a question a merchant may ask weeks later.
 */
export const pushCleanup: Stage = {
  name: "push-cleanup",
  async run(ctx: StageContext) {
    const deviceCutoff = new Date(ctx.now.getTime() - DEAD_DEVICE_RETENTION_DAYS * 86_400_000);
    const ledgerCutoff = new Date(ctx.now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);

    const deadDevices = await withJobBypass((db) =>
      db.pushSubscription.count({
        where: { OR: [{ revokedAt: { lt: deviceCutoff } }, { expiredAt: { lt: deviceCutoff } }] },
      }),
    );
    const oldNotifications = await withJobBypass((db) =>
      db.adminNotification.count({ where: { createdAt: { lt: ledgerCutoff } } }),
    );
    if (ctx.dryRun) {
      return {
        items: deadDevices + oldNotifications,
        detail: `would remove ${deadDevices} dead device(s) and ${oldNotifications} ledger row(s)`,
      };
    }

    // Deliveries cascade from the notification, and from the subscription, so one delete each.
    const devices = await withJobBypass((db) =>
      db.pushSubscription.deleteMany({
        where: { OR: [{ revokedAt: { lt: deviceCutoff } }, { expiredAt: { lt: deviceCutoff } }] },
      }),
    );
    const notifications = await withJobBypass((db) =>
      db.adminNotification.deleteMany({ where: { createdAt: { lt: ledgerCutoff } } }),
    );
    return {
      items: devices.count + notifications.count,
      detail:
        `${devices.count} dead device(s) removed (over ${DEAD_DEVICE_RETENTION_DAYS}d), ` +
        `${notifications.count} ledger row(s) (over ${NOTIFICATION_RETENTION_DAYS}d)`,
    };
  },
};

/**
 * The owner's important alerts (§11.8, D54).
 *
 * Reads §6's insights per store and sends what qualifies, minus cooldowns and preferences. A
 * store with nothing qualifying yields nothing, which for most stores most days is the right
 * answer — the stage reporting "0 sent" is the common case, not a failure.
 */
export const ownerAlerts: Stage = {
  name: "owner-alerts",
  // The insight set needs seven reads per store, so this is allowed longer than a default stage.
  leaseMinutes: 10,
  async run(ctx: StageContext) {
    if (!pushConfigured()) return { items: 0, detail: "push is not configured" };
    const tenants = await ownerTenants();
    if (ctx.dryRun) {
      return { items: 0, detail: `would evaluate alerts for ${tenants.length} store(s)` };
    }
    let sent = 0;
    let suppressed = 0;
    for (const tenant of tenants) {
      const result = await evaluateOwnerAlerts(tenant, ctx.now);
      sent += result.sent;
      suppressed += result.suppressed;
    }
    return {
      items: sent,
      detail: `${sent} alert(s) sent, ${suppressed} suppressed across ${tenants.length} store(s)`,
    };
  },
};

/**
 * The Monday summary (§11.7).
 *
 * Due at 09:00 in each store's OWN zone, which is why this is a stage rather than a cron
 * expression: one platform-wide Monday 09:00 would reach merchants in different hours, and move
 * for all of them twice a year.
 */
export const ownerWeeklySummary: Stage = {
  name: "owner-weekly-summary",
  leaseMinutes: 10,
  async run(ctx: StageContext) {
    if (!pushConfigured()) return { items: 0, detail: "push is not configured" };
    const tenants = await ownerTenants();
    const due = tenants.filter((tenant) => weeklySummaryDue(tenant, ctx.now));
    if (due.length === 0) {
      return { items: 0, detail: `no store is at Monday 09:00 (${tenants.length} checked)` };
    }
    if (ctx.dryRun) {
      return { items: due.length, detail: `would send ${due.length} weekly summary(s)` };
    }
    let sent = 0;
    for (const tenant of due) {
      const result = await sendWeeklySummary(tenant, ctx.now);
      if (result.sent) sent += 1;
    }
    return { items: sent, detail: `${sent} of ${due.length} due summary(s) sent` };
  },
};

/**
 * Stores whose owner may receive an analytics notification.
 *
 * This used to be every store, with no filter — not even `analyticsPausedAt`. So an owner could
 * be sent an insight alert, or a Monday summary of zeros, about a store the platform had
 * explicitly silenced or had never switched on. The alerts read §6's insights, which treat an
 * unmeasured figure as unknown rather than low (D54), so a false "your conversion dropped" was
 * unlikely — but a weekly summary of zeros to a store that was never measured is still a push
 * notification asserting something untrue.
 *
 * The new-order notification is NOT gated this way: an order is an order whether or not the
 * store is in the analytics rollout.
 */
function ownerTenants() {
  return withJobBypass((db) =>
    db.tenant.findMany({
      where: participationWhere(),
      select: {
        id: true,
        analyticsTimezone: true,
        defaultLocale: true,
        owner: { select: { id: true, adminLocale: true } },
      },
      take: BATCH,
      orderBy: { createdAt: "asc" },
    }),
  );
}

/**
 * Platform alerts (§11.10, D55).
 *
 * Evaluates the conditions and sends only the transitions. A run that finds three problems that
 * were already firing sends nothing and says so, which is the behaviour that keeps an operator
 * reading the ones that do arrive.
 */
export const platformAlerts: Stage = {
  name: "platform-alerts",
  leaseMinutes: 10,
  async run(ctx: StageContext) {
    if (!pushConfigured()) return { items: 0, detail: "push is not configured" };
    if (ctx.dryRun) {
      const findings = await findPlatformIssues(ctx.now);
      return {
        items: findings.length,
        detail:
          findings.length === 0
            ? "nothing is wrong"
            : `would consider ${findings.length}: ${findings.map((f) => f.type).join(", ")}`,
      };
    }
    const result = await evaluatePlatformAlerts(ctx.now);
    return {
      items: result.sent,
      detail:
        `${result.findings} finding(s): ${result.sent} sent, ${result.suppressed} already firing, ` +
        `${result.resolved} cleared`,
    };
  },
};

/** The platform's Monday summary (§11.11). */
export const platformWeeklySummary: Stage = {
  name: "platform-weekly-summary",
  async run(ctx: StageContext) {
    if (!pushConfigured()) return { items: 0, detail: "push is not configured" };
    if (!platformWeeklyDue(ctx.now)) {
      return { items: 0, detail: "not Monday 09:00 in the platform's zone" };
    }
    if (ctx.dryRun) return { items: 1, detail: "would send the platform weekly summary" };
    const result = await sendPlatformWeeklySummary(ctx.now);
    return { items: result.sent, detail: `${result.sent} summary(s) sent` };
  },
};

export const NOTIFICATION_STAGES: Stage[] = [
  newOrderCatchUp,
  ownerAlerts,
  ownerWeeklySummary,
  platformAlerts,
  platformWeeklySummary,
  deliveryLeaseRecovery,
  pushCleanup,
];

/** Exposed for the checks: the windows, so a check cannot hard-code a different number. */
export const NOTIFICATION_RETENTION = {
  deadDeviceDays: DEAD_DEVICE_RETENTION_DAYS,
  ledgerDays: NOTIFICATION_RETENTION_DAYS,
  maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
};

/** For a check that wants the job's own client without the scheduler. */
export const notificationJobPrisma = jobPrisma;
