/**
 * What the owner is told that is not an order (§11.7, §11.8; D54).
 *
 * The rule this module exists to keep: **it decides nothing.** Every judgement comes from
 * `lib/analytics/insights.ts`, which Phase 5 wrote, verified at every threshold, and which the
 * owner's own Overview reads. If this file applied its own idea of "significant", a merchant's
 * dashboard and their lock screen would disagree about the same week — and the lock screen
 * would win the argument, because it arrived first and was not asked for.
 *
 * So the work here is only: which insights are worth interrupting someone for, how often one
 * subject may interrupt them, and when the weekly summary is due.
 *
 * A new order is deliberately not in this file. It is a confirmed fact with no sample rule
 * (D54), and it lives in `new-order.ts` with the transaction that produced it.
 */

import type { NotificationType } from "@/generated/prisma/client";
import {
  lastNLocalDays,
  previousPeriod,
  type DayRange,
} from "@/lib/analytics/compare";
import { localDayOf, localDayToDate, localHourOf } from "@/lib/analytics/local-day";
import { buildInsights, type Insight } from "@/lib/analytics/insights";
import {
  acquisitionReport,
  funnelReport,
  productReport,
  searchReport,
  storeOverview,
} from "@/lib/analytics/report";
import { claimNotification, lastNotificationFor } from "@/lib/data/notifications";
import { wantsNotification } from "@/lib/data/notification-preferences";
import { sendableDevices } from "@/lib/data/push-subscriptions";
import { ownerAlertText, weeklySummaryText, type NotificationLocale } from "@/lib/notifications/templates";
import { deliverNotification } from "@/lib/notifications/deliver";
import { buildAlertPayload } from "@/lib/push/payload";

/**
 * How long one subject may not interrupt the same owner again (D54).
 *
 * Per type AND entity: a product that is struggling is still struggling tomorrow, and a daily
 * notification about it teaches the owner to dismiss the next one. The windows differ because
 * the things differ — a checkout that broke is worth knowing about again sooner than a product
 * that is quietly unpopular.
 */
export const COOLDOWN_HOURS: Record<string, number> = {
  PRODUCT_ALERT: 7 * 24,
  FUNNEL_ALERT: 3 * 24,
  SEARCH_ALERT: 7 * 24,
  TRAFFIC_ALERT: 3 * 24,
  WEEKLY_SUMMARY: 6 * 24,
};

/** Which insight kinds are worth a notification, and under which preference (§11.8). */
const ALERTABLE: Record<
  string,
  { type: NotificationType; kind: "product" | "funnel" | "search" | "traffic" }
> = {
  "high-interest-low-conversion": { type: "PRODUCT_ALERT", kind: "product" },
  "unnoticed-product": { type: "PRODUCT_ALERT", kind: "product" },
  "funnel-drop": { type: "FUNNEL_ALERT", kind: "funnel" },
  "unmet-search": { type: "SEARCH_ALERT", kind: "search" },
  "activity-shift": { type: "TRAFFIC_ALERT", kind: "traffic" },
};

export type OwnerTenant = {
  id: string;
  analyticsTimezone: string;
  defaultLocale: string;
  owner: { id: string; adminLocale: string | null };
};

export function localeFor(tenant: OwnerTenant): NotificationLocale {
  if (tenant.owner.adminLocale === "ar" || tenant.owner.adminLocale === "en") {
    return tenant.owner.adminLocale;
  }
  return tenant.defaultLocale === "ar" ? "ar" : "en";
}

/** What an insight is about, for the cooldown key: a product id, a step, a phrase. */
function entityOf(insight: Insight): string {
  return (
    insight.subject.productId ??
    insight.subject.step ??
    insight.subject.phrase ??
    insight.subject.source ??
    "store"
  );
}

/** The numbers the copy prints, taken from the insight rather than recomputed (D54). */
function factsOf(insight: Insight): { current: number; reference: number } {
  const n = insight.numbers;
  switch (insight.kind) {
    case "high-interest-low-conversion":
      return { current: n.viewSessions ?? 0, reference: n.actions ?? 0 };
    case "unnoticed-product":
      return { current: n.viewSessions ?? 0, reference: n.activeDays ?? 0 };
    case "funnel-drop":
      return { current: n.continued ?? 0, reference: n.entered ?? 0 };
    case "unmet-search":
      return { current: n.noResultSearches ?? 0, reference: n.searches ?? 0 };
    case "activity-shift":
      return { current: n.current ?? 0, reference: n.previous ?? 0 };
    default:
      return { current: 0, reference: 0 };
  }
}

