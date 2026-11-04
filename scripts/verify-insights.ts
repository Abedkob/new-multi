/**
 * Phase 5 verification: §6's insights (pnpm verify:insights — P5-08 to P5-11).
 *
 * Pure, so every threshold is exercised at the line, one below it, and one above — which is the
 * only way to tell a rule that works from a rule that happens to fire. No database and no
 * server: an insight is a function of figures, and that is exactly why it can be held to this.
 *
 * The property worth more than any individual rule: **below the threshold there is nothing**,
 * not a hedged version. So each check below asserts the empty result as hard as the positive one.
 */

// Only for EMPTY_TOTALS below, which is the one value this script borrows from the report layer;
// loading that module loads lib/env, which refuses to start without a real .env. insights.ts
// itself imports report.ts for types alone, which is asserted at the end of main().
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INSIGHT_THRESHOLDS,
  activityShiftInsight,
  buildInsights,
  funnelDropInsights,
  highInterestLowConversionInsights,
  revisitedProductInsights,
  strongSourceInsights,
  topProductInsight,
  unmetSearchInsights,
  unnoticedProductInsights,
  type Insight,
} from "../lib/analytics/insights";
import { TREND_RULES, delta, trend } from "../lib/analytics/compare";
import { EMPTY_TOTALS, type AcquisitionRow, type DailyPoint, type FunnelPath, type ProductRow, type SearchReport, type SearchRow } from "../lib/analytics/report";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const BEIRUT = "Asia/Beirut";
const range = { from: "2026-10-01", to: "2026-10-30", timeZone: BEIRUT };

function product(over: Partial<ProductRow> = {}): ProductRow {
  return {
    productId: "p1",
    productName: "Thing",
    viewSessions: 0,
    views: 0,
    viewerDays: 0,
    returningViewerDays: 0,
    addToCartSessions: 0,
    whatsappClickSessions: 0,
    purchasingSessions: 0,
    unitsOrdered: 0,
    orderValueCents: 0,
    conversionRate: null,
    actionRate: null,
    change: {
      viewSessions: delta(0, 0),
      purchasingSessions: delta(0, 0),
      orderValueCents: delta(0, 0),
    },
    ...over,
  };
}

function source(over: Partial<AcquisitionRow> = {}): AcquisitionRow {
  return {
    sourceKind: "campaign",
    source: "instagram",
    medium: "social",
    campaign: "eid",
    sessions: 0,
    orders: 0,
    orderValueCents: 0,
    whatsappClickSessions: 0,
    whatsappPotentialValueCents: 0,
    visitorDays: 0,
    productViewSessions: 0,
    cartSessions: 0,
    conversionRate: null,
    change: { sessions: delta(0, 0), orders: delta(0, 0), orderValueCents: delta(0, 0) },
    ...over,
  };
}

function searchRow(over: Partial<SearchRow> = {}): SearchRow {
  return {
    phrase: "winter coat",
    searches: 0,
    searchSessions: 0,
    noResultSearches: 0,
    resultClickSessions: 0,
    redacted: false,
    noResultRate: null,
    ...over,
  };
}

const searchReportOf = (rows: SearchRow[]): SearchReport => ({
  range,
  rows,
  totalSearches: rows.reduce((n, r) => n + r.searches, 0),
  demand: rows.filter((r) => !r.redacted && r.noResultSearches > 0),
});

/** A two-step path: `entered` above, `continued` below, with the period before it. */
function path(
  entered: number,
  continued: number,
  previousEntered = entered,
  previousContinued = continued,
): FunnelPath {
  return {
    path: "website",
    steps: [
      {
        key: "sessions",
        sessions: entered,
        fromPreviousStep: null,
        fromEntry: null,
        change: delta(entered, previousEntered),
      },
      {
        key: "addToCartSessions",
        sessions: continued,
        fromPreviousStep: entered === 0 ? null : continued / entered,
        fromEntry: entered === 0 ? null : continued / entered,
        change: delta(continued, previousContinued),
      },
    ],
  };
}

const days = (count: number, sessions: number): DailyPoint[] =>
  [...Array(count).keys()].map((i) => ({
    ...EMPTY_TOTALS,
    day: `2026-10-${String(i + 1).padStart(2, "0")}`,
    sessions,
  }));

