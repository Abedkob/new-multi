/**
 * Phase 5 verification: the read layer, before anything draws it
 * (pnpm verify:reports — P5-01 to P5-06, the parts a script can prove).
 *
 * This runs before any report UI exists, which is the point. Every mistake this phase can make
 * is a number that is wrong in a way nobody can see: a day boundary off by an hour, a rate of
 * 0% where there was no denominator, a trend drawn from nine sessions, two money figures added
 * together. None of those look like bugs on screen — they look like information.
 *
 * So the rules are pinned here, against a real database, while they are still cheap to change.
 *
 * Fixtures are aggregate rows written directly rather than events put through the recompute:
 * the recompute is Phase 4's claim and `verify:aggregates` already holds it down. What is under
 * test here is what the report layer does with rows it is given.
 *
 * No server needed.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { createProduct, deleteProduct } from "../lib/data/products";
import { recomputeDay } from "../lib/analytics/aggregate";
import {
  TREND_RULES,
  delta,
  lastNLocalDays,
  previousPeriod,
  rangeLength,
  rate,
  trend,
  type DayRange,
} from "../lib/analytics/compare";
import {
  localDayLengthHours,
  localDayOf,
  localDayToDate,
  shiftLocalDay,
  startOfLocalDay,
  type LocalDay,
} from "../lib/analytics/local-day";
import {
  WEBSITE_STEPS,
  acquisitionReport,
  activityHeatmap,
  campaignResults,
  funnelReport,
  productReport,
  searchReport,
  storeOverview,
} from "../lib/analytics/report";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const BEIRUT = "Asia/Beirut";

/** execFile, not exec: no shell, so the pattern cannot be read as shell syntax. */
function gitGrepFiles(pattern: string): string[] {
  try {
    return execFileSync("git", ["grep", "-lF", pattern, "--", "*.ts", "*.tsx"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// P5-01: the report layer cannot read raw events
// ---------------------------------------------------------------------------------------------

/**
 * The rule is about a *dependency*, not about a word, so this follows the imports: every module
 * the report layer pulls in must also be free of the raw tables. A check that only read
 * report.ts would pass the day someone adds a helper that does the reading for it.
 */
function aggregateOnlyCheck() {
  const RAW = /\b(analyticsEvent|analyticsSession|analyticsVisitor)\b\s*\./;
  const seen = new Set<string>();
  const queue = ["lib/analytics/report.ts", "lib/analytics/compare.ts"];
  const offenders: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (RAW.test(source)) offenders.push(file);
    for (const match of source.matchAll(/from "@\/((?:lib|components)\/[^"]+)"/g)) {
      const resolved = `${match[1]}.ts`;
      try {
        readFileSync(resolved, "utf8");
        queue.push(resolved);
      } catch {
        try {
          readFileSync(`${match[1]}.tsx`, "utf8");
          queue.push(`${match[1]}.tsx`);
        } catch {
          // A module outside lib/components, or a directory import: nothing to walk.
        }
      }
    }
  }
  assert.ok(seen.size >= 3, `the import walk only reached ${seen.size} file(s)`);
  assert.deepEqual(
    offenders,
    [],
    `these modules in the report layer read a raw analytics table: ${offenders.join(", ")}`,
  );
  ok("P5-01", `${seen.size} modules reachable from report.ts, none reads a raw analytics table`);

  // And the other half of the rule, which the walk above cannot see: no module may hand the
  // report layer a function that reads events. Checked at the only place such a module could
  // come from — the files that import report.ts.
  //
  // Verification scripts are exempt, and this check caught itself on its first run: a script
  // that writes event fixtures and then reads a report is doing exactly what it should. The
  // rule is about what serves a merchant a number, so it covers the runtime modules only.
  const consumers = gitGrepFiles('from "@/lib/analytics/report"').filter(
    (f) => !f.startsWith("scripts/"),
  );
  for (const file of consumers) {
    assert.ok(
      !RAW.test(readFileSync(file, "utf8")),
      `${file} uses the report layer and also reads raw events`,
    );
  }
  ok("P5-01", `${consumers.length} consumer(s) of report.ts, none reads a raw analytics table`);
}

// ---------------------------------------------------------------------------------------------
// P5-05: what a date range means across a DST boundary
// ---------------------------------------------------------------------------------------------

function rangeChecks() {
  // Asia/Beirut changes its clocks AT MIDNIGHT, so these two days are 23 and 25 hours long.
  // Any range arithmetic done in hours shifts by one on them; done in days, it cannot.
  const SHORT: LocalDay = "2026-03-29";
  const LONG: LocalDay = "2026-10-24";
  assert.equal(localDayLengthHours(SHORT, BEIRUT), 23);
  assert.equal(localDayLengthHours(LONG, BEIRUT), 25);

  for (const [day, hours] of [
    [SHORT, 23],
    [LONG, 25],
  ] as const) {
    // Noon on the odd day, so "today" is unambiguous whichever way the clocks moved.
    const at = new Date(`${day}T10:00:00.000Z`);
    const range = lastNLocalDays(7, at, BEIRUT);
    assert.equal(rangeLength(range), 7, `a 7-day range over a ${hours}-hour day must be 7 days`);
    assert.equal(range.to, day, "the range must end on the store's today, not the server's");
    assert.equal(range.from, shiftLocalDay(day, -6));

    const before = previousPeriod(range);
    assert.equal(rangeLength(before), 7, "the comparison period is the same number of days");
    assert.equal(before.to, shiftLocalDay(range.from, -1), "it must end the day before, exactly");
    assert.ok(before.to < range.from, "the two periods must not overlap by a day");
    assert.equal(
      shiftLocalDay(before.to, 1),
      range.from,
      "and must not skip one between them either",
    );
  }
  ok("P5-05", "7 local days stays 7 days across a 23-hour and a 25-hour day, with no gap or overlap");

  // The hours in those weeks differ, which is correct and is the reason day counts are used.
  const shortWeek = lastNLocalDays(7, new Date(`${SHORT}T10:00:00.000Z`), BEIRUT);
  const hours = (r: DayRange) =>
    r.from === r.to ? 0 : [...Array(7).keys()].reduce((n, i) => n + localDayLengthHours(shiftLocalDay(r.from, i), BEIRUT), 0);
  assert.equal(hours(shortWeek), 167, "the week containing a spring-forward day is 167 hours");
  assert.equal(
    hours(lastNLocalDays(7, new Date(`${LONG}T10:00:00.000Z`), BEIRUT)),
    169,
    "and the week containing a fall-back day is 169",
  );
  ok("P5-05", "those two weeks are 167 and 169 hours long — which is why the window is counted in days");
}

// ---------------------------------------------------------------------------------------------
// The pure arithmetic: rates, deltas, and the refusal to judge a trend
// ---------------------------------------------------------------------------------------------

function arithmeticChecks() {
  assert.equal(rate(0, 0), null, "no denominator must be null, never 0");
  assert.equal(rate(0, 10), 0, "but zero out of ten really is 0");
  assert.equal(delta(5, 0).percent, null, "growth from zero is not a percentage");
  assert.equal(delta(5, 0).absolute, 5);
  assert.equal(delta(8, 4).percent, 100);
  ok("P5-02", "a rate with no denominator is null and growth from zero carries no percentage");

  const rule = TREND_RULES.sessions;
  // Exactly at the sample floor, with a move that clears both bars.
  const at = trend(rule.minSample, rule.minSample - rule.minAbsolute, rule, "sessions");
  assert.equal(at.verdict, "growing");
  // One session below the floor: no verdict at all, not a weaker one.
  const below = trend(rule.minSample - 1, 0, rule, "sessions");
  assert.equal(below.verdict, "insufficient");
  assert.match(below.evidence, /below the \d+ needed/);
  // Enough sample, big percentage, absolute move one short of the bar: a percentage of a small
  // number is still a small number, and both bars have to be cleared.
  const tiny = trend(
    rule.minSample + rule.minAbsolute - 1,
    rule.minSample,
    rule,
    "sessions",
  );
  assert.equal(tiny.verdict, "steady", "a percentage alone must not produce a verdict");
  for (const reading of [at, below, tiny]) {
    assert.ok(reading.evidence.includes("sessions"), "every verdict must name what it counted");
    assert.ok(reading.evidence.length > 10, "and must carry the numbers behind it");
  }
  ok("P5-02", "a trend fires at its threshold, not one below it, and never on a percentage alone");
  ok("P5-09", "every trend reading carries the evidence that produced it");
}

// ---------------------------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------------------------

type DailyFixture = {
  day: LocalDay;
  sessions?: number;
  visitors?: number;
  newVisitors?: number;
  productViewSessions?: number;
  addToCartSessions?: number;
  cartViewSessions?: number;
  checkoutSessions?: number;
  whatsappClickSessions?: number;
  whatsappPotentialValueCents?: number;
  orders?: number;
  orderValueCents?: number;
};

async function writeDaily(tenantId: string, rows: DailyFixture[]) {
  for (const { day, ...numbers } of rows) {
    await prisma.analyticsDailyMetric.create({
      data: { tenantId, localDay: localDayToDate(day), timeZone: BEIRUT, ...numbers },
    });
  }
}

/**
 * The two claims that only the real recompute can settle: that a product keeps its name after
 * it is deleted, and that a source's figures are counted rather than apportioned.
 *
 * Its own store, so the fixture rows written by hand above cannot stand in for the recompute's
 * own output.
 */
async function recomputeChecks() {
  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({
    storeName: `Report C ${run}`,
    ownerName: "C",
    ownerEmail: `report-c-${run}@example.test`,
    passwordHash: "x",
  });
  const T = store.tenant.id;
  await prisma.tenant.update({ where: { id: T }, data: { analyticsTimezone: BEIRUT } });
  const tenant = { id: T, analyticsTimezone: BEIRUT };

  try {
    const product = await createProduct(T, {
      name: "Linen shirt",
      description: "d",
      basePriceCents: 4000,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [{ attributes: {}, stock: 5, priceCentsOverride: null, imageUrl: null }],
    });

    const day = localDayOf(new Date(), BEIRUT);
    const noon = startOfLocalDay(day, BEIRUT).getTime() + 12 * 3_600_000;
    const at = new Date(noon);
    const range: DayRange = { from: day, to: day, timeZone: BEIRUT };

    // Two visitors, one of whom the store had seen before today, so "returning" has a real case.
    const newcomer = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSeenAt: at, lastSeenAt: at },
    });
    const regular = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSeenAt: new Date(noon - 5 * 86_400_000), lastSeenAt: at },
    });
    const sessionFor = (visitorId: string) =>
      prisma.analyticsSession.create({
        data: {
          tenantId: T,
          visitorId,
          startedAt: at,
          lastActivityAt: at,
          sourceKind: "campaign",
          source: "instagram",
          medium: "social",
          campaign: "launch",
        },
      });
    const sessions = [await sessionFor(newcomer.id), await sessionFor(regular.id)];
    const addEvent = (
      session: { id: string; visitorId: string },
      type: string,
      over: Record<string, unknown> = {},
    ) =>
      prisma.analyticsEvent.create({
        data: {
          tenantId: T,
          eventId: randomUUID(),
          type: type as never,
          occurredAt: at,
          sessionId: session.id,
          visitorId: session.visitorId,
          pageKind: "product",
          ...over,
        },
      });
    for (const session of sessions) {
      await addEvent(session, "PRODUCT_VIEW", { productId: product.id });
      await addEvent(session, "PRODUCT_VIEW", { productId: product.id });
    }
    await addEvent(sessions[0], "ADD_TO_CART", { productId: product.id, quantity: 1 });
    await addEvent(sessions[1], "WHATSAPP_ORDER_CLICK", {
      productId: product.id,
      quantity: 2,
      valueCents: 8000,
    });

    await recomputeDay(tenant, day);

    const [named] = await productReport(T, range);
    assert.equal(named.productName, "Linen shirt", "the recompute must snapshot the name");
    assert.equal(named.viewSessions, 2);
    assert.equal(named.views, 4);
    assert.equal(named.viewerDays, 2, "two distinct viewers, counted not inferred");
    assert.equal(named.returningViewerDays, 1, "one of whom had seen the store before today");
    ok("P5-07", "a recompute stores the name a product carried that day, with its viewers counted");

    // The case the snapshot exists for — and the one a recompute could undo.
    await deleteProduct(T, product.id);
    const [afterDelete] = await productReport(T, range);
    assert.equal(afterDelete.productName, "Linen shirt");
    await recomputeDay(tenant, day);
    const [afterRecompute] = await productReport(T, range);
    assert.equal(
      afterRecompute.productName,
      "Linen shirt",
      "recomputing a day after the product was deleted must not erase the name it stored",
    );
    assert.equal(afterRecompute.viewSessions, 2, "and must keep the figures too");
    ok("P5-07", "a deleted product still names itself, and the nightly recompute cannot erase it");

    const [source] = await acquisitionReport(T, range);
    assert.equal(source.campaign, "launch");
    assert.equal(source.sessions, 2);
    assert.equal(source.visitorDays, 2, "visitors per source, counted by the recompute (D48)");
    assert.equal(source.productViewSessions, 2);
    assert.equal(source.cartSessions, 1);
    // This column existed, was initialised to 0 and was never assigned, so every report would
    // have said each campaign produced no WhatsApp clicks.
    assert.equal(source.whatsappClickSessions, 1, "the WhatsApp column must no longer be always 0");
    assert.equal(source.whatsappPotentialValueCents, 8000);
    assert.notEqual(
      source.orderValueCents,
      source.whatsappPotentialValueCents,
      "intent and revenue must stay different fields",
    );
    ok("P5-19", "all of §5.5's per-source figures are counted, including the WhatsApp ones");
  } finally {
    await prisma.tenant.delete({ where: { id: T } }).catch(() => {});
    await prisma.user.delete({ where: { id: store.user.id } }).catch(() => {});
  }
}

