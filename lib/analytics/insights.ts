/**
 * §6's insights: deterministic rules over figures the report layer already computed (D42).
 *
 * Pure. No database, no fetch, and no LLM — §6 says none is required, and a rule a merchant can
 * have explained to them is worth more here than a sentence nobody can account for.
 *
 * Three properties this file is built around, in order of how much money they save:
 *
 *   1. **Below the threshold there is no insight, not a weaker one.** Every rule's minimum
 *      evidence is a named number in `INSIGHT_THRESHOLDS`, and failing it produces nothing. A
 *      merchant who reorders stock because nine sessions "converted badly" loses real money.
 *   2. **Every insight carries its evidence.** `numbers` holds what the copy interpolates and
 *      `evidence` is the dev-facing sentence; a view must print the evidence beside the advice,
 *      so the reader can disagree with it.
 *   3. **No insight asserts a cause.** `tone: "attention"` means "may need attention". The one
 *      `tone: "fact"` insight is the top product, which states what it leads by and nothing else.
 *
 * Copy lives outside this module (commit 9, EN and AR). An insight is a `kind`, a `subject` and
 * `numbers` — never a translated sentence — so the Arabic is a translation of one phrase per
 * kind rather than of six sentences assembled in code.
 */
import { rate, type TrendReading } from "@/lib/analytics/compare";
import type {
  AcquisitionRow,
  DailyPoint,
  FunnelPath,
  ProductRow,
  SearchReport,
} from "@/lib/analytics/report";

export type InsightKind =
  | "top-product"
  | "high-interest-low-conversion"
  | "revisited-product"
  | "unnoticed-product"
  | "funnel-drop"
  | "unmet-search"
  | "strong-source"
  | "activity-shift";

/** What the insight is about, so a view can link to it without parsing a sentence. */
export type InsightSubject = {
  productId?: string;
  productName?: string | null;
  phrase?: string;
  source?: string;
  campaign?: string;
  /** A funnel step key, as `report.ts` names them. */
  step?: string;
  /**
   * Which measure the insight is about, for the kinds that lead by one of several (top-product).
   *
   * Structural rather than only in `evidence`, because `evidence` is dev-facing English: the
   * shipped copy is built from `kind` + `subject` + `numbers`, and P5-11 requires the
   * top-product line to say which measure it leads by. A screen cannot translate a sentence.
   */
  measure?: "purchasingSessions" | "whatsappClickSessions" | "viewSessions";
};

export type Insight = {
  kind: InsightKind;
  /** "fact" is stated plainly; "attention" is the cautious register §6 requires. */
  tone: "fact" | "attention";
  subject: InsightSubject;
  /** Everything the copy interpolates, and everything the evidence line is built from. */
  numbers: Record<string, number>;
  /** Dev-facing English. The shipped copy is built from `kind` + `numbers`. */
  evidence: string;
};

/**
 * §6's "minimum evidence" column, as data.
 *
 * Changing a number here is a product decision and shows up as a diff on one line. That is the
 * whole reason they are not inline: a threshold buried in a condition is a number nobody ever
 * revisits, and these decide whether a merchant is advised or left alone.
 */
export const INSIGHT_THRESHOLDS = {
  /** §6: 25 product-view sessions. */
  highInterestLowConversion: {
    minViewSessions: 25,
    /** Or an action rate below half the store's own baseline — not an absolute figure, which
     *  would call a whole category of store badly converting. */
    baselineFraction: 0.5,
  },
  /** §6: 20 mature sessions entering the step. */
  funnelDrop: {
    minSessionsEnteringStep: 20,
    /** A store-specific drop: fewer than this share of the step above continued. */
    maxContinuationRate: 0.3,
    /** Or the continuation rate fell by this many percentage points against the period before. */
    minRateDropPoints: 10,
  },
  /** §6: 5 no-result searches for one phrase. */
  unmetSearch: { minNoResultSearches: 5 },
  /** §6: 10 sessions and 2 website orders or 3 WhatsApp-click sessions. */
  strongSource: { minSessions: 10, minOrders: 2, minWhatsappClickSessions: 3 },
  /** §6: 10 visitors plus a meaningful repeat-view rate. */
  revisitedProduct: { minViewerDays: 10, minReturningShare: 0.3 },
  /** §6: at least 14 active days, and very low 30-day view sessions. */
  unnoticedProduct: { minActiveDays: 14, maxViewSessionsIn30Days: 3 },
} as const;

