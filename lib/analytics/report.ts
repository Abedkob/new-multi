/**
 * Every number a merchant report shows (D41).
 *
 * **Aggregates only.** Nothing in this file reads `AnalyticsEvent`, `AnalyticsSession` or
 * `AnalyticsVisitor`, and nothing that calls it may either. Two reasons, both of which would
 * be discovered late:
 *
 *   - A report built on raw events turns a merchant screen into a person's browsing history.
 *     The aggregates are counts; the events are a trail.
 *   - Retention empties the raw tables at 90 days (§4.7), so a chart reading them would go flat
 *     for anything older than a quarter, silently and only for long-lived stores.
 *
 * `pnpm verify:aggregates`' P3-24 enforces the first half of this and Phase 5's P5-01 extends it
 * to the report routes.
 *
 * Two house rules this module keeps and the views inherit:
 *
 *   - **Website order value and potential WhatsApp value are never added.** They are separate
 *     fields everywhere, including in the types, because one is money taken and the other is
 *     money that might have been (§3.4). There is deliberately no `totalValueCents` to reach
 *     for. P4-22 checks this textually.
 *   - **A rate with no denominator is null, not zero.** "0% conversion" says visitors came and
 *     nobody bought; a store with no visitors yet has not earned that sentence.
 *
 * Reads go through `withTenant`, so RLS filters them as well as the WHERE clause — the same
 * two-layer guarantee the rest of the data layer gives.
 */
import { withTenant, type TxClient } from "@/lib/prisma";
import {
  averageCents,
  daysIn,
  delta,
  previousPeriod,
  rate,
  trend,
  TREND_RULES,
  type DayRange,
  type Delta,
  type TrendReading,
} from "@/lib/analytics/compare";
import { localDayFromDate, localDayToDate, type LocalDay } from "@/lib/analytics/local-day";

/** Inclusive-range filter for an aggregate table's `localDay` column. */
function dayFilter(range: DayRange) {
  return { gte: localDayToDate(range.from), lte: localDayToDate(range.to) };
}

const zero = (n: number | null | undefined) => n ?? 0;

// ---------------------------------------------------------------------------------------------
// Daily totals
// ---------------------------------------------------------------------------------------------

/** The daily aggregate's columns, summed over a range. Named exactly as the table names them. */
export type StoreTotals = {
  sessions: number;
  visitors: number;
  newVisitors: number;
  productViewSessions: number;
  addToCartSessions: number;
  cartViewSessions: number;
  checkoutSessions: number;
  searchSessions: number;
  whatsappClickSessions: number;
  whatsappPotentialValueCents: number;
  orders: number;
  orderValueCents: number;
  cancelledOrders: number;
  cancelledOrderValueCents: number;
};

const TOTAL_KEYS = [
  "sessions",
  "visitors",
  "newVisitors",
  "productViewSessions",
  "addToCartSessions",
  "cartViewSessions",
  "checkoutSessions",
  "searchSessions",
  "whatsappClickSessions",
  "whatsappPotentialValueCents",
  "orders",
  "orderValueCents",
  "cancelledOrders",
  "cancelledOrderValueCents",
] as const satisfies readonly (keyof StoreTotals)[];

export const EMPTY_TOTALS: StoreTotals = Object.fromEntries(
  TOTAL_KEYS.map((k) => [k, 0]),
) as StoreTotals;

async function sumDaily(db: TxClient, tenantId: string, range: DayRange): Promise<StoreTotals> {
  const summed = await db.analyticsDailyMetric.aggregate({
    where: { tenantId, localDay: dayFilter(range) },
    _sum: Object.fromEntries(TOTAL_KEYS.map((k) => [k, true])) as Record<string, true>,
  });
  const sums = summed._sum as unknown as Record<string, number | null>;
  return Object.fromEntries(TOTAL_KEYS.map((k) => [k, zero(sums[k])])) as StoreTotals;
}

/** One row per local day in the range, including days with no row at all, as zeros. */
export type DailyPoint = StoreTotals & { day: LocalDay };

async function dailySeries(
  db: TxClient,
  tenantId: string,
  range: DayRange,
): Promise<DailyPoint[]> {
  const rows = await db.analyticsDailyMetric.findMany({
    where: { tenantId, localDay: dayFilter(range) },
    orderBy: { localDay: "asc" },
  });
  const byDay = new Map(rows.map((r) => [localDayFromDate(r.localDay), r]));
  // Missing days are zeros, not gaps. A line chart that skips a dead day draws a straight
  // segment over it and shows a quiet Sunday as if it had been busy.
  return daysIn(range).map((day) => {
    const row = byDay.get(day);
    const point = row
      ? (Object.fromEntries(TOTAL_KEYS.map((k) => [k, zero(row[k])])) as StoreTotals)
      : EMPTY_TOTALS;
    return { day, ...point };
  });
}

