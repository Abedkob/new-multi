/**
 * What wakes a platform operator (§11.10, §11.11; D55).
 *
 * Two rules, and the second is the one that keeps the first worth having:
 *
 *   1. **The thresholds are data**, like Phase 5's insight thresholds. Changing one is a diff on
 *      one line rather than an edit inside a condition nobody revisits.
 *   2. **An alert fires on the TRANSITION, not on the condition.** `NotificationAlertState`
 *      holds whether each (type, entity) is currently firing. An inactive store alerts when it
 *      becomes inactive, not every five minutes for as long as it stays that way — which is how
 *      a team learns to ignore its own alerts — and alerts again only after it recovers and
 *      stops again (P6-26).
 *
 * The findings themselves are Phase 4's and Phase 5's: `platformConsole` for the store-level
 * ones, the operational metrics for ingestion, the aggregation cursors for lag. This module
 * decides when to speak, not what is true.
 */

import type { NotificationType } from "@/generated/prisma/client";
import { lastNLocalDays } from "@/lib/analytics/compare";
import { platformConsole } from "@/lib/data/platform-analytics";
import { claimNotification } from "@/lib/data/notifications";
import { wantsNotification } from "@/lib/data/notification-preferences";
import { sendableDevices } from "@/lib/data/push-subscriptions";
import { withBypass } from "@/lib/prisma";
import { env } from "@/lib/env";
import { deliverNotification } from "@/lib/notifications/deliver";
import { platformAlertText, platformWeeklyText } from "@/lib/notifications/templates";
import { buildAlertPayload } from "@/lib/push/payload";

/**
 * §11.10's numbers, as data (D55).
 *
 * Each one is a product decision with a cost attached: too low and the alert is noise, too high
 * and a real outage is quiet. They are named here so that cost is visible.
 */
export const PLATFORM_THRESHOLDS = {
  /** §11.10: at least a 50% fall, against a baseline worth comparing to. */
  declinePercent: 50,
  declineMinSessions: 20,
  declineMinOrders: 5,
  /** Aggregation older than this is behind, not merely late. */
  aggregationLagMinutes: 20,
  /** Over this share of attempted pushes failing, with at least this many attempts. */
  pushFailurePercent: 20,
  pushMinAttempts: 10,
  /** Cooldown per (type, entity), so a condition that persists does not notify repeatedly. */
  cooldownHours: 24 * 7,
} as const;

export type AlertFinding = {
  type: NotificationType;
  /** What the alert is about: a store slug, a stage name, "global". Part of its identity. */
  entityKey: string;
  tenantId: string | null;
  kind:
    | "inactive-store"
    | "store-decline"
    | "ingestion"
    | "contract-rejection"
    | "aggregation"
    | "redis"
    | "push-delivery";
  subject: string;
  detail: string;
};

/**
 * Everything currently wrong, as findings. Pure of notification concerns — a caller could print
 * this list on the health screen instead of sending it, which is what makes it checkable.
 */
