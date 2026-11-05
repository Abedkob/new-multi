/**
 * The platform console's numbers (§5.8, D43).
 *
 * **Aggregates across stores, and nothing about a person.** This module reads the daily
 * aggregate tables and the operational counters, and it must never read `AnalyticsEvent`,
 * `AnalyticsSession` or `AnalyticsVisitor`. That is not a style rule: a cross-tenant query over
 * raw events is a platform-wide browsing history of other people's customers, which is exactly
 * what nobody in this company should be able to open. `verify:platform-console` checks it
 * statically, and P5-21 checks that no route exposes one either.
 *
 * `withBypass`, because the whole purpose is to look across stores — and for the same reason
 * every caller must be behind `requirePlatformAdmin` and must log the view (D43).
 *
 * The trend rules are `compare.ts`'s, shared with the store-owner reports. A platform admin and
 * a merchant looking at the same week must not be told different things about it, and §5.8's
 * "at least 20% plus a meaningful absolute change" is the same sentence as §6's.
 */

import { withBypass } from "@/lib/prisma";
import {
  daysIn,
  previousPeriod,
  trend,
  TREND_RULES,
  type DayRange,
  type TrendReading,
} from "@/lib/analytics/compare";
import { localDayToDate } from "@/lib/analytics/local-day";

const dayFilter = (range: DayRange) => ({
  gte: localDayToDate(range.from),
  lte: localDayToDate(range.to),
});

export type StoreLine = {
  tenantId: string;
  name: string;
  slug: string;
  sessions: number;
  orders: number;
  orderValueCents: number;
  whatsappClickSessions: number;
  /**
   * §5.8: "at least one session, website order or WhatsApp click in the period". A store with
   * none of the three is listed separately rather than shown as a row of zeros among the rest.
   */
  hasActivity: boolean;
  trends: { sessions: TrendReading; orders: TrendReading; whatsappClicks: TrendReading };
};

export type PlatformTotals = {
  storesMeasured: number;
  storesWithActivity: number;
  sessions: number;
  /** Daily visitor counts, summed. Not distinct visitors — see D49. */
  visitorDays: number;
  orders: number;
  orderValueCents: number;
  whatsappClickSessions: number;
  /** Separate from `orderValueCents`, always. Intent is not revenue (§3.4). */
  whatsappPotentialValueCents: number;
};

export type IngestionHealth = {
  /** The newest window any instance flushed counters for, and what they said. */
  lastWindowEnd: Date | null;
  attemptedBatches: number;
  acceptedBatches: number;
  storedEvents: number;
  contractRejections: number;
  policyDrops: number;
  operationalDrops: number;
  /** Stores whose aggregation stage has consecutive failures recorded. */
  failingStores: { slug: string; stage: string; failures: number; lastError: string | null }[];
  /** The oldest "last run" across stores: how far behind the slowest store is. */
  oldestLastRunAt: Date | null;
};

export type PlatformConsole = {
  range: DayRange;
  comparedWith: DayRange;
  totals: PlatformTotals;
  stores: StoreLine[];
  /** §5.8's three lists, computed from `stores` so they cannot disagree with it. */
  growing: StoreLine[];
  declining: StoreLine[];
  /** No session, order or WhatsApp click for seven days (§5.8's own window, not the period). */
  inactive: { tenantId: string; name: string; slug: string }[];
  health: IngestionHealth;
};

const SUMS = {
  sessions: true,
  visitors: true,
  orders: true,
  orderValueCents: true,
  whatsappClickSessions: true,
  whatsappPotentialValueCents: true,
} as const;

/**
 * Everything the console shows, in one pass.
 *
 * `range` is the selected period; the seven-day inactivity window is computed from its end
 * regardless of how long the period is, because §5.8 defines "no activity" in days and a
 * 90-day period would otherwise call a store that stopped last week "active".
 */