/** Every insight must be able to show its working. */
function assertCarriesEvidence(insights: Insight[], where: string) {
  for (const insight of insights) {
    assert.ok(insight.evidence.length > 8, `${where}: ${insight.kind} has no evidence`);
    assert.ok(
      Object.keys(insight.numbers).length > 0,
      `${where}: ${insight.kind} carries no numbers for its copy`,
    );
    assert.ok(
      /\d/.test(insight.evidence),
      `${where}: ${insight.kind}'s evidence states no figure`,
    );
  }
}

function main() {
  // ----------------------------------------------- §6: high interest, low conversion (25 views)
  const hilc = INSIGHT_THRESHOLDS.highInterestLowConversion;
  const atLine = product({ viewSessions: hilc.minViewSessions });
  const belowLine = product({ viewSessions: hilc.minViewSessions - 1 });
  assert.equal(highInterestLowConversionInsights([atLine]).length, 1);
  assert.deepEqual(
    highInterestLowConversionInsights([belowLine]),
    [],
    "one view session below the threshold must produce nothing at all",
  );
  // Acting, but far below the store's own baseline.
  const busy = product({ productId: "busy", viewSessions: 100, addToCartSessions: 40 });
  const sluggish = product({ productId: "slow", viewSessions: 50, addToCartSessions: 2 });
  const flagged = highInterestLowConversionInsights([busy, sluggish]);
  assert.deepEqual(flagged.map((i) => i.subject.productId), ["slow"]);
  assert.ok(flagged[0].evidence.includes("across the store"), "the baseline must be shown");
  // And the same product in a store where nobody ever acts is NOT flagged: the baseline moved.
  const quietStore = highInterestLowConversionInsights([
    product({ productId: "slow", viewSessions: 50, addToCartSessions: 2 }),
    product({ productId: "other", viewSessions: 50, addToCartSessions: 1 }),
  ]);
  assert.deepEqual(
    quietStore.map((i) => i.subject.productId),
    [],
    "a store whose whole baseline is low must not have every product flagged",
  );
  assertCarriesEvidence(flagged, "high-interest-low-conversion");
  ok("P5-08", `high interest / low conversion fires at ${hilc.minViewSessions} views, not at ${hilc.minViewSessions - 1}`);
  ok("P5-08", "and compares against the store's own baseline, so a quiet store is left alone");

  // ------------------------------------------------------ §6: revisited product (10 viewers)
  const rev = INSIGHT_THRESHOLDS.revisitedProduct;
  const revisited = product({
    viewerDays: rev.minViewerDays,
    returningViewerDays: Math.ceil(rev.minViewerDays * rev.minReturningShare),
  });
  assert.equal(revisitedProductInsights([revisited]).length, 1);
  assert.deepEqual(
    revisitedProductInsights([{ ...revisited, viewerDays: rev.minViewerDays - 1 }]),
    [],
    "one viewer below the threshold must produce nothing",
  );
  assert.deepEqual(
    revisitedProductInsights([{ ...revisited, returningViewerDays: 1 }]),
    [],
    "ten viewers who were all new is not a revisited product",
  );
  // Unmeasured is not low.
  assert.deepEqual(
    revisitedProductInsights([{ ...revisited, viewerDays: null }]),
    [],
    "a period that never measured viewers must produce no claim either way",
  );
  ok("P5-08", `revisited product needs ${rev.minViewerDays} viewers and ${rev.minReturningShare * 100}% returning, and treats unmeasured as unknown`);

  // --------------------------------------------------- §6: unnoticed product (14 active days)
  const un = INSIGHT_THRESHOLDS.unnoticedProduct;
  const ignored = product({ viewSessions: un.maxViewSessionsIn30Days });
  assert.equal(unnoticedProductInsights([ignored], days(un.minActiveDays, 4)).length, 1);
  assert.deepEqual(
    unnoticedProductInsights([ignored], days(un.minActiveDays - 1, 4)),
    [],
    "a store with too few active days must not be told its products are unnoticed",
  );
  assert.deepEqual(
    unnoticedProductInsights([ignored], days(un.minActiveDays, 0)),
    [],
    "days with no sessions are not active days",
  );
  assert.deepEqual(
    unnoticedProductInsights(
      [product({ viewSessions: un.maxViewSessionsIn30Days + 1 })],
      days(un.minActiveDays, 4),
    ),
    [],
    "one view session above the threshold is not unnoticed",
  );
  ok("P5-08", `unnoticed product needs ${un.minActiveDays} active days, counted as days with sessions`);

  // ----------------------------------------------------------- §6: funnel drop (20 entering)
  const fd = INSIGHT_THRESHOLDS.funnelDrop;
  const leaking = fd.minSessionsEnteringStep;
  const continued = Math.floor(leaking * (fd.maxContinuationRate - 0.05));
  assert.equal(funnelDropInsights(path(leaking, continued)).length, 1, "a store-specific drop");
  assert.deepEqual(
    funnelDropInsights(path(leaking - 1, continued)),
    [],
    "one session below the entering threshold must produce nothing",
  );
  assert.deepEqual(
    funnelDropInsights(path(100, 90)),
    [],
    "a healthy step must not be flagged",
  );
  // The period-over-period half: a step that was fine and is now worse, but not below the
  // store-specific floor, so only the comparison can catch it.
  const worsened = funnelDropInsights(path(100, 55, 100, 80));
  assert.equal(worsened.length, 1, "a step that got worse must be caught by the comparison");
  assert.ok(
    worsened[0].evidence.includes("in the period before"),
    "and must say which half fired",
  );
  assert.equal(worsened[0].numbers.dropPoints, 25);
  assertCarriesEvidence(worsened, "funnel-drop");
  ok("P5-08", `funnel drop needs ${fd.minSessionsEnteringStep} entering, and fires on either a low rate or a ${fd.minRateDropPoints}-point fall`);

  // -------------------------------------------------------- §6: unmet search (5 no-results)
  const us = INSIGHT_THRESHOLDS.unmetSearch;
  const unmet = searchRow({ searches: 9, noResultSearches: us.minNoResultSearches });
  assert.equal(unmetSearchInsights(searchReportOf([unmet])).length, 1);
  assert.deepEqual(
    unmetSearchInsights(searchReportOf([{ ...unmet, noResultSearches: us.minNoResultSearches - 1 }])),
    [],
    "one no-result search below the threshold must produce nothing",
  );
  // The rule that matters most here: a redacted phrase can never become a suggestion.
  assert.deepEqual(
    unmetSearchInsights(
      searchReportOf([{ ...unmet, phrase: "[redacted]", redacted: true, noResultSearches: 50 }]),
    ),
    [],
    "a redacted phrase must never be suggested, however many times it was searched",
  );
  ok("P5-08", `unmet search fires at ${us.minNoResultSearches} no-result searches, and never for a redacted phrase`);

  // ------------------------------------------- §6: strong source (10 sessions + 2 orders / 3 clicks)
  const ss = INSIGHT_THRESHOLDS.strongSource;
  assert.equal(
    strongSourceInsights([source({ sessions: ss.minSessions, orders: ss.minOrders })]).length,
    1,
  );
  assert.equal(
    strongSourceInsights([
      source({ sessions: ss.minSessions, whatsappClickSessions: ss.minWhatsappClickSessions }),
    ]).length,
    1,
    "the WhatsApp half of the rule must work on its own",
  );
  assert.deepEqual(
    strongSourceInsights([source({ sessions: ss.minSessions - 1, orders: 10 })]),
    [],
    "orders without the session threshold must produce nothing",
  );
  assert.deepEqual(
    strongSourceInsights([
      source({
        sessions: ss.minSessions,
        orders: ss.minOrders - 1,
        whatsappClickSessions: ss.minWhatsappClickSessions - 1,
      }),
    ]),
    [],
    "sessions alone, with neither conversion half met, must produce nothing",
  );
  const strong = strongSourceInsights([
    source({ sessions: 40, orders: 3, whatsappClickSessions: 9 }),
  ]);
  assert.ok(
    strong[0].evidence.includes("website order") && strong[0].evidence.includes("WhatsApp click"),
    "both figures must be stated; neither stands in for the other",
  );
  ok("P5-08", `strong source needs ${ss.minSessions} sessions plus ${ss.minOrders} orders or ${ss.minWhatsappClickSessions} WhatsApp clicks`);
  ok("P5-03", "a strong source states orders and WhatsApp clicks separately");

  // --------------------------------------------------------------- §6: meaningful activity shift
  const rule = TREND_RULES.sessions;
  assert.equal(activityShiftInsight(trend(3, 2, rule, "sessions")), null, "5 sessions is not a shift");
  assert.equal(
    activityShiftInsight(trend(rule.minSample, rule.minSample, rule, "sessions")),
    null,
    "a steady period, however large, is not a shift",
  );
  const shifted = activityShiftInsight(trend(60, 20, rule, "sessions"));
  assert.ok(shifted, "a real change above the threshold must be reported");
  assert.equal(shifted.numbers.percent, 200);
  assert.equal(shifted.tone, "attention");
  ok("P5-08", `activity shift uses compare.ts's own verdict (${rule.minSample} across the comparison), so no two screens disagree`);

  // ------------------------------------------------------------------- §6: the top product is a fact
  assert.equal(topProductInsight([]), null, "no products, no leader");
  const top = topProductInsight([
    product({ productId: "viewed", viewSessions: 90 }),
    product({ productId: "sold", viewSessions: 10, purchasingSessions: 4 }),
  ]);
  assert.equal(top!.subject.productId, "sold", "orders lead views: they are worth more to know");
  assert.ok(top!.evidence.startsWith("leads by website orders"), "and the measure must be stated");
  assert.equal(top!.tone, "fact");
  const byViews = topProductInsight([product({ productId: "viewed", viewSessions: 90 })]);
  assert.ok(byViews!.evidence.startsWith("leads by views"), "with nothing sold, views are the measure");
  ok("P5-11", "the top product is a fact that names the measure it leads by, orders before views");

  // --------------------------------------------------------- P5-10, P5-11: the set, and its silence
  const empty = buildInsights({
    products: [],
    series: [],
    website: path(0, 0),
    whatsapp: path(0, 0),
    searches: searchReportOf([]),
    sources: [],
    sessionTrend: trend(0, 0, rule, "sessions"),
  });
  assert.deepEqual(empty, [], "a store with nothing measured gets no insights, not weak ones");
  ok("P5-10", "an unmeasured store produces an empty set, which the UI must report as such");

  const full = buildInsights({
    products: [
      product({ productId: "slow", viewSessions: 60, addToCartSessions: 1 }),
      product({ productId: "sold", viewSessions: 40, purchasingSessions: 6, addToCartSessions: 20 }),
    ],
    series: days(20, 5),
    website: path(100, 55, 100, 80),
    whatsapp: path(0, 0),
    searches: searchReportOf([searchRow({ searches: 11, noResultSearches: 11 })]),
    sources: [source({ sessions: 40, orders: 3, whatsappClickSessions: 9 })],
    sessionTrend: trend(60, 20, rule, "sessions"),
  });
  assertCarriesEvidence(full, "buildInsights");
  assert.ok(full.length >= 5, `expected a full set, got ${full.length}`);
  assert.equal(full[0].kind, "activity-shift");
  assert.equal(full.at(-1)!.kind, "top-product", "the facts come after what may need doing");
  // §6: cautious language, never an unprovable cause. Checked on the evidence, which is the
  // only prose this module produces — the shipped copy is built from kind and numbers.
  for (const insight of full) {
    assert.doesNotMatch(
      insight.evidence,
      /because|due to|caused|is why|means that|you should/i,
      `${insight.kind} asserts a cause instead of stating evidence`,
    );
  }
  assert.ok(
    full.filter((i) => i.tone === "attention").length >= 3,
    "advice must be marked as advice, so the copy can hedge it",
  );
  ok("P5-09", `all ${full.length} insights carry a figure in their evidence`);
  ok("P5-11", "no insight's evidence asserts a cause, and advice is marked as advice");

  // §6: "no LLM is required", and the rules must stay testable without a database. Both hold
  // only while this module takes figures as arguments instead of fetching them.
  const moduleSource = readFileSync("lib/analytics/insights.ts", "utf8");
  for (const forbidden of ["@/lib/prisma", "withTenant", "fetch(", "process.env"]) {
    assert.ok(!moduleSource.includes(forbidden), `insights.ts must not reach for ${forbidden}`);
  }
  assert.match(
    moduleSource,
    /import type \{[\s\S]*?\} from "@\/lib\/analytics\/report"/,
    "it must import the report layer for types only, or it is no longer pure",
  );
  ok("P5-01", "insights.ts holds rules only: no database, no env, no network, types-only imports");
}

try {
  main();
  console.log(`\n${checks} checks passed.`);
} catch (error) {
  console.error("\nFAILED:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