function subjectOf(insight: Insight, fallback: string): string {
  return insight.subject.productName ?? insight.subject.phrase ?? insight.subject.step ?? fallback;
}

/**
 * Everything §6 found for this store, as notifications — minus anything on cooldown, anything
 * the owner switched off, and anything with no device to reach.
 *
 * Returns what it sent so the stage can report a number, and sends nothing when the insight set
 * is empty, which for most stores most weeks is the correct answer.
 */
export async function evaluateOwnerAlerts(
  tenant: OwnerTenant,
  now: Date,
): Promise<{ sent: number; considered: number; suppressed: number }> {
  const zone = tenant.analyticsTimezone;
  const range: DayRange = lastNLocalDays(7, now, zone);
  const monthRange: DayRange = lastNLocalDays(30, now, zone);

  // The same reads the Overview does, in the same order, so the insight set is the one the owner
  // would see if they opened the page right now. Sequential for the reason the Overview is
  // (Phase 5): each opens its own transaction, and seven at once starved the pool.
  const overview = await storeOverview(tenant.id, range);
  const products = await productReport(tenant.id, range);
  const funnel = await funnelReport(tenant.id, range);
  const searches = await searchReport(tenant.id, range);
  const sources = await acquisitionReport(tenant.id, range);
  const monthProducts = await productReport(tenant.id, monthRange);
  const monthOverview = await storeOverview(tenant.id, monthRange);

  const insights = buildInsights({
    products,
    monthProducts,
    monthSeries: monthOverview.series,
    series: overview.series,
    website: funnel.website,
    whatsapp: funnel.whatsapp,
    searches,
    sources,
    sessionTrend: overview.trends.sessions,
  });

  const locale = localeFor(tenant);
  const devices = await sendableDevices(tenant.owner.id, "OWNER");
  let sent = 0;
  let suppressed = 0;
  let considered = 0;

  for (const insight of insights) {
    const mapping = ALERTABLE[insight.kind];
    if (!mapping) continue; // A fact rather than something to interrupt someone for.
    considered += 1;

    if (!(await wantsNotification(tenant.owner.id, "STORE_OWNER", mapping.type))) {
      suppressed += 1;
      continue;
    }
    const entity = entityOf(insight);
    const cooldownKey = `${mapping.type}:${tenant.owner.id}:${entity}`;
    const previous = await lastNotificationFor(cooldownKey);
    const hours = COOLDOWN_HOURS[mapping.type] ?? 72;
    if (previous && now.getTime() - previous.createdAt.getTime() < hours * 3_600_000) {
      suppressed += 1;
      continue;
    }

    const facts = factsOf(insight);
    const text = ownerAlertText(locale, mapping.kind, {
      subject: subjectOf(insight, entity),
      ...facts,
    });
    // The destination is the screen that shows the evidence behind this line. A notification
    // that cannot be checked is a notification that has to be believed.
    const destination =
      mapping.kind === "product"
        ? "/admin/analytics/products"
        : mapping.kind === "funnel"
          ? "/admin/analytics/funnel"
          : mapping.kind === "search"
            ? "/admin/analytics/searches"
            : "/admin/analytics";

    const claim = await claimNotification({
      recipientUserId: tenant.owner.id,
      recipientRole: "STORE_OWNER",
      audience: "OWNER",
      type: mapping.type,
      tenantId: tenant.id,
      title: text.title,
      body: text.body,
      destination,
      locale,
      // One alert per subject per local day at most, before the cooldown is even consulted:
      // the dedupe key makes a second run of this stage in the same day a no-op.
      dedupeKey: `${mapping.type}:${tenant.owner.id}:${entity}:${localDayOf(now, zone)}`,
      cooldownKey,
    });
    if (!claim) {
      suppressed += 1;
      continue;
    }
    await deliverNotification(claim.id, tenant.id, devices, {
      ...buildAlertPayload({
        type: mapping.type,
        text,
        recipientUserId: tenant.owner.id,
        entityKey: entity,
        locale,
        destination,
      }),
    });
    sent += 1;
  }

  return { sent, considered, suppressed };
}