async function main() {
  aggregateOnlyCheck();
  rangeChecks();
  arithmeticChecks();

  const run = Date.now().toString(36);
  const a = await createStoreWithOwner({
    storeName: `Report A ${run}`,
    ownerName: "A",
    ownerEmail: `report-a-${run}@example.test`,
    passwordHash: "x",
  });
  const b = await createStoreWithOwner({
    storeName: `Report B ${run}`,
    ownerName: "B",
    ownerEmail: `report-b-${run}@example.test`,
    passwordHash: "x",
  });
  const A = a.tenant.id;
  const B = b.tenant.id;
  await prisma.tenant.updateMany({
    where: { id: { in: [A, B] } },
    data: { analyticsTimezone: BEIRUT },
  });

  try {
    // A fixed "today" so the fixture days are the same every run.
    const today: LocalDay = "2026-11-04";
    const at = new Date(`${today}T10:00:00.000Z`);
    const range = lastNLocalDays(7, at, BEIRUT);
    const before = previousPeriod(range);

    // Three sessions in the current period, two in the one before. Deliberately tiny: the
    // numbers a merchant must still see exactly, and must not be given a trend about.
    await writeDaily(A, [
      {
        day: today,
        sessions: 2,
        visitors: 2,
        newVisitors: 1,
        productViewSessions: 2,
        addToCartSessions: 1,
        cartViewSessions: 1,
        // checkoutSessions deliberately left at 0: P5-06's empty step.
        orders: 1,
        orderValueCents: 2500,
        whatsappClickSessions: 1,
        whatsappPotentialValueCents: 9900,
      },
      { day: shiftLocalDay(today, -3), sessions: 1, visitors: 1, productViewSessions: 1 },
      { day: before.to, sessions: 2, visitors: 2, orders: 1, orderValueCents: 1000 },
    ]);
    // Store B's own data, which must never appear in store A's figures.
    await writeDaily(B, [{ day: today, sessions: 500, orders: 50, orderValueCents: 500_000 }]);

    const overview = await storeOverview(A, range);
    assert.equal(overview.totals.sessions, 3, "3 sessions must be reported as exactly 3");
    assert.equal(overview.totals.orders, 1);
    assert.equal(overview.totals.orderValueCents, 2500);
    assert.equal(overview.previousTotals.sessions, 2);
    assert.equal(overview.deltas.sessions.absolute, 1);
    assert.equal(overview.deltas.sessions.percent, 50);
    assert.equal(overview.trends.sessions.verdict, "insufficient", "3 sessions is not a trend");
    ok("P5-02", "a store with 3 sessions sees 3, a +1 change, and no trend judgment");

    assert.equal(overview.series.length, 7, "the series must cover every day in the range");
    assert.deepEqual(
      overview.series.map((p) => p.day),
      [...Array(7).keys()].map((i) => shiftLocalDay(range.from, i)),
      "including the days with no row at all",
    );
    assert.equal(
      overview.series.reduce((n, p) => n + p.sessions, 0),
      overview.totals.sessions,
      "the series must reconcile with the totals it is drawn beside",
    );
    const emptyDays = overview.series.filter((p) => p.sessions === 0).length;
    assert.equal(emptyDays, 5, "a day with no row is a zero, not a gap");
    ok("P5-04", `the 7-day series reconciles with the totals and fills ${emptyDays} empty days with zeros`);

    assert.equal(overview.rates.conversionRate, 1 / 3);
    assert.equal(overview.rates.averageOrderValueCents, 2500);
    const quiet = await storeOverview(A, { from: "2026-01-01", to: "2026-01-07", timeZone: BEIRUT });
    assert.equal(quiet.totals.sessions, 0);
    assert.equal(quiet.rates.conversionRate, null, "no sessions must not read as 0% conversion");
    assert.equal(quiet.rates.averageOrderValueCents, null);
    assert.equal(quiet.lastComputedAt, null, "and an empty range has no last-computed time");
    ok("P5-02", "a range with no activity reports null rates, not zeros");

    // Store isolation of the read layer itself.
    const bOverview = await storeOverview(B, range);
    assert.equal(bOverview.totals.sessions, 500);
    assert.ok(
      overview.totals.sessions < 500 && overview.totals.orderValueCents === 2500,
      "store A's figures must not include store B's",
    );
    ok("P5-04", "one store's report contains only its own rows");

    // ------------------------------------------------------------------ P5-03, P5-06: the funnel
    const funnel = await funnelReport(A, range);
    assert.deepEqual(
      funnel.website.steps.map((s) => s.key),
      [...WEBSITE_STEPS],
      "every website step must be present, in order",
    );
    const checkout = funnel.website.steps.find((s) => s.key === "checkoutSessions")!;
    assert.equal(checkout.sessions, 0, "a step nobody reached is shown as zero");
    assert.equal(checkout.fromPreviousStep, 0, "with its drop-off, which is the useful part");
    const orders = funnel.website.steps.find((s) => s.key === "orders")!;
    assert.equal(orders.sessions, 1);
    assert.equal(funnel.website.steps[0].fromPreviousStep, null, "the top step has no rate above it");
    ok("P5-06", "a funnel step with zero sessions is shown as zero, with its drop-off, not omitted");

    assert.equal(funnel.websiteOrderValueCents, 2500);
    assert.equal(funnel.whatsappPotentialValueCents, 9900);
    const funnelKeys = Object.keys(funnel);
    assert.deepEqual(
      funnelKeys.filter((k) => /^total|combined/i.test(k)),
      [],
      `the funnel must expose no combined total: ${funnelKeys.join(", ")}`,
    );
    assert.ok(
      !funnel.whatsapp.steps.some((s) => s.key.toLowerCase().includes("value")),
      "the WhatsApp path counts clicks and must not carry a money step",
    );
    ok("P5-03", "order value (2500) and potential WhatsApp value (9900) stay apart, with no total of the two");

    // ---------------------------------------------------------------------------- the other views
    const products = await productReport(A, range);
    assert.deepEqual(products, [], "no product rows written, so no product rows reported");

    await prisma.analyticsProductDaily.createMany({
      data: [
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          productId: "p-popular",
          viewSessions: 10,
          views: 14,
          addToCartSessions: 3,
          whatsappClickSessions: 1,
          purchasingSessions: 2,
          unitsOrdered: 2,
          orderValueCents: 5000,
        },
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          productId: "p-quiet",
          viewSessions: 4,
          views: 4,
        },
      ],
    });
    const ranked = await productReport(A, range);
    assert.deepEqual(ranked.map((r) => r.productId), ["p-popular", "p-quiet"]);
    assert.equal(ranked[0].conversionRate, 0.2);
    assert.equal(ranked[0].actionRate, 0.6, "action rate counts sessions over one denominator");
    assert.equal(ranked[1].conversionRate, 0, "viewed and never bought really is 0");
    ok("P5-04", "product rows rank by viewing sessions and their rates share one denominator");

    await prisma.analyticsAcquisitionDaily.createMany({
      data: [
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          sourceKind: "campaign",
          source: "instagram",
          medium: "social",
          campaign: "eid-sale",
          sessions: 30,
          lastTouchOrders: 3,
          lastTouchOrderValueCents: 9000,
          firstTouchOrders: 5,
          firstTouchOrderValueCents: 15_000,
          whatsappClickSessions: 4,
        },
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          sourceKind: "campaign",
          source: "whatsapp",
          medium: "chat",
          campaign: "eid-sale",
          sessions: 10,
          lastTouchOrders: 1,
          lastTouchOrderValueCents: 2000,
          firstTouchOrders: 0,
          firstTouchOrderValueCents: 0,
          whatsappClickSessions: 6,
        },
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          sourceKind: "direct",
          sessions: 7,
        },
      ],
    });
    const last = await acquisitionReport(A, range, "last");
    const first = await acquisitionReport(A, range, "first");
    const instagramLast = last.find((r) => r.source === "instagram")!;
    const instagramFirst = first.find((r) => r.source === "instagram")!;
    assert.equal(instagramLast.orders, 3);
    assert.equal(instagramFirst.orders, 5, "the first-touch switch must change the credit");
    assert.equal(instagramFirst.orderValueCents, 15_000);
    assert.equal(last.at(-1)!.sourceKind, "direct", "sorted by sessions, so direct is last here");
    ok("P5-19", "acquisition rows answer per source, and first/last touch give different credit");

    const campaigns = await campaignResults(A, range);
    assert.equal(campaigns.length, 1, "one campaign, however many sources it arrived through");
    assert.equal(campaigns[0].campaign, "eid-sale");
    assert.equal(campaigns[0].sessions, 40, "whose sessions are the sum of its sources");
    assert.equal(campaigns[0].orders, 4);
    assert.equal(campaigns[0].whatsappClickSessions, 10);
    assert.equal(campaigns[0].source, "", "and whose source fields are cleared, not guessed");
    assert.equal(campaigns[0].conversionRate, 0.1);
    ok("P5-14", "a campaign seen in the data is reported whole, with no saved campaign row needed");

    await prisma.analyticsSearchDaily.createMany({
      data: [
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          phrase: "winter coat",
          searches: 12,
          searchSessions: 9,
          noResultSearches: 12,
        },
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          phrase: "dress",
          searches: 20,
          searchSessions: 15,
          noResultSearches: 0,
          resultClickSessions: 11,
        },
        {
          tenantId: A,
          localDay: localDayToDate(today),
          timeZone: BEIRUT,
          phrase: "[redacted]",
          searches: 4,
          searchSessions: 4,
          noResultSearches: 4,
          redacted: true,
        },
      ],
    });
    const searches = await searchReport(A, range);
    assert.equal(searches.totalSearches, 36, "the redacted row still counts as searching");
    assert.ok(
      searches.rows.some((r) => r.redacted),
      "and is still listed, so the totals can be reconciled",
    );
    assert.deepEqual(
      searches.demand.map((r) => r.phrase),
      ["winter coat"],
      "but it must never reach a what-to-stock suggestion",
    );
    assert.equal(searches.rows.find((r) => r.phrase === "dress")!.noResultRate, 0);
    assert.equal(searches.rows.find((r) => r.phrase === "winter coat")!.noResultRate, 1);
    ok("P5-20", "searches count the redacted row (36 total) and exclude it from demand");

    await prisma.analyticsHourlyMetric.createMany({
      data: [
        { tenantId: A, localDay: localDayToDate(today), timeZone: BEIRUT, hour: 21, sessions: 6, orders: 2 },
        { tenantId: A, localDay: localDayToDate(today), timeZone: BEIRUT, hour: 22, sessions: 4 },
        { tenantId: A, localDay: localDayToDate(shiftLocalDay(today, -7)), timeZone: BEIRUT, hour: 21, sessions: 99 },
      ],
    });
    const heat = await activityHeatmap(A, range, "sessions");
    // 2026-11-04 is a Wednesday, and must be a Wednesday whatever offset the server runs at.
    assert.deepEqual(
      heat,
      [
        { weekday: 3, hour: 21, value: 6 },
        { weekday: 3, hour: 22, value: 4 },
      ],
      "the heatmap must use the store's weekday and stay inside the range",
    );
    const byOrders = await activityHeatmap(A, range, "orders");
    assert.deepEqual(byOrders.map((c) => c.value), [2, 0]);
    ok("P5-04", "the heatmap buckets by store-local weekday and shows one measure at a time");

    // ------------------------------------------------- D49: what "visitors" over a range means
    assert.ok(
      !Object.keys(overview.totals).includes("visitors"),
      "a summed daily visitor count is visitor-days and must not be called visitors",
    );
    assert.ok(Object.keys(overview.totals).includes("visitorDays"));
    ok("P5-02", "the summed daily visitor count is named visitorDays, so it cannot be mislabelled");

    // ------------------------------- D48: a partly measured range reports null, not a part-sum
    // The acquisition fixtures above were written without the columns added in this commit, so
    // they hold null. A range mixing measured and unmeasured days is the dangerous case: SUM
    // skips nulls, so the total would come back too small and perfectly plausible.
    const partial = await acquisitionReport(A, range);
    assert.equal(
      partial.find((r) => r.source === "instagram")!.visitorDays,
      null,
      "an unmeasured day must make the total null rather than a smaller number",
    );
    await prisma.analyticsAcquisitionDaily.updateMany({
      where: { tenantId: A, source: "instagram" },
      data: { visitors: 21, productViewSessions: 12, cartSessions: 5, whatsappPotentialValueCents: 7000 },
    });
    const measured = (await acquisitionReport(A, range)).find((r) => r.source === "instagram")!;
    assert.equal(measured.visitorDays, 21);
    assert.equal(measured.cartSessions, 5);
    assert.equal(measured.whatsappPotentialValueCents, 7000);
    // And a campaign that merges a measured source with an unmeasured one is still null.
    const mergedCampaign = (await campaignResults(A, range))[0];
    assert.equal(
      mergedCampaign.visitorDays,
      null,
      "merging a measured source with an unmeasured one must not produce a confident total",
    );
    ok("P5-19", "a partly measured period reports null per source, and null survives a merge");

    await recomputeChecks();
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  }
}

// Setting exitCode rather than calling process.exit(): on Windows, exiting while a pooled socket
// is still closing trips a libuv assertion after every check has printed.
main()
  .then(async () => {
    await prisma.$disconnect().catch(() => {});
    console.log(`\n${checks} checks passed.`);
  })
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => {});
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