export type StoreRates = {
  /** Website orders per session. */
  conversionRate: number | null;
  whatsappClickRate: number | null;
  averageOrderValueCents: number | null;
  newVisitorShare: number | null;
};

function ratesOf(t: StoreTotals): StoreRates {
  return {
    conversionRate: rate(t.orders, t.sessions),
    whatsappClickRate: rate(t.whatsappClickSessions, t.sessions),
    averageOrderValueCents: averageCents(t.orderValueCents, t.orders),
    newVisitorShare: rate(t.newVisitors, t.visitors),
  };
}

export type StoreOverview = {
  range: DayRange;
  comparedWith: DayRange;
  totals: StoreTotals;
  previousTotals: StoreTotals;
  deltas: Record<keyof StoreTotals, Delta>;
  rates: StoreRates;
  previousRates: StoreRates;
  trends: { sessions: TrendReading; orders: TrendReading; whatsappClicks: TrendReading };
  series: DailyPoint[];
  /** The newest `computedAt` in the range: §5.9's "aggregation delayed" state needs it. */
  lastComputedAt: Date | null;
};

/** §5.2's figures 3–4: the headline numbers, their comparison, and the visitor trend. */
export function storeOverview(tenantId: string, range: DayRange): Promise<StoreOverview> {
  const comparedWith = previousPeriod(range);
  return withTenant(tenantId, async (db) => {
    const [totals, previousTotals, series, newest] = await Promise.all([
      sumDaily(db, tenantId, range),
      sumDaily(db, tenantId, comparedWith),
      dailySeries(db, tenantId, range),
      db.analyticsDailyMetric.findFirst({
        where: { tenantId, localDay: dayFilter(range) },
        orderBy: { computedAt: "desc" },
        select: { computedAt: true },
      }),
    ]);
    return {
      range,
      comparedWith,
      totals,
      previousTotals,
      deltas: Object.fromEntries(
        TOTAL_KEYS.map((k) => [k, delta(totals[k], previousTotals[k])]),
      ) as Record<keyof StoreTotals, Delta>,
      rates: ratesOf(totals),
      previousRates: ratesOf(previousTotals),
      trends: {
        sessions: trend(totals.sessions, previousTotals.sessions, TREND_RULES.sessions, "sessions"),
        orders: trend(totals.orders, previousTotals.orders, TREND_RULES.orders, "website orders"),
        whatsappClicks: trend(
          totals.whatsappClickSessions,
          previousTotals.whatsappClickSessions,
          TREND_RULES.whatsappClicks,
          "WhatsApp click sessions",
        ),
      },
      series,
      lastComputedAt: newest?.computedAt ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Funnel (§5.4, D46)
// ---------------------------------------------------------------------------------------------

export type FunnelStep = {
  key: string;
  sessions: number;
  /** Share of the step above. Null only at the top, where there is nothing to divide by. */
  fromPreviousStep: number | null;
  /** Share of the path's first step, so a reader can see cumulative loss without arithmetic. */
  fromEntry: number | null;
  change: Delta;
};

export type FunnelPath = { path: "website" | "whatsapp"; steps: FunnelStep[] };

/**
 * The two paths, kept apart (§5.4). They share their first steps because a visitor is on
 * neither path until they act — but they never share a total, and the WhatsApp path ends in
 * clicks, which are counted here, never valued.
 */
export const WEBSITE_STEPS = [
  "sessions",
  "productViewSessions",
  "addToCartSessions",
  "cartViewSessions",
  "checkoutSessions",
  "orders",
] as const satisfies readonly (keyof StoreTotals)[];

export const WHATSAPP_STEPS = [
  "sessions",
  "productViewSessions",
  "whatsappClickSessions",
] as const satisfies readonly (keyof StoreTotals)[];

function buildPath(
  path: FunnelPath["path"],
  keys: readonly (keyof StoreTotals)[],
  totals: StoreTotals,
  previous: StoreTotals,
): FunnelPath {
  const entry = totals[keys[0]];
  return {
    path,
    steps: keys.map((key, i) => ({
      key: key as string,
      // Always emitted, zero included (D46): a funnel that omits an empty step makes a broken
      // storefront look like a narrow one, and the drop-off above it disappears with it.
      sessions: totals[key],
      fromPreviousStep: i === 0 ? null : rate(totals[key], totals[keys[i - 1]]),
      fromEntry: i === 0 ? null : rate(totals[key], entry),
      change: delta(totals[key], previous[key]),
    })),
  };
}

export type FunnelReport = {
  range: DayRange;
  comparedWith: DayRange;
  website: FunnelPath;
  whatsapp: FunnelPath;
  /** Separate, and separately named, so no caller can present one figure as the other. */
  websiteOrderValueCents: number;
  whatsappPotentialValueCents: number;
};

export function funnelReport(tenantId: string, range: DayRange): Promise<FunnelReport> {
  const comparedWith = previousPeriod(range);
  return withTenant(tenantId, async (db) => {
    const [totals, previous] = await Promise.all([
      sumDaily(db, tenantId, range),
      sumDaily(db, tenantId, comparedWith),
    ]);
    return {
      range,
      comparedWith,
      website: buildPath("website", WEBSITE_STEPS, totals, previous),
      whatsapp: buildPath("whatsapp", WHATSAPP_STEPS, totals, previous),
      websiteOrderValueCents: totals.orderValueCents,
      whatsappPotentialValueCents: totals.whatsappPotentialValueCents,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Products (§5.3)
// ---------------------------------------------------------------------------------------------

export type ProductRow = {
  productId: string;
  viewSessions: number;
  views: number;
  addToCartSessions: number;
  whatsappClickSessions: number;
  purchasingSessions: number;
  unitsOrdered: number;
  orderValueCents: number;
  /** Purchasing sessions per viewing session. */
  conversionRate: number | null;
  /** Any action at all — cart, WhatsApp or purchase — per viewing session. */
  actionRate: number | null;
  change: { viewSessions: Delta; purchasingSessions: Delta; orderValueCents: Delta };
};

const PRODUCT_SUMS = {
  viewSessions: true,
  views: true,
  addToCartSessions: true,
  whatsappClickSessions: true,
  purchasingSessions: true,
  unitsOrdered: true,
  orderValueCents: true,
} as const;

async function productSums(db: TxClient, tenantId: string, range: DayRange) {
  const rows = await db.analyticsProductDaily.groupBy({
    by: ["productId"],
    where: { tenantId, localDay: dayFilter(range) },
    _sum: PRODUCT_SUMS,
  });
  return new Map(rows.map((r) => [r.productId, r._sum]));
}

/**
 * Per-product figures for the range, busiest first.
 *
 * It returns `productId` only. Naming the product is the caller's job for now, and a product
 * deleted since cannot be named at all — which is D44's gap: `AnalyticsProductDaily` stores no
 * name, so the snapshot and its backfill land in their own commit rather than being faked here.
 */
export function productReport(tenantId: string, range: DayRange): Promise<ProductRow[]> {
  const comparedWith = previousPeriod(range);
  return withTenant(tenantId, async (db) => {
    const [now, before] = await Promise.all([
      productSums(db, tenantId, range),
      productSums(db, tenantId, comparedWith),
    ]);
    const rows: ProductRow[] = [...now.entries()].map(([productId, s]) => {
      const past = before.get(productId);
      const viewSessions = zero(s.viewSessions);
      const acted =
        zero(s.addToCartSessions) + zero(s.whatsappClickSessions) + zero(s.purchasingSessions);
      return {
        productId,
        viewSessions,
        views: zero(s.views),
        addToCartSessions: zero(s.addToCartSessions),
        whatsappClickSessions: zero(s.whatsappClickSessions),
        purchasingSessions: zero(s.purchasingSessions),
        unitsOrdered: zero(s.unitsOrdered),
        orderValueCents: zero(s.orderValueCents),
        conversionRate: rate(zero(s.purchasingSessions), viewSessions),
        // Not a sum of rates — a sum of sessions over one denominator. Adding three rates can
        // exceed 100% and would mean nothing.
        actionRate: rate(acted, viewSessions),
        change: {
          viewSessions: delta(viewSessions, zero(past?.viewSessions)),
          purchasingSessions: delta(zero(s.purchasingSessions), zero(past?.purchasingSessions)),
          orderValueCents: delta(zero(s.orderValueCents), zero(past?.orderValueCents)),
        },
      };
    });
    return rows.sort(
      (a, b) => b.viewSessions - a.viewSessions || b.orderValueCents - a.orderValueCents,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Acquisition (§5.5)
// ---------------------------------------------------------------------------------------------

/** Which touch gets the credit. The aggregate stores both; the view chooses (§5.5). */
export type AttributionBasis = "last" | "first";

export type AcquisitionRow = {
  sourceKind: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  orders: number;
  orderValueCents: number;
  whatsappClickSessions: number;
  conversionRate: number | null;
  change: { sessions: Delta; orders: Delta; orderValueCents: Delta };
};

const ACQUISITION_SUMS = {
  sessions: true,
  lastTouchOrders: true,
  lastTouchOrderValueCents: true,
  firstTouchOrders: true,
  firstTouchOrderValueCents: true,
  whatsappClickSessions: true,
} as const;

type SourceKey = { sourceKind: string; source: string; medium: string; campaign: string };

const acquisitionKey = (r: SourceKey) =>
  `${r.sourceKind}\u0000${r.source}\u0000${r.medium}\u0000${r.campaign}`;

async function acquisitionSums(db: TxClient, tenantId: string, range: DayRange) {
  const rows = await db.analyticsAcquisitionDaily.groupBy({
    by: ["sourceKind", "source", "medium", "campaign"],
    where: { tenantId, localDay: dayFilter(range) },
    _sum: ACQUISITION_SUMS,
  });
  return new Map(rows.map((r) => [acquisitionKey(r), r]));
}

/**
 * Where the traffic came from, and what it did.
 *
 * Fewer columns than §5.5 asks for: the aggregate holds sessions, orders, order value and
 * WhatsApp click sessions per source, but not visitors, product viewers, cart sessions or
 * potential WhatsApp value. Those are a change to `AnalyticsAcquisitionDaily` and a recompute,
 * not something to derive here — a per-source figure apportioned from a store-wide one would be
 * wrong in exactly the way that cannot be noticed. The view shows what exists.
 */
export function acquisitionReport(
  tenantId: string,
  range: DayRange,
  basis: AttributionBasis = "last",
): Promise<AcquisitionRow[]> {
  const comparedWith = previousPeriod(range);
  const ordersOf = (s: Record<string, number | null>) =>
    zero(basis === "last" ? s.lastTouchOrders : s.firstTouchOrders);
  const valueOf = (s: Record<string, number | null>) =>
    zero(basis === "last" ? s.lastTouchOrderValueCents : s.firstTouchOrderValueCents);
  return withTenant(tenantId, async (db) => {
    const [now, before] = await Promise.all([
      acquisitionSums(db, tenantId, range),
      acquisitionSums(db, tenantId, comparedWith),
    ]);
    const rows: AcquisitionRow[] = [...now.values()].map((r) => {
      const s = r._sum as unknown as Record<string, number | null>;
      const pastRow = before.get(acquisitionKey(r));
      const past = pastRow
        ? (pastRow._sum as unknown as Record<string, number | null>)
        : undefined;
      const sessions = zero(s.sessions);
      const orders = ordersOf(s);
      return {
        sourceKind: r.sourceKind,
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        sessions,
        orders,
        orderValueCents: valueOf(s),
        whatsappClickSessions: zero(s.whatsappClickSessions),
        conversionRate: rate(orders, sessions),
        change: {
          sessions: delta(sessions, zero(past?.sessions)),
          orders: delta(orders, past ? ordersOf(past) : 0),
          orderValueCents: delta(valueOf(s), past ? valueOf(past) : 0),
        },
      };
    });
    return rows.sort((a, b) => b.sessions - a.sessions);
  });
}

/** One row per campaign, for Marketing's Results (D38: computed here, shown in two places). */
export async function campaignResults(
  tenantId: string,
  range: DayRange,
  basis: AttributionBasis = "last",
): Promise<AcquisitionRow[]> {
  const rows = await acquisitionReport(tenantId, range, basis);
  const merged = new Map<string, AcquisitionRow>();
  for (const row of rows.filter((r) => r.campaign !== "")) {
    const existing = merged.get(row.campaign);
    if (!existing) {
      // One campaign can arrive through several sources; Results is about the campaign, so the
      // source fields are cleared rather than left showing whichever one happened to be first.
      merged.set(row.campaign, { ...row, sourceKind: "campaign", source: "", medium: "" });
      continue;
    }
    existing.sessions += row.sessions;
    existing.orders += row.orders;
    existing.orderValueCents += row.orderValueCents;
    existing.whatsappClickSessions += row.whatsappClickSessions;
    existing.conversionRate = rate(existing.orders, existing.sessions);
    existing.change = {
      sessions: delta(
        existing.change.sessions.current + row.change.sessions.current,
        existing.change.sessions.previous + row.change.sessions.previous,
      ),
      orders: delta(
        existing.change.orders.current + row.change.orders.current,
        existing.change.orders.previous + row.change.orders.previous,
      ),
      orderValueCents: delta(
        existing.change.orderValueCents.current + row.change.orderValueCents.current,
        existing.change.orderValueCents.previous + row.change.orderValueCents.previous,
      ),
    };
  }
  return [...merged.values()].sort((a, b) => b.sessions - a.sessions);
}

// ---------------------------------------------------------------------------------------------
// Searches (§5.6)
// ---------------------------------------------------------------------------------------------

export type SearchRow = {
  phrase: string;
  searches: number;
  searchSessions: number;
  noResultSearches: number;
  resultClickSessions: number;
  redacted: boolean;
  /** Share of this phrase's searches that found nothing. */
  noResultRate: number | null;
};

export type SearchReport = {
  range: DayRange;
  rows: SearchRow[];
  /** Includes the redacted row: leaving it out would understate how much searching happened. */
  totalSearches: number;
  /**
   * Phrases a store could act on: no-result searches, redacted rows excluded.
   *
   * The exclusion is the point (D22, P4-12). A redacted row counts as searching, but whoever
   * typed a phone number into a search box was not shopping, and "customers are looking for
   * 03 123 456" is the kind of suggestion that costs a merchant their trust in the whole screen.
   */
  demand: SearchRow[];
};

export function searchReport(tenantId: string, range: DayRange): Promise<SearchReport> {
  return withTenant(tenantId, async (db) => {
    const grouped = await db.analyticsSearchDaily.groupBy({
      by: ["phrase", "redacted"],
      where: { tenantId, localDay: dayFilter(range) },
      _sum: {
        searches: true,
        searchSessions: true,
        noResultSearches: true,
        resultClickSessions: true,
      },
    });
    const rows: SearchRow[] = grouped
      .map((r) => ({
        phrase: r.phrase,
        searches: zero(r._sum.searches),
        searchSessions: zero(r._sum.searchSessions),
        noResultSearches: zero(r._sum.noResultSearches),
        resultClickSessions: zero(r._sum.resultClickSessions),
        redacted: r.redacted,
        noResultRate: rate(zero(r._sum.noResultSearches), zero(r._sum.searches)),
      }))
      .sort((a, b) => b.searches - a.searches);
    return {
      range,
      rows,
      totalSearches: rows.reduce((n, r) => n + r.searches, 0),
      demand: rows
        .filter((r) => !r.redacted && r.noResultSearches > 0)
        .sort((a, b) => b.noResultSearches - a.noResultSearches),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Heatmap (§5.7)
// ---------------------------------------------------------------------------------------------

export type HeatmapMeasure = "sessions" | "orders" | "orderValueCents";

export type HeatmapCell = {
  /** 0 = Sunday, as the store's own clock named the day. */
  weekday: number;
  hour: number;
  value: number;
};

/**
 * Weekday × hour, in store-local time, for one measure at a time.
 *
 * One measure, never two in one grid: a cell shaded by sessions and labelled with orders is
 * read as whichever the reader expected. The hours come from the rows themselves, so a
 * spring-forward day contributes no cell for the hour that did not happen rather than a zero
 * that reads as a dead hour.
 */
export function activityHeatmap(
  tenantId: string,
  range: DayRange,
  measure: HeatmapMeasure = "sessions",
): Promise<HeatmapCell[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.analyticsHourlyMetric.findMany({
      where: { tenantId, localDay: dayFilter(range) },
      select: { localDay: true, hour: true, sessions: true, orders: true, orderValueCents: true },
    });
    const cells = new Map<string, HeatmapCell>();
    for (const row of rows) {
      // localDay is a zoneless date stored at UTC midnight, so the UTC weekday IS the store's
      // weekday for that date. Reading it with getDay() would use the server's own offset and
      // shift a Sunday into a Saturday for half the world.
      const weekday = row.localDay.getUTCDay();
      const key = `${weekday}:${row.hour}`;
      const cell = cells.get(key) ?? { weekday, hour: row.hour, value: 0 };
      cell.value += row[measure];
      cells.set(key, cell);
    }
    return [...cells.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  });
}