export function platformConsole(range: DayRange): Promise<PlatformConsole> {
  const comparedWith = previousPeriod(range);
  const days = daysIn(range);
  const weekFrom = days[Math.max(0, days.length - 7)];
  const week: DayRange = { from: weekFrom, to: range.to, timeZone: range.timeZone };

  return withBypass(async (db) => {
    const [tenants, now, before, weekRows, metric, cursors] = await Promise.all([
      db.tenant.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
      db.analyticsDailyMetric.groupBy({
        by: ["tenantId"],
        where: { localDay: dayFilter(range) },
        _sum: SUMS,
      }),
      db.analyticsDailyMetric.groupBy({
        by: ["tenantId"],
        where: { localDay: dayFilter(comparedWith) },
        _sum: SUMS,
      }),
      db.analyticsDailyMetric.groupBy({
        by: ["tenantId"],
        where: { localDay: dayFilter(week) },
        _sum: { sessions: true, orders: true, whatsappClickSessions: true },
      }),
      db.analyticsOperationalMetric.findFirst({ orderBy: { windowEnd: "desc" } }),
      db.analyticsAggregationCursor.findMany({
        select: {
          stage: true,
          failures: true,
          lastError: true,
          lastRunAt: true,
          tenant: { select: { slug: true } },
        },
      }),
    ]);

    const sumsOf = (rows: typeof now) =>
      new Map(rows.map((r) => [r.tenantId, r._sum as unknown as Record<string, number | null>]));
    const current = sumsOf(now);
    const previous = sumsOf(before);
    const lastWeek = new Map(
      weekRows.map((r) => [
        r.tenantId,
        (r._sum.sessions ?? 0) + (r._sum.orders ?? 0) + (r._sum.whatsappClickSessions ?? 0),
      ]),
    );

    const stores: StoreLine[] = [];
    const inactive: PlatformConsole["inactive"] = [];
    for (const tenant of tenants) {
      const s = current.get(tenant.id);
      const p = previous.get(tenant.id) ?? {};
      // A store with no aggregate row at all in the period is not "measured": it may have been
      // created yesterday, or never switched into the rollout. It is counted as inactive rather
      // than listed with zeros, which would read as a store that failed.
      if (!s) {
        inactive.push({ tenantId: tenant.id, name: tenant.name, slug: tenant.slug });
        continue;
      }
      const sessions = s.sessions ?? 0;
      const orders = s.orders ?? 0;
      const whatsappClickSessions = s.whatsappClickSessions ?? 0;
      const line: StoreLine = {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        sessions,
        orders,
        orderValueCents: s.orderValueCents ?? 0,
        whatsappClickSessions,
        hasActivity: sessions > 0 || orders > 0 || whatsappClickSessions > 0,
        trends: {
          sessions: trend(sessions, p.sessions ?? 0, TREND_RULES.sessions, "sessions"),
          orders: trend(orders, p.orders ?? 0, TREND_RULES.orders, "website orders"),
          whatsappClicks: trend(
            whatsappClickSessions,
            p.whatsappClickSessions ?? 0,
            TREND_RULES.whatsappClicks,
            "WhatsApp clicks",
          ),
        },
      };
      stores.push(line);
      if ((lastWeek.get(tenant.id) ?? 0) === 0) {
        inactive.push({ tenantId: tenant.id, name: tenant.name, slug: tenant.slug });
      }
    }

    // Totalled over the measured stores only, from the same rows their lines came from.
    const totalOf = (key: string) =>
      stores.reduce((n, line) => n + (current.get(line.tenantId)?.[key] ?? 0), 0);

    return {
      range,
      comparedWith,
      totals: {
        storesMeasured: stores.length,
        storesWithActivity: stores.filter((s) => s.hasActivity).length,
        sessions: totalOf("sessions"),
        visitorDays: totalOf("visitors"),
        orders: totalOf("orders"),
        orderValueCents: totalOf("orderValueCents"),
        whatsappClickSessions: totalOf("whatsappClickSessions"),
        whatsappPotentialValueCents: totalOf("whatsappPotentialValueCents"),
      },
      stores: stores.sort((a, b) => b.sessions - a.sessions),
      // "Growing" and "declining" are the shared trend verdict, not a second rule: a store the
      // owner's own overview calls steady must never appear here as growing.
      growing: stores.filter((s) => s.trends.sessions.verdict === "growing"),
      declining: stores.filter((s) => s.trends.sessions.verdict === "declining"),
      inactive,
      health: {
        lastWindowEnd: metric?.windowEnd ?? null,
        attemptedBatches: metric?.attemptedBatches ?? 0,
        acceptedBatches: metric?.acceptedBatches ?? 0,
        storedEvents: metric?.storedEvents ?? 0,
        contractRejections: metric?.contractRejections ?? 0,
        policyDrops: metric?.policyDrops ?? 0,
        operationalDrops: metric?.operationalDrops ?? 0,
        failingStores: cursors
          .filter((c) => c.failures > 0)
          .map((c) => ({
            slug: c.tenant.slug,
            stage: c.stage,
            failures: c.failures,
            lastError: c.lastError,
          }))
          .sort((a, b) => b.failures - a.failures),
        oldestLastRunAt: cursors.reduce<Date | null>(
          (oldest, c) =>
            c.lastRunAt && (!oldest || c.lastRunAt < oldest) ? c.lastRunAt : oldest,
          null,
        ),
      },
    };
  });
}