const pct = (value: number) => `${Math.round(value * 100)}%`;

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

/**
 * §6: "Top product always shows the factual leader and states whether it leads by website
 * orders, WhatsApp clicks, or views."
 *
 * A fact, so it has no evidence threshold — but it does state its measure, because "top
 * product" by views and by orders are often different products and a merchant acting on the
 * wrong one buys the wrong stock. Orders first, then WhatsApp clicks, then views: that is the
 * order of how much each one is worth knowing, and the leader is only ever named by a measure
 * on which something actually happened.
 */
export function topProductInsight(products: readonly ProductRow[]): Insight | null {
  const measures = [
    { key: "purchasingSessions", label: "website orders" },
    { key: "whatsappClickSessions", label: "WhatsApp clicks" },
    { key: "viewSessions", label: "views" },
  ] as const;
  for (const measure of measures) {
    const ranked = [...products]
      .filter((p) => p[measure.key] > 0)
      .sort((a, b) => b[measure.key] - a[measure.key]);
    const leader = ranked[0];
    if (!leader) continue;
    const runnerUp = ranked[1];
    return {
      kind: "top-product",
      tone: "fact",
      subject: {
        productId: leader.productId,
        productName: leader.productName,
        measure: measure.key,
      },
      numbers: {
        value: leader[measure.key],
        runnerUp: runnerUp ? runnerUp[measure.key] : 0,
        competitors: ranked.length,
      },
      evidence: `leads by ${measure.label}: ${leader[measure.key]}${
        runnerUp ? ` against ${runnerUp[measure.key]} for the next product` : " and nothing else"
      }`,
    };
  }
  return null;
}

/**
 * §6: the view threshold, and either no action at all or a rate below half the store baseline.
 *
 * The baseline is the store's own, so a store where nobody ever adds to cart is not told that
 * every product is a problem — which is what an absolute target would do.
 */
export function highInterestLowConversionInsights(
  products: readonly ProductRow[],
): Insight[] {
  const rule = INSIGHT_THRESHOLDS.highInterestLowConversion;
  const totalViews = products.reduce((n, p) => n + p.viewSessions, 0);
  const totalActions = products.reduce(
    (n, p) => n + p.addToCartSessions + p.whatsappClickSessions + p.purchasingSessions,
    0,
  );
  const baseline = rate(totalActions, totalViews);
  const out: Insight[] = [];
  for (const product of products) {
    if (product.viewSessions < rule.minViewSessions) continue;
    const actions =
      product.addToCartSessions + product.whatsappClickSessions + product.purchasingSessions;
    const actionRate = rate(actions, product.viewSessions);
    const belowBaseline =
      baseline !== null && actionRate !== null && actionRate < baseline * rule.baselineFraction;
    if (actions !== 0 && !belowBaseline) continue;
    out.push({
      kind: "high-interest-low-conversion",
      tone: "attention",
      subject: { productId: product.productId, productName: product.productName },
      numbers: {
        viewSessions: product.viewSessions,
        actions,
        actionRate: actionRate ?? 0,
        storeBaseline: baseline ?? 0,
      },
      evidence:
        actions === 0
          ? `${product.viewSessions} viewing sessions and no cart, WhatsApp click or order`
          : `${pct(actionRate ?? 0)} of ${product.viewSessions} viewing sessions acted, against ${pct(baseline ?? 0)} across the store`,
    });
  }
  return out;
}

