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

/**
 * A total over a column that some days never measured, or null.
 *
 * Several columns were added to the aggregates after they had history (D44, D48, D48a), so an
 * older day holds null rather than 0 — "nobody asked" is not "nobody came". Postgres's `sum`
 * skips nulls, so totalling such a range silently under-reports: a 30-day window containing 10
 * measured days returns a third of the real figure and looks like a decline.
 *
 * `rows` is how many rows the range has and `measured` how many of them carry the column. When
 * they differ the answer is null, and the view says the period is not fully measured instead of
 * showing a number that is confidently too small.
 */
function totalIfComplete(
  sum: number | null | undefined,
  measured: number,
  rows: number,
): number | null {
  if (rows === 0) return 0;
  return measured === rows ? zero(sum) : null;
}

/** Adds two possibly-unmeasured totals. Unmeasured wins: a partial sum is worse than no sum. */
const addMeasured = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);

// ---------------------------------------------------------------------------------------------
// Daily totals
// ---------------------------------------------------------------------------------------------

/**
 * The daily aggregate's columns, summed over a range.
 *
 * One column is renamed on the way out, and it is the most important line in this file (D49).
 * `AnalyticsDailyMetric.visitors` is *distinct visitors that day*. Summing it over a week does
 * not give distinct visitors for the week: someone who came on Monday and Thursday is counted
 * twice. The honest name for the sum is **visitor-days**, so that is what it is called here.
 * Nothing downstream can label it "visitors" by accident, and a view that wants real distinct
 * visitors for a period has to add a column to the aggregate rather than add up this one.
 *
 * `newVisitors` needs no such treatment: a visitor is new on exactly one day, so the sum over a
 * range really is the number of first-time visitors in it.
 */
export type StoreTotals = {
  sessions: number;
  visitorDays: number;
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

/** The table's own column names, which differ from `StoreTotals` by exactly one (see above). */
const DAILY_COLUMNS = [
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
] as const;

type DailyColumn = (typeof DAILY_COLUMNS)[number];

/** The one rename, in one place: the table's `visitors` becomes `visitorDays`. */
const totalKeyFor = (column: DailyColumn): keyof StoreTotals =>
  column === "visitors" ? "visitorDays" : column;

export const TOTAL_KEYS = DAILY_COLUMNS.map(totalKeyFor);

export const EMPTY_TOTALS: StoreTotals = Object.fromEntries(
  TOTAL_KEYS.map((k) => [k, 0]),
) as StoreTotals;

function totalsFrom(row: Partial<Record<DailyColumn, number | null>>): StoreTotals {
  return Object.fromEntries(
    DAILY_COLUMNS.map((column) => [totalKeyFor(column), zero(row[column])]),
  ) as StoreTotals;
}

async function sumDaily(db: TxClient, tenantId: string, range: DayRange): Promise<StoreTotals> {
  const summed = await db.analyticsDailyMetric.aggregate({
    where: { tenantId, localDay: dayFilter(range) },
    _sum: Object.fromEntries(DAILY_COLUMNS.map((k) => [k, true])) as Record<string, true>,
  });
  return totalsFrom(summed._sum as unknown as Record<string, number | null>);
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
    return { day, ...(row ? totalsFrom(row) : EMPTY_TOTALS) };
  });
}

export type StoreRates = {
  /** Website orders per session. */
  conversionRate: number | null;
  whatsappClickRate: number | null;
  averageOrderValueCents: number | null;
  /**
   * First-time visitors as a share of visitor-days, which over a multi-day range is "the share
   * of daily visitors who were there for the first time" — not a share of people. Named for
   * what it divides by, because the tempting reading of it is wrong.
   */
  newVisitorShareOfVisitorDays: number | null;
};

function ratesOf(t: StoreTotals): StoreRates {
  return {
    conversionRate: rate(t.orders, t.sessions),
    whatsappClickRate: rate(t.whatsappClickSessions, t.sessions),
    averageOrderValueCents: averageCents(t.orderValueCents, t.orders),
    newVisitorShareOfVisitorDays: rate(t.newVisitors, t.visitorDays),
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
  /**
   * The name the product carried on the most recent day in the range (D44), or null when no day
   * recorded one — a product deleted before the snapshot column existed. Null is the view's cue
   * to print "Deleted product", never an empty name.
   */
  productName: string | null;
  viewSessions: number;
  views: number;
  /** Distinct viewers per day, summed: see `visitorDays` on StoreTotals. Null if unmeasured. */
  viewerDays: number | null;
  returningViewerDays: number | null;
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
  viewVisitors: true,
  returningViewVisitors: true,
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
    // _count over a nullable column counts the rows that HAVE it, which is how a partly
    // measured range is told apart from a quiet one (see totalIfComplete).
    _count: { _all: true, viewVisitors: true, returningViewVisitors: true },
  });
  return new Map(rows.map((r) => [r.productId, r]));
}

/**
 * The name to show for each product: the newest non-null snapshot in the range.
 *
 * Newest rather than oldest because a renamed product should read as what it is called now,
 * while a deleted one keeps the last name anyone recorded for it.
 */