/**
 * Is the weekly summary due for this store right now (§11.7)?
 *
 * Monday 09:00 **in the store's own zone**, which is the whole reason this is not a cron
 * expression: a platform-wide "Monday 09:00" would reach a merchant in Beirut at a different
 * hour from one in Casablanca, and twice a year it would move for both of them.
 *
 * The window is the whole 09:00 hour, because the scheduled command runs every five minutes and
 * may miss any given minute; the dedupe key then makes the extra runs no-ops.
 */
export function weeklySummaryDue(tenant: { analyticsTimezone: string }, now: Date): boolean {
  const day = localDayOf(now, tenant.analyticsTimezone);
  // `localDay` is a zoneless date at UTC midnight, so its UTC weekday IS the store's weekday.
  const weekday = localDayToDate(day).getUTCDay();
  const hour = localHourOf(now, tenant.analyticsTimezone);
  return weekday === 1 && hour === 9;
}

/** The Monday summary: the top product, the biggest problem, the loudest unmet search (§11.7). */
export async function sendWeeklySummary(
  tenant: OwnerTenant,
  now: Date,
): Promise<{ sent: boolean; reason?: string }> {
  if (!(await wantsNotification(tenant.owner.id, "STORE_OWNER", "WEEKLY_SUMMARY"))) {
    return { sent: false, reason: "switched off" };
  }
  const devices = await sendableDevices(tenant.owner.id, "OWNER");
  if (devices.length === 0) return { sent: false, reason: "no device" };

  const zone = tenant.analyticsTimezone;
  const range = lastNLocalDays(7, now, zone);
  const overview = await storeOverview(tenant.id, range);
  const products = await productReport(tenant.id, range);
  const funnel = await funnelReport(tenant.id, range);
  const searches = await searchReport(tenant.id, range);
  const sources = await acquisitionReport(tenant.id, range);
  const monthProducts = await productReport(tenant.id, lastNLocalDays(30, now, zone));
  const monthOverview = await storeOverview(tenant.id, lastNLocalDays(30, now, zone));

  const insights = buildInsights({
    products,
    monthProducts,
    monthSeries: monthOverview.series,
    series: overview.series,
    website: funnel.website,
    whatsapp: funnel.whatsapp,
    searches,
    sources,
    sessionTrend: overview.trends.sessions,
  });

  const top = insights.find((insight) => insight.kind === "top-product");
  const problem = insights.find((insight) => insight.tone === "attention");
  const unmet = searches.demand[0] ?? null;
  const locale = localeFor(tenant);

  // §11.7: with no qualifying problem, SAY there was none. The weekly summary is the one
  // notification that arrives whether or not anything happened, so it has to be able to say
  // "nothing stood out" rather than reaching for the next-weakest finding.
  const text = weeklySummaryText(locale, {
    topProduct: top?.subject.productName ?? null,
    problem: problem
      ? ownerAlertText(locale, ALERTABLE[problem.kind]?.kind ?? "traffic", {
          subject: subjectOf(problem, "store"),
          ...factsOf(problem),
        }).body
      : null,
    unmetSearch: unmet?.phrase ?? null,
  });

  const claim = await claimNotification({
    recipientUserId: tenant.owner.id,
    recipientRole: "STORE_OWNER",
    audience: "OWNER",
    type: "WEEKLY_SUMMARY",
    tenantId: tenant.id,
    title: text.title,
    body: text.body,
    destination: "/admin/analytics?period=7",
    locale,
    // One per store per local week, whatever the schedule does.
    dedupeKey: `WEEKLY_SUMMARY:${tenant.owner.id}:${localDayOf(now, zone)}`,
    cooldownKey: `WEEKLY_SUMMARY:${tenant.owner.id}`,
  });
  if (!claim) return { sent: false, reason: "already sent this week" };

  await deliverNotification(claim.id, tenant.id, devices, {
    ...buildAlertPayload({
      type: "WEEKLY_SUMMARY",
      text,
      recipientUserId: tenant.owner.id,
      entityKey: "week",
      locale,
      destination: "/admin/analytics?period=7",
    }),
  });
  return { sent: true };
}

/** Exported for the checks: the previous period, so a check cannot invent its own window. */
export const summaryRange = (now: Date, zone: string) =>
  previousPeriod(lastNLocalDays(7, now, zone));