export async function findPlatformIssues(now: Date): Promise<AlertFinding[]> {
  const findings: AlertFinding[] = [];
  const range = lastNLocalDays(7, now, "UTC");
  const report = await platformConsole(range);

  for (const store of report.inactive) {
    findings.push({
      type: "INACTIVE_STORE",
      entityKey: store.slug,
      tenantId: store.tenantId,
      kind: "inactive-store",
      subject: store.name,
      detail: "no visit, order or WhatsApp message in seven days",
    });
  }

  for (const store of report.declining) {
    const sessions = store.trends.sessions.delta;
    // §11.10's baseline: a store that went from 4 sessions to 1 has not "declined 75%", it has
    // had a quiet week, and an alert about it is noise.
    const baseline = sessions.previous >= PLATFORM_THRESHOLDS.declineMinSessions;
    const halved =
      sessions.percent !== null && sessions.percent <= -PLATFORM_THRESHOLDS.declinePercent;
    if (!baseline || !halved) continue;
    findings.push({
      type: "STORE_DECLINE",
      entityKey: store.slug,
      tenantId: store.tenantId,
      kind: "store-decline",
      subject: store.name,
      detail: `${sessions.current} visits against ${sessions.previous} the week before`,
    });
  }

  // Ingestion and the contract signal, from the newest flushed window (Phase 4's counters).
  const metric = await withBypass((db) =>
    db.analyticsOperationalMetric.findFirst({ orderBy: { windowEnd: "desc" } }),
  );
  if (metric) {
    const attempted = metric.attemptedBatches;
    const operationalPercent = attempted > 0 ? (metric.operationalDrops / attempted) * 100 : 0;
    if (
      attempted >= env.ANALYTICS_INGESTION_MIN_BATCHES &&
      operationalPercent > env.ANALYTICS_INGESTION_FAILURE_PERCENT
    ) {
      findings.push({
        type: "INGESTION_HEALTH",
        entityKey: "ingestion",
        tenantId: null,
        kind: "ingestion",
        subject: "ingestion",
        detail: `${operationalPercent.toFixed(1)}% of ${attempted} batches dropped`,
      });
    }
    // Its own finding and its own threshold (P6-25): a 400 is our own code sending what the
    // endpoint refuses. Never load, never the shopper, and never averaged into the percentage
    // above — Phase 3 lost every batch off localhost while that percentage read zero.
    if (metric.contractRejections >= env.ANALYTICS_CONTRACT_REJECTION_ALERT) {
      findings.push({
        type: "CONTRACT_REJECTION",
        entityKey: "contract",
        tenantId: null,
        kind: "contract-rejection",
        subject: "contract",
        detail: `${metric.contractRejections} batch(es) refused as malformed in the last window`,
      });
    }
  }

  // Aggregation: behind, failed, or holding an expired lease.
  const lagCutoff = new Date(now.getTime() - PLATFORM_THRESHOLDS.aggregationLagMinutes * 60_000);
  const lastRun = await withBypass((db) =>
    db.analyticsScheduledRun.findFirst({
      where: { status: "OK" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  );
  if (!lastRun || lastRun.startedAt < lagCutoff) {
    findings.push({
      type: "AGGREGATION_HEALTH",
      entityKey: "aggregation",
      tenantId: null,
      kind: "aggregation",
      subject: "aggregation",
      detail: lastRun
        ? `last successful run ${Math.round((now.getTime() - lastRun.startedAt.getTime()) / 60_000)} minutes ago`
        : "no successful run recorded",
    });
  }
  const failing = await withBypass((db) =>
    db.analyticsAggregationCursor.findMany({
      where: { failures: { gte: 3 } },
      select: { stage: true, failures: true, tenant: { select: { slug: true } } },
      take: 5,
    }),
  );
  for (const cursor of failing) {
    findings.push({
      type: "AGGREGATION_HEALTH",
      entityKey: `${cursor.tenant.slug}:${cursor.stage}`,
      tenantId: null,
      kind: "aggregation",
      subject: cursor.tenant.slug,
      detail: `${cursor.failures} consecutive ${cursor.stage} failures`,
    });
  }

  // Push delivery: a meaningful share of attempts failing. Endpoints already classified as
  // permanently gone are excluded — a merchant who uninstalled their browser is not an outage.
  const since = new Date(now.getTime() - 60 * 60_000);
  const [attempts, failures] = await Promise.all([
    withBypass((db) =>
      db.adminNotificationDelivery.count({
        where: { updatedAt: { gte: since }, state: { in: ["SENT", "FAILED"] } },
      }),
    ),
    withBypass((db) =>
      db.adminNotificationDelivery.count({
        where: { updatedAt: { gte: since }, state: "FAILED" },
      }),
    ),
  ]);
  if (attempts >= PLATFORM_THRESHOLDS.pushMinAttempts) {
    const percent = (failures / attempts) * 100;
    if (percent > PLATFORM_THRESHOLDS.pushFailurePercent) {
      findings.push({
        type: "PUSH_DELIVERY",
        entityKey: "push",
        tenantId: null,
        kind: "push-delivery",
        subject: "push",
        detail: `${percent.toFixed(0)}% of ${attempts} deliveries failed in the last hour`,
      });
    }
  }

  return findings;
}

/**
 * The transition rule (D55, P6-26).
 *
 * Returns true when this finding is NEW — the state row says clear, or the cooldown has passed
 * since the last send. Writes the state either way, so the next run knows.
 */
async function shouldSend(finding: AlertFinding, now: Date): Promise<boolean> {
  const cooldownMs = PLATFORM_THRESHOLDS.cooldownHours * 3_600_000;
  return withBypass(async (db) => {
    const existing = await db.notificationAlertState.findUnique({
      where: {
        audience_type_entityKey: {
          audience: "PLATFORM",
          type: finding.type,
          entityKey: finding.entityKey,
        },
      },
      select: { state: true, lastSentAt: true },
    });
    const firing = existing?.state === "firing";
    const cooledDown =
      !existing?.lastSentAt || now.getTime() - existing.lastSentAt.getTime() >= cooldownMs;
    const send = !firing || cooledDown;

    await db.notificationAlertState.upsert({
      where: {
        audience_type_entityKey: {
          audience: "PLATFORM",
          type: finding.type,
          entityKey: finding.entityKey,
        },
      },
      create: {
        audience: "PLATFORM",
        type: finding.type,
        entityKey: finding.entityKey,
        tenantId: finding.tenantId,
        state: "firing",
        enteredAt: now,
        lastSentAt: send ? now : null,
        detail: finding.detail,
      },
      update: {
        state: "firing",
        enteredAt: existing?.state === "firing" ? undefined : now,
        lastSentAt: send ? now : undefined,
        detail: finding.detail,
      },
    });
    return send;
  });
}

/**
 * Conditions that have stopped: their state goes back to clear, which is what re-arms them.
 *
 * Without this, a store that went quiet and came back would never alert again — the row would
 * say "firing" forever and every future transition would look like a repeat.
 */
async function clearResolved(current: readonly AlertFinding[]): Promise<number> {
  const live = new Set(current.map((finding) => `${finding.type}:${finding.entityKey}`));
  return withBypass(async (db) => {
    const firing = await db.notificationAlertState.findMany({
      where: { audience: "PLATFORM", state: "firing" },
      select: { id: true, type: true, entityKey: true },
    });
    const resolved = firing.filter((row) => !live.has(`${row.type}:${row.entityKey}`));
    if (resolved.length === 0) return 0;
    await db.notificationAlertState.updateMany({
      where: { id: { in: resolved.map((row) => row.id) } },
      data: { state: "clear", enteredAt: null },
    });
    return resolved.length;
  });
}

/** Every platform admin who wants this type, with at least one device. */
async function recipientsFor(type: NotificationType) {
  const admins = await withBypass((db) =>
    db.user.findMany({ where: { role: "PLATFORM_ADMIN" }, select: { id: true } }),
  );
  const wanted: { userId: string; devices: Awaited<ReturnType<typeof sendableDevices>> }[] = [];
  for (const admin of admins) {
    if (!(await wantsNotification(admin.id, "PLATFORM_ADMIN", type))) continue;
    const devices = await sendableDevices(admin.id, "PLATFORM");
    if (devices.length > 0) wanted.push({ userId: admin.id, devices });
  }
  return wanted;
}

export async function evaluatePlatformAlerts(
  now: Date,
): Promise<{ findings: number; sent: number; suppressed: number; resolved: number }> {
  const findings = await findPlatformIssues(now);
  const resolved = await clearResolved(findings);
  let sent = 0;
  let suppressed = 0;

  for (const finding of findings) {
    if (!(await shouldSend(finding, now))) {
      suppressed += 1;
      continue;
    }
    const text = platformAlertText(finding.kind, {
      subject: finding.subject,
      detail: finding.detail,
    });
    for (const recipient of await recipientsFor(finding.type)) {
      const claim = await claimNotification({
        recipientUserId: recipient.userId,
        recipientRole: "PLATFORM_ADMIN",
        audience: "PLATFORM",
        type: finding.type,
        // Null even for a store-specific alert: this is a platform notification about a store,
        // not a store's own data, and a tenant-scoped row would be invisible to the console
        // that has to show it.
        tenantId: null,
        title: text.title,
        body: text.body,
        destination: "/platform/analytics",
        locale: "en",
        dedupeKey: `${finding.type}:${recipient.userId}:${finding.entityKey}:${now.toISOString().slice(0, 13)}`,
        cooldownKey: `${finding.type}:${finding.entityKey}`,
      });
      if (!claim) continue;
      await deliverNotification(claim.id, null, recipient.devices, {
        ...buildAlertPayload({
          type: finding.type,
          text,
          recipientUserId: recipient.userId,
          entityKey: finding.entityKey,
          locale: "en",
          destination: "/platform/analytics",
        }),
      });
      sent += 1;
    }
  }
  return { findings: findings.length, sent, suppressed, resolved };
}

/** Monday 09:00 in the platform's own zone (§11.11). */
export function platformWeeklyDue(now: Date, timeZone = env.PLATFORM_TIMEZONE): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
  return weekday === "Mon" && hour === 9;
}

export async function sendPlatformWeeklySummary(now: Date): Promise<{ sent: number }> {
  const report = await platformConsole(lastNLocalDays(7, now, "UTC"));
  const text = platformWeeklyText({
    stores: report.totals.storesMeasured + report.inactive.length,
    active: report.totals.storesWithActivity,
    growing: report.growing.length,
    declining: report.declining.length,
    inactive: report.inactive.length,
  });

  let sent = 0;
  for (const recipient of await recipientsFor("PLATFORM_WEEKLY_SUMMARY")) {
    const claim = await claimNotification({
      recipientUserId: recipient.userId,
      recipientRole: "PLATFORM_ADMIN",
      audience: "PLATFORM",
      type: "PLATFORM_WEEKLY_SUMMARY",
      tenantId: null,
      title: text.title,
      body: text.body,
      destination: "/platform/analytics",
      locale: "en",
      dedupeKey: `PLATFORM_WEEKLY_SUMMARY:${recipient.userId}:${now.toISOString().slice(0, 10)}`,
      cooldownKey: `PLATFORM_WEEKLY_SUMMARY:${recipient.userId}`,
    });
    if (!claim) continue;
    await deliverNotification(claim.id, null, recipient.devices, {
      ...buildAlertPayload({
        type: "PLATFORM_WEEKLY_SUMMARY",
        text,
        recipientUserId: recipient.userId,
        entityKey: "week",
        locale: "en",
        destination: "/platform/analytics",
      }),
    });
    sent += 1;
  }
  return { sent };
}