async function productNames(db: TxClient, tenantId: string, range: DayRange) {
  const rows = await db.analyticsProductDaily.findMany({
    where: { tenantId, localDay: dayFilter(range), productName: { not: null } },
    select: { productId: true, productName: true },
    orderBy: { localDay: "desc" },
  });
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.productName && !names.has(row.productId)) names.set(row.productId, row.productName);
  }
  return names;
}

/**
 * Per-product figures for the range, busiest first.
 *
 * `productName` is the snapshot the recompute stored (D44), so a product deleted since still
 * names itself. Null means no day in the range recorded a name — a product that was already
 * gone before the column existed — and the view prints "Deleted product" for it.
 */
export function productReport(tenantId: string, range: DayRange): Promise<ProductRow[]> {
  const comparedWith = previousPeriod(range);
  return withTenant(tenantId, async (db) => {
    const [now, before, names] = await Promise.all([
      productSums(db, tenantId, range),
      productSums(db, tenantId, comparedWith),
      productNames(db, tenantId, range),
    ]);
    const rows: ProductRow[] = [...now.entries()].map(([productId, row]) => {
      const s = row._sum;
      const past = before.get(productId)?._sum;
      const viewSessions = zero(s.viewSessions);
      const acted =
        zero(s.addToCartSessions) + zero(s.whatsappClickSessions) + zero(s.purchasingSessions);
      return {
        productId,
        productName: names.get(productId) ?? null,
        viewSessions,
        views: zero(s.views),
        viewerDays: totalIfComplete(s.viewVisitors, row._count.viewVisitors, row._count._all),
        returningViewerDays: totalIfComplete(
          s.returningViewVisitors,
          row._count.returningViewVisitors,
          row._count._all,
        ),
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
  /** Intent per source, in its own field. Never added to `orderValueCents` (§3.4). */
  whatsappPotentialValueCents: number | null;
  /** Null when some day in the range never measured it (D48). See `totalIfComplete`. */
  visitorDays: number | null;
  productViewSessions: number | null;
  cartSessions: number | null;
  conversionRate: number | null;
  change: { sessions: Delta; orders: Delta; orderValueCents: Delta };
};

const ACQUISITION_SUMS = {
  sessions: true,
  visitors: true,
  productViewSessions: true,
  cartSessions: true,
  lastTouchOrders: true,
  lastTouchOrderValueCents: true,
  firstTouchOrders: true,
  firstTouchOrderValueCents: true,
  whatsappClickSessions: true,
  whatsappPotentialValueCents: true,
} as const;

type SourceKey = { sourceKind: string; source: string; medium: string; campaign: string };

const acquisitionKey = (r: SourceKey) =>
  `${r.sourceKind}\u0000${r.source}\u0000${r.medium}\u0000${r.campaign}`;

async function acquisitionSums(db: TxClient, tenantId: string, range: DayRange) {
  const rows = await db.analyticsAcquisitionDaily.groupBy({
    by: ["sourceKind", "source", "medium", "campaign"],
    where: { tenantId, localDay: dayFilter(range) },
    _sum: ACQUISITION_SUMS,
    _count: {
      _all: true,
      visitors: true,
      productViewSessions: true,
      cartSessions: true,
      whatsappPotentialValueCents: true,
    },
  });
  return new Map(rows.map((r) => [acquisitionKey(r), r]));
}

/**
 * Where the traffic came from, and what it did.
 *
 * All nine of §5.5's figures, now that the recompute counts the four it was missing (D48). The
 * four are nullable: a day recorded before that change holds null rather than 0, so a range
 * that reaches back past it reports null instead of a total that is quietly too small.
 *
 * They are counted per source by the recompute, never apportioned here from a store-wide
 * figure — a share-of-sessions estimate would look complete and be wrong with no way to tell.
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
        whatsappPotentialValueCents: totalIfComplete(
          s.whatsappPotentialValueCents,
          r._count.whatsappPotentialValueCents,
          r._count._all,
        ),
        visitorDays: totalIfComplete(s.visitors, r._count.visitors, r._count._all),
        productViewSessions: totalIfComplete(
          s.productViewSessions,
          r._count.productViewSessions,
          r._count._all,
        ),
        cartSessions: totalIfComplete(s.cartSessions, r._count.cartSessions, r._count._all),
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
    // Null plus a number is null, not the number: a campaign whose Instagram traffic predates
    // these columns has no honest visitor-day total, and showing the WhatsApp half alone would
    // be a figure that is too small and looks precise.
    existing.whatsappPotentialValueCents = addMeasured(
      existing.whatsappPotentialValueCents,
      row.whatsappPotentialValueCents,
    );
    existing.visitorDays = addMeasured(existing.visitorDays, row.visitorDays);
    existing.productViewSessions = addMeasured(
      existing.productViewSessions,
      row.productViewSessions,
    );
    existing.cartSessions = addMeasured(existing.cartSessions, row.cartSessions);
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