/** §6: 10 viewers plus a meaningful share of them returning. */
export function revisitedProductInsights(products: readonly ProductRow[]): Insight[] {
  const rule = INSIGHT_THRESHOLDS.revisitedProduct;
  const out: Insight[] = [];
  for (const product of products) {
    // Null means the period was not fully measured (D48a). Unknown is not low: skipping is the
    // only honest answer, and the view says the period is partly measured.
    if (product.viewerDays === null || product.returningViewerDays === null) continue;
    if (product.viewerDays < rule.minViewerDays) continue;
    const share = rate(product.returningViewerDays, product.viewerDays);
    if (share === null || share < rule.minReturningShare) continue;
    out.push({
      kind: "revisited-product",
      tone: "fact",
      subject: { productId: product.productId, productName: product.productName },
      numbers: {
        viewerDays: product.viewerDays,
        returningViewerDays: product.returningViewerDays,
        returningShare: share,
      },
      evidence: `${product.returningViewerDays} of ${product.viewerDays} viewers had seen the store before (${pct(share)})`,
    });
  }
  return out;
}

/**
 * §6: "Unnoticed product requires at least 14 active days and very low 30-day view sessions."
 *
 * The active-day floor is what keeps this from firing on a store that opened last week: a
 * product nobody has seen in a shop nobody has visited is not a product problem.
 */
export function unnoticedProductInsights(
  products: readonly ProductRow[],
  series: readonly DailyPoint[],
): Insight[] {
  const rule = INSIGHT_THRESHOLDS.unnoticedProduct;
  const activeDays = series.filter((d) => d.sessions > 0).length;
  if (activeDays < rule.minActiveDays) return [];
  return products
    .filter((p) => p.viewSessions <= rule.maxViewSessionsIn30Days)
    .map((product) => ({
      kind: "unnoticed-product" as const,
      tone: "attention" as const,
      subject: { productId: product.productId, productName: product.productName },
      numbers: { viewSessions: product.viewSessions, activeDays },
      evidence: `${product.viewSessions} viewing session(s) over ${activeDays} active days`,
    }));
}

// ---------------------------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------------------------

/**
 * §6: "Funnel issue requires a meaningful store-specific or period-over-period drop."
 *
 * Both halves are implemented, and each names which one fired. A step that has always leaked
 * and a step that started leaking this week are different problems: the first is a design
 * question, the second is usually something that broke.
 */
export function funnelDropInsights(path: FunnelPath): Insight[] {
  const rule = INSIGHT_THRESHOLDS.funnelDrop;
  const out: Insight[] = [];
  for (let i = 1; i < path.steps.length; i++) {
    const step = path.steps[i];
    const above = path.steps[i - 1];
    if (above.sessions < rule.minSessionsEnteringStep) continue;
    const now = rate(step.sessions, above.sessions);
    if (now === null) continue;
    const previous = rate(step.change.previous, above.change.previous);
    const dropPoints = previous === null ? null : (previous - now) * 100;
    const storeSpecific = now < rule.maxContinuationRate;
    const worsened = dropPoints !== null && dropPoints >= rule.minRateDropPoints;
    if (!storeSpecific && !worsened) continue;
    out.push({
      kind: "funnel-drop",
      tone: "attention",
      subject: { step: step.key },
      numbers: {
        entered: above.sessions,
        continued: step.sessions,
        continuationRate: now,
        previousContinuationRate: previous ?? 0,
        dropPoints: dropPoints ?? 0,
      },
      evidence: worsened
        ? `${pct(now)} of ${above.sessions} continued, against ${pct(previous ?? 0)} in the period before`
        : `${pct(now)} of ${above.sessions} continued past ${above.key}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Searches and sources
// ---------------------------------------------------------------------------------------------

/**
 * §6: 5 no-result searches for one phrase.
 *
 * Reads `demand`, which has already excluded the redacted row (P4-12): a phone number typed
 * into a search box must never become "customers are looking for".
 */
export function unmetSearchInsights(report: SearchReport): Insight[] {
  const rule = INSIGHT_THRESHOLDS.unmetSearch;
  return report.demand
    .filter((row) => row.noResultSearches >= rule.minNoResultSearches)
    .map((row) => ({
      kind: "unmet-search" as const,
      tone: "attention" as const,
      subject: { phrase: row.phrase },
      numbers: {
        noResultSearches: row.noResultSearches,
        searches: row.searches,
        searchSessions: row.searchSessions,
      },
      evidence: `${row.noResultSearches} searches for this phrase found nothing`,
    }));
}

/** §6: 10 sessions, and 2 website orders or 3 WhatsApp-click sessions. */
export function strongSourceInsights(sources: readonly AcquisitionRow[]): Insight[] {
  const rule = INSIGHT_THRESHOLDS.strongSource;
  const out: Insight[] = [];
  for (const row of sources) {
    if (row.sessions < rule.minSessions) continue;
    const byOrders = row.orders >= rule.minOrders;
    const byClicks = row.whatsappClickSessions >= rule.minWhatsappClickSessions;
    if (!byOrders && !byClicks) continue;
    out.push({
      kind: "strong-source",
      tone: "fact",
      subject: {
        source: row.source || row.sourceKind,
        campaign: row.campaign || undefined,
      },
      numbers: {
        sessions: row.sessions,
        orders: row.orders,
        whatsappClickSessions: row.whatsappClickSessions,
        conversionRate: row.conversionRate ?? 0,
      },
      // Both figures, never one standing in for the other: an order is money, a click is intent.
      evidence: `${row.sessions} sessions produced ${row.orders} website order(s) and ${row.whatsappClickSessions} WhatsApp click session(s)`,
    });
  }
  return out;
}

/**
 * §6's "meaningful activity shift", which is `compare.ts`'s trend reading and nothing more.
 *
 * It deliberately re-uses that verdict rather than applying its own numbers: the overview tile
 * and the insight beside it must never disagree about whether a week was a trend.
 */
export function activityShiftInsight(reading: TrendReading): Insight | null {
  if (reading.verdict === "insufficient" || reading.verdict === "steady") return null;
  return {
    kind: "activity-shift",
    tone: "attention",
    subject: {},
    numbers: {
      current: reading.delta.current,
      previous: reading.delta.previous,
      absolute: reading.delta.absolute,
      percent: reading.delta.percent ?? 0,
    },
    evidence: reading.evidence,
  };
}

// ---------------------------------------------------------------------------------------------
// The set a screen shows
// ---------------------------------------------------------------------------------------------

export type InsightInput = {
  products: readonly ProductRow[];
  /** A 30-day window, which `unnoticed-product` depends on (§6). */
  monthProducts?: readonly ProductRow[];
  monthSeries?: readonly DailyPoint[];
  series: readonly DailyPoint[];
  website: FunnelPath;
  whatsapp: FunnelPath;
  searches: SearchReport;
  sources: readonly AcquisitionRow[];
  sessionTrend: TrendReading;
};

/**
 * Everything §6 has to say about a period, most actionable first.
 *
 * An empty array is a real answer and the common one for a new store. §5.9 requires the UI to
 * say there is not enough evidence for a reliable recommendation — which is a sentence about
 * the store, not a reason to lower a threshold until something appears.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const ordered = [
    ...funnelDropInsights(input.website),
    ...funnelDropInsights(input.whatsapp),
    ...unmetSearchInsights(input.searches),
    ...highInterestLowConversionInsights(input.products),
    ...(input.monthProducts && input.monthSeries
      ? unnoticedProductInsights(input.monthProducts, input.monthSeries)
      : []),
    ...strongSourceInsights(input.sources),
    ...revisitedProductInsights(input.products),
  ];
  const shift = activityShiftInsight(input.sessionTrend);
  const top = topProductInsight(input.products);
  // Attention first, then the facts: a merchant reading top to bottom should meet what may need
  // doing before what is simply true.
  return [...(shift ? [shift] : []), ...ordered, ...(top ? [top] : [])];
}
