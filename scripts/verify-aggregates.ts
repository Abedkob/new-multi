/**
 * Phase 4 verification: the business day, and the aggregates built on it
 * (pnpm verify:aggregates — P4-06 to P4-08, and P4-18 to P4-23 as they arrive).
 *
 * The timezone half of this runs before any aggregate exists, deliberately. A day boundary that
 * is wrong by a few hours produces no error anywhere: the monthly total still adds up, and every
 * daily chart is quietly wrong. So it is proven against a real transition first, and in the
 * zone that actually matters here.
 *
 * Asia/Beirut is this platform's default and it changes clocks AT MIDNIGHT, which makes it the
 * sharpest possible test rather than the easiest:
 *
 *   - 2026-03-29 has no local 00:00 at all. The day begins at 01:00.
 *   - 2026-10-24 has 25 hours, because local 23:00 happens twice.
 *
 * Needs no server. The timezone checks need no database either.
 *   pnpm verify:aggregates
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import {
  endOfLocalDay,
  hoursInLocalDay,
  localDayLengthHours,
  localDayOf,
  localDayRange,
  localDaysBetween,
  localHourOf,
  nextLocalDay,
  previousLocalDay,
  recentLocalDays,
  shiftLocalDay,
  startOfLocalDay,
} from "../lib/analytics/local-day";
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseEnvFile } from "dotenv";
import { recomputeDays } from "../lib/analytics/aggregate";
import { runScheduled } from "../lib/analytics/scheduled";
import { nightlyBackfill, orderStatusSweep } from "../lib/analytics/stages";
import { placeOrder, updateOrderStatus } from "../lib/data/orders";
import { createProduct } from "../lib/data/products";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import { disconnectJobPrisma } from "../lib/prisma-job";
import { prisma } from "../lib/prisma";
import { closeRedis } from "../lib/redis";

/**
 * Files mentioning a fixed string, via git so nothing outside the repository is searched.
 * `git grep -lF` exits 1 when there are no matches, which is not an error here.
 */
function gitGrepFiles(needle: string): string[] {
  try {
    return execSync(`git grep -lF "${needle}" -- "*.ts" "*.tsx"`, { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const BEIRUT = "Asia/Beirut";

function timeZoneChecks() {
  // ------------------------------------------------- P4-06: the store's day, not the UTC day
  // 23:30 in Beirut on 2026-06-15 is 20:30 UTC the same day — easy. The one that matters is
  // 00:30 local, which is still the PREVIOUS day in UTC: an order at half past midnight must
  // not appear in yesterday's figures.
  const lateEvening = new Date("2026-06-15T20:30:00Z"); // 23:30 local
  const afterMidnight = new Date("2026-06-15T21:30:00Z"); // 00:30 local on the 16th
  assert.equal(localDayOf(lateEvening, BEIRUT), "2026-06-15");
  assert.equal(localHourOf(lateEvening, BEIRUT), 23);
  assert.equal(localDayOf(afterMidnight, BEIRUT), "2026-06-16");
  assert.equal(localHourOf(afterMidnight, BEIRUT), 0);
  // The same instant, reported by a store in a different zone, is a different day. This is the
  // whole reason the zone lives on the tenant and not on the viewer.
  assert.equal(localDayOf(afterMidnight, "UTC"), "2026-06-15");
  assert.equal(localDayOf(afterMidnight, "Pacific/Kiritimati"), "2026-06-16");
  ok("P4-06", "23:30 and 00:30 local land on their own local days, whatever UTC says");

  // The range is half-open, so no instant belongs to two days and none belongs to none.
  const day = "2026-06-15";
  const { start, end } = localDayRange(day, BEIRUT);
  assert.equal(localDayOf(start, BEIRUT), day);
  assert.equal(localDayOf(new Date(end.getTime() - 1), BEIRUT), day);
  assert.equal(localDayOf(end, BEIRUT), "2026-06-16", "the end instant belongs to the next day");
  assert.equal(end.getTime() - start.getTime(), 24 * 3_600_000);
  ok("P4-06", "a normal day is a half-open 24-hour range whose end belongs to the next day");

  // ------------------------------------------------------ P4-07: a day that loses an hour
  // Beirut springs forward at midnight, so 2026-03-29 00:00 does not exist. A naive
  // "midnight + 24h" would both invent an instant and run an hour into the next day.
  const springs = "2026-03-29";
  const springStart = startOfLocalDay(springs, BEIRUT);
  assert.equal(localDayOf(springStart, BEIRUT), springs);
  assert.equal(localHourOf(springStart, BEIRUT), 1, "the day begins at 01:00, not at midnight");
  assert.equal(localDayLengthHours(springs, BEIRUT), 23);
  const springHours = hoursInLocalDay(springs, BEIRUT);
  assert.equal(springHours.length, 23);
  assert.ok(!springHours.includes(0), "hour 00 must not appear on a day that has no midnight");
  assert.deepEqual(springHours[0], 1);
  // No instant is lost between the two days, and none is counted twice.
  assert.equal(
    endOfLocalDay(previousLocalDay(springs), BEIRUT).getTime(),
    springStart.getTime(),
    "the previous day must end exactly where this one begins",
  );
  ok("P4-07", `${springs} in Beirut is 23 hours, starts at 01:00 and has no hour 00`);

  // ------------------------------------------------- P4-07: a day that repeats an hour
  const falls = "2026-10-24";
  assert.equal(localDayLengthHours(falls, BEIRUT), 25, "the clocks go back at the next midnight");
  const fallHours = hoursInLocalDay(falls, BEIRUT);
  assert.equal(new Set(fallHours).size, fallHours.length, "an hour label must appear once");
  assert.equal(fallHours.length, 24, "all 24 labels exist; one of them covers two hours");
  // The repeated hour's second pass still belongs to this day, not to the next.
  const secondPass = new Date(endOfLocalDay(falls, BEIRUT).getTime() - 1_800_000);
  assert.equal(localDayOf(secondPass, BEIRUT), falls);
  assert.equal(localHourOf(secondPass, BEIRUT), 23);
  ok("P4-07", `${falls} in Beirut is 25 hours, and the repeated 23:00 still belongs to it`);

  // Boundaries hold at a year end too, where string arithmetic is easiest to get wrong.
  assert.equal(nextLocalDay("2026-12-31"), "2027-01-01");
  assert.equal(previousLocalDay("2026-01-01"), "2025-12-31");
  assert.equal(nextLocalDay("2028-02-28"), "2028-02-29", "2028 is a leap year");
  assert.deepEqual(localDaysBetween("2026-02-27", "2026-03-02"), [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
  ]);
  assert.deepEqual(recentLocalDays(new Date("2026-03-30T10:00:00Z"), BEIRUT, 3), [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ]);
  ok("P4-06", "day arithmetic crosses months, years and a leap day without a zone involved");

  // A zone the runtime does not know must fail loudly rather than silently bucket as UTC.
  assert.throws(() => localDayOf(new Date(), "Mars/Olympus"), /time zone|Invalid/i);
  ok("P4-06", "an unknown zone throws instead of quietly reporting UTC days");
}

/**
 * The aggregate half (P4-12, P4-18 to P4-23).
 *
 * Built on data this check creates itself, at timestamps it chooses, because the claims are all
 * about WHEN something happened: a late event, a cancellation a week after the order, a day that
 * is not today. Nothing here depends on what happens to be in the database.
 */
async function aggregateChecks() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Aggregates ${run}`,
    ownerName: "Phase4",
    ownerEmail: `aggregates-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 4 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: BEIRUT,
      jointControllerRecordedBy: "verify-aggregates",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;
  const zone = BEIRUT;
  const agg = { id: T, analyticsTimezone: zone };

  try {
    const product = await createProduct(T, {
      name: "Aggregated Item",
      description: "",
      basePriceCents: 1000,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [{ attributes: {}, stock: 500, priceCentsOverride: null, imageUrl: null }],
    });
    const variantId = product.variants[0].id;

    const now = new Date();
    const today = localDayOf(now, zone);
    const yesterday = previousLocalDay(today);
    const weekAgo = shiftLocalDay(today, -7);
    /** Noon local, so nothing in this check sits near a boundary by accident. */
    const noon = (day: string) => new Date(startOfLocalDay(day, zone).getTime() + 12 * 3_600_000);

    const visitor = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSeenAt: noon(yesterday), lastSeenAt: now, country: "LB", deviceClass: "mobile" },
    });
    const session = async (day: string, over: Record<string, unknown> = {}) =>
      prisma.analyticsSession.create({
        data: {
          tenantId: T,
          visitorId: visitor.id,
          startedAt: noon(day),
          lastActivityAt: noon(day),
          country: "LB",
          deviceClass: "mobile",
          sourceKind: "campaign",
          source: "newsletter",
          medium: "email",
          campaign: "nov",
          ...over,
        },
      });
    const yesterdaySession = await session(yesterday);
    const todaySession = await session(today, { sourceKind: "social", source: "facebook", medium: "social", campaign: null });

    const addEvent = (
      sessionId: string,
      day: string,
      type: string,
      over: Record<string, unknown> = {},
    ) =>
      prisma.analyticsEvent.create({
        data: {
          tenantId: T,
          eventId: randomUUID(),
          type: type as never,
          occurredAt: noon(day),
          sessionId,
          visitorId: visitor.id,
          pageKind: "other",
          ...over,
        },
      });

    // Yesterday: one session that looked at the product three times, added to cart, and searched.
    await addEvent(yesterdaySession.id, yesterday, "PRODUCT_VIEW", { productId: product.id, pageKind: "product" });
    await addEvent(yesterdaySession.id, yesterday, "PRODUCT_VIEW", { productId: product.id, pageKind: "product" });
    await addEvent(yesterdaySession.id, yesterday, "PRODUCT_VIEW", { productId: product.id, pageKind: "product" });
    await addEvent(yesterdaySession.id, yesterday, "ADD_TO_CART", { productId: product.id, quantity: 1 });
    await addEvent(yesterdaySession.id, yesterday, "CART_VIEW", { pageKind: "cart" });
    await addEvent(yesterdaySession.id, yesterday, "SEARCH_SUBMITTED", { searchQuery: "jacket", resultCount: 2, pageKind: "search" });
    await addEvent(yesterdaySession.id, yesterday, "SEARCH_SUBMITTED", { searchQuery: "umbrella", resultCount: 0, pageKind: "search" });
    await addEvent(yesterdaySession.id, yesterday, "SEARCH_SUBMITTED", { searchQuery: "[redacted]", resultCount: 0, pageKind: "search" });
    await addEvent(yesterdaySession.id, yesterday, "WHATSAPP_ORDER_CLICK", { productId: product.id, quantity: 2, valueCents: 2000 });

    // Today: a session that reached checkout.
    await addEvent(todaySession.id, today, "PRODUCT_VIEW", { productId: product.id, pageKind: "product" });
    await addEvent(todaySession.id, today, "CHECKOUT_STARTED", { pageKind: "checkout" });

    // Two real orders: one today, one a week ago.
    const customer = {
      customerName: "Aggregate Shopper",
      customerPhone: "+961 70 000 020",
      customerAddress: "4 Aggregate Street",
      deliveryLocation: "Test location",
      notes: "",
    };
    const todayOrder = await placeOrder(T, customer, [{ variantId, quantity: 2 }], {
      expectedDeliveryFeeCents: 0,
      attribution: {
        analyticsSessionId: todaySession.id,
        isReturningVisitor: false,
        attributionSource: "facebook",
        attributionMedium: "social",
        attributionCampaign: null,
        firstTouchSource: "newsletter",
        firstTouchMedium: "email",
        firstTouchCampaign: "nov",
        analyticsCountry: "LB",
        analyticsDeviceClass: "mobile",
      },
    });
    const oldOrder = await placeOrder(T, customer, [{ variantId, quantity: 1 }], {
      expectedDeliveryFeeCents: 0,
    });
    // Backdate it, and its updatedAt with it, so it looks like an order placed a week ago that
    // nothing has touched since.
    await prisma.$executeRaw`
      UPDATE "Order" SET "createdAt" = ${noon(weekAgo)}, "updatedAt" = ${noon(weekAgo)}
      WHERE "id" = ${oldOrder.id}
    `;

    // ------------------------------------------------------------- P4-21: it reconciles
    await recomputeDays(agg, [weekAgo, yesterday, today]);
    const dailyRow = async (day: string) =>
      prisma.analyticsDailyMetric.findUniqueOrThrow({
        where: { tenantId_localDay: { tenantId: T, localDay: new Date(`${day}T00:00:00.000Z`) } },
      });

    const yRow = await dailyRow(yesterday);
    assert.equal(yRow.sessions, 1, "one session yesterday");
    assert.equal(yRow.productViewSessions, 1, "three views in one session is ONE session");
    assert.equal(yRow.addToCartSessions, 1);
    assert.equal(yRow.cartViewSessions, 1);
    assert.equal(yRow.checkoutSessions, 0, "yesterday's session never reached checkout");
    assert.equal(yRow.whatsappClickSessions, 1);
    assert.equal(yRow.whatsappPotentialValueCents, 2000);
    assert.equal(yRow.orders, 0, "no order was placed yesterday");
    assert.equal(yRow.timeZone, zone, "the row records which zone computed it");
    ok("P4-21", "yesterday reconciles: 3 product views in 1 session counted as 1 session");

    const tRow = await dailyRow(today);
    assert.equal(tRow.sessions, 1);
    assert.equal(tRow.checkoutSessions, 1);
    assert.equal(tRow.orders, 1, "today's order");
    assert.equal(tRow.orderValueCents, 2000, "2 x 1000, totalled by lib/orders.ts's own helper");
    assert.equal(tRow.cancelledOrders, 0);
    // The two money figures never merge: §3.4's rule, now in a row a merchant reads.
    assert.equal(tRow.whatsappPotentialValueCents, 0, "today had no WhatsApp click");
    ok("P4-21", "today reconciles: 1 order worth 2000, and potential value kept apart from it");

    const products = await prisma.analyticsProductDaily.findMany({ where: { tenantId: T, localDay: new Date(`${yesterday}T00:00:00.000Z`) } });
    assert.equal(products.length, 1);
    assert.equal(products[0].views, 3, "the product's VIEWS are the raw count");
    assert.equal(products[0].viewSessions, 1, "its view SESSIONS are the unique ones");
    assert.equal(products[0].whatsappClickSessions, 1);
    ok("P4-21", "a product's views and its view sessions are both recorded, and differ");

    // ------------------------------------------------------- P4-12: a redacted phrase counts
    const searches = await prisma.analyticsSearchDaily.findMany({
      where: { tenantId: T, localDay: new Date(`${yesterday}T00:00:00.000Z`) },
      orderBy: { phrase: "asc" },
    });
    assert.deepEqual(searches.map((s) => s.phrase).sort(), ["[redacted]", "jacket", "umbrella"]);
    const redacted = searches.find((s) => s.phrase === "[redacted]")!;
    assert.equal(redacted.searches, 1, "a redacted search still counts as a search");
    assert.equal(redacted.redacted, true, "and is flagged, so no stocking suggestion can use it");
    const umbrella = searches.find((s) => s.phrase === "umbrella")!;
    assert.equal(umbrella.noResultSearches, 1, "a no-result search is counted as one");
    assert.equal(searches.find((s) => s.phrase === "jacket")!.noResultSearches, 0);
    ok("P4-12", "the redacted phrase counts as a search and carries the flag that excludes it");

    // -------------------------------------------------------------- P4-18: twice is the same
    const snapshot = async () => {
      // id and computedAt are expected to differ between runs; everything else must not.
      const strip = <T extends { id: string; computedAt: Date }>(rows: T[]) =>
        rows.map(({ id: _id, computedAt: _computedAt, ...rest }) => rest);
      return JSON.stringify([
        strip(await prisma.analyticsDailyMetric.findMany({ where: { tenantId: T }, orderBy: { localDay: "asc" } })),
        strip(await prisma.analyticsHourlyMetric.findMany({ where: { tenantId: T }, orderBy: [{ localDay: "asc" }, { hour: "asc" }] })),
        strip(await prisma.analyticsProductDaily.findMany({ where: { tenantId: T }, orderBy: [{ localDay: "asc" }, { productId: "asc" }] })),
        strip(await prisma.analyticsSearchDaily.findMany({ where: { tenantId: T }, orderBy: [{ localDay: "asc" }, { phrase: "asc" }] })),
        strip(await prisma.analyticsAcquisitionDaily.findMany({ where: { tenantId: T }, orderBy: [{ localDay: "asc" }, { sourceKind: "asc" }, { source: "asc" }] })),
      ]);
    };
    const first = await snapshot();
    await recomputeDays(agg, [weekAgo, yesterday, today]);
    const second = await snapshot();
    assert.equal(second, first, "recomputing the same days must produce identical rows");
    const dayCount = await prisma.analyticsDailyMetric.count({ where: { tenantId: T } });
    assert.equal(dayCount, 3, "and must not grow a duplicate row per run");
    ok("P4-18", "recomputing three days twice produced byte-identical rows and no duplicates");

    // --------------------------------------------------------- P4-19: a late event corrects
    const lateSession = await session(yesterday);
    await addEvent(lateSession.id, yesterday, "PRODUCT_VIEW", { productId: product.id, pageKind: "product" });
    await recomputeDays(agg, [yesterday]);
    const corrected = await dailyRow(yesterday);
    assert.equal(corrected.sessions, 2, "the late session must appear");
    assert.equal(corrected.productViewSessions, 2);
    ok("P4-19", "an event arriving late for yesterday corrected yesterday on the next run");

    // ------------------------------------------ P4-20: a cancellation keeps the conversion
    await updateOrderStatus(T, todayOrder.id, "CANCELLED");
    await recomputeDays(agg, [today]);
    const afterCancel = await dailyRow(today);
    assert.equal(afterCancel.orders, 0, "a cancelled order leaves the live order count");
    assert.equal(afterCancel.orderValueCents, 0, "and leaves the value total");
    assert.equal(afterCancel.cancelledOrders, 1, "but is still counted — somebody chose to buy");
    assert.equal(afterCancel.cancelledOrderValueCents, 2000);
    assert.equal(afterCancel.checkoutSessions, 1, "the funnel step itself is untouched");
    ok("P4-20", "cancelling moved 2000 out of the value total and kept the conversion visible");

    // --------------------------- P4-20a: a cancellation a WEEK later, by both routes (D33)
    // The ordinary window is today and yesterday, so nothing in it would ever revisit this day.
    assert.ok(weekAgo < previousLocalDay(today), "the old order must be outside the daily window");
    const beforeSweep = await dailyRow(weekAgo);
    assert.equal(beforeSweep.orders, 1, "the week-old order starts as a live order");
    assert.equal(beforeSweep.orderValueCents, 1000);

    await updateOrderStatus(T, oldOrder.id, "CANCELLED");
    // Route one: the status sweep, which asks the orders which days they belong to.
    const swept = await runScheduled([orderStatusSweep], { log: () => {}, now: new Date() });
    assert.equal(swept.failed, 0, JSON.stringify(swept));
    const afterSweep = await dailyRow(weekAgo);
    assert.equal(afterSweep.orders, 0, "the sweep must correct the day the order was PLACED");
    assert.equal(afterSweep.cancelledOrders, 1);
    assert.equal(afterSweep.cancelledOrderValueCents, 1000);
    ok("P4-20a", `a cancellation 7 days later corrected ${weekAgo} via the updatedAt sweep`);

    // Route two: the nightly backfill, which would have caught it even if the sweep had not.
    // Proven by breaking the day on purpose and letting the backfill find it.
    await prisma.analyticsDailyMetric.update({
      where: { tenantId_localDay: { tenantId: T, localDay: new Date(`${weekAgo}T00:00:00.000Z`) } },
      data: { orders: 99, orderValueCents: 99_999 },
    });
    const backfilled = await runScheduled([nightlyBackfill], { log: () => {}, now: new Date() });
    assert.equal(backfilled.failed, 0, JSON.stringify(backfilled));
    const afterBackfill = await dailyRow(weekAgo);
    assert.equal(afterBackfill.orders, 0, "the nightly 30-day pass must repair a wrong day");
    assert.equal(afterBackfill.orderValueCents, 0);
    ok("P4-20a", "the nightly 30-day backfill repaired a day that had been corrupted on purpose");

    // ------------------------------------------- P4-08: a zone change is visible, not silent
    // A recompute after a zone change WILL produce different rows — that is correct, because the
    // store's day genuinely moved. What must not happen is that it moves invisibly: every row
    // records the zone it was computed in, so a merchant looking at a step in their own chart
    // can be told why, and a reader can tell two zones apart without guessing from the numbers.
    const beforeZone = await dailyRow(today);
    assert.equal(beforeZone.timeZone, zone);
    await prisma.tenant.update({ where: { id: T }, data: { analyticsTimezone: "Asia/Dubai" } });
    await recomputeDays({ id: T, analyticsTimezone: "Asia/Dubai" }, [today]);
    const afterZone = await prisma.analyticsDailyMetric.findFirst({
      where: { tenantId: T, timeZone: "Asia/Dubai" },
    });
    assert.ok(afterZone, "the recomputed row must record the new zone");
    assert.notEqual(
      afterZone.timeZone,
      beforeZone.timeZone,
      "a row computed in a different zone must say so, or the change is silent",
    );
    await prisma.tenant.update({ where: { id: T }, data: { analyticsTimezone: zone } });
    await recomputeDays(agg, [today]);
    ok("P4-08", "an aggregate row names the zone that computed it, so a zone change is visible");

    // --------------------------------------------- P4-22: the two money figures never merge
    const moneyReaders = gitGrepFiles("whatsappPotentialValueCents");
    const orderValueReaders = gitGrepFiles("orderValueCents");
    assert.ok(orderValueReaders.length > 0, "the search for order value readers found nothing");
    const both = moneyReaders.filter((f) => orderValueReaders.includes(f));
    // The aggregate writes both columns, which is exactly where they must stay separate; what
    // must not exist is a module that ADDS them. Checked textually, since that is the shape the
    // mistake would take.
    for (const file of both) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !/whatsappPotentialValueCents\s*\+\s*\w*[oO]rderValueCents/.test(source) &&
          !/orderValueCents\s*\+\s*\w*hatsappPotentialValueCents/.test(source),
        `${file} adds potential WhatsApp value to order value`,
      );
    }
    ok("P4-22", `${both.length} module(s) touch both money figures and none of them sums them`);
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

/**
 * P4-23: the isolation of the new tables, with RLS doing the refusing.
 *
 * Run in a subprocess as app_user, because scripts/_owner makes this process a superuser and
 * RLS does not apply to one — an isolation check that passes as the owner has proven only that
 * a WHERE clause was typed correctly.
 */
async function isolationCheck() {
  const run = Date.now().toString(36);
  const stores = [];
  for (const which of ["a", "b"]) {
    const made = await createStoreWithOwner({
      storeName: `Isolation ${which} ${run}`,
      ownerName: "Phase4",
      ownerEmail: `isolation-${which}-${run}@example.test`,
      passwordHash: await hashPassword("x".repeat(24)),
      privacy: {
        privacyControllerName: "Phase 4 Ltd",
        privacyEmail: `privacy-${which}-${run}@example.test`,
        privacyPolicyUrl: null,
        defaultLocale: "en",
        analyticsTimezone: BEIRUT,
        jointControllerRecordedBy: "verify-aggregates",
        jointControllerVersion: "2026-11",
      },
    });
    stores.push(made);
  }
  const [a, b] = stores;

  try {
    // One day of figures for each, so there is something to leak.
    for (const [i, store] of stores.entries()) {
      await prisma.analyticsDailyMetric.create({
        data: {
          tenantId: store.tenant.id,
          localDay: new Date("2026-02-02T00:00:00.000Z"),
          timeZone: BEIRUT,
          sessions: 10 + i,
          orders: 1 + i,
          orderValueCents: 1000 * (i + 1),
        },
      });
    }

    const ownerUrl = process.env.DATABASE_URL;
    assert.ok(ownerUrl, "DATABASE_URL is needed to read the restricted role's URL from .env");
    const appUrl = parseEnvFile(readFileSync(".env", "utf8")).APP_DATABASE_URL;
    assert.ok(
      appUrl && new URL(appUrl).username !== new URL(ownerUrl).username,
      "APP_DATABASE_URL must point at a restricted role for this check to mean anything",
    );

    const child = spawnSync(
      `npx tsx scripts/fixtures/aggregate-cross-tenant.ts ${a.tenant.id} ${b.tenant.id}`,
      { shell: true, encoding: "utf8", env: { ...process.env, APP_DATABASE_URL: appUrl } },
    );
    const line = (child.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "{}";
    const result = JSON.parse(line) as {
      role?: { current_user: string; rolsuper: boolean; rolbypassrls: boolean };
      results?: {
        table: string;
        leakedRows: number;
        ownRows: number;
        writeRefused: boolean;
        writeError: string;
      }[];
      threw?: string;
    };
    assert.ok(!result.threw, `the fixture failed: ${result.threw} ${child.stderr}`);

    // The check is worthless unless the subprocess really is the restricted role, so that is
    // asserted rather than assumed — a superuser or a BYPASSRLS role would pass everything
    // below while proving nothing at all.
    assert.ok(result.role, `the fixture reported no role: ${line}`);
    assert.equal(result.role.rolsuper, false, "the fixture must not run as a superuser");
    assert.equal(result.role.rolbypassrls, false, "and must not bypass RLS");

    const perTable = result.results ?? [];
    assert.equal(perTable.length, 6, `every Phase 4 table must be checked: ${line}`);
    for (const row of perTable) {
      assert.equal(row.leakedRows, 0, `${row.table}: another store's rows were readable`);
      assert.equal(row.writeRefused, true, `${row.table}: a row for another store was WRITTEN`);
      assert.match(
        row.writeError,
        /row-level security|violates/i,
        `${row.table}: refused for the wrong reason (${row.writeError})`,
      );
    }
    assert.equal(
      perTable.find((r) => r.table === "AnalyticsDailyMetric")?.ownRows,
      1,
      "the store's own row must still be visible",
    );
    ok(
      "P4-23",
      `as ${result.role.current_user}: all ${perTable.length} Phase 4 tables are invisible and ` +
        "unwritable across tenants (RLS, both halves)",
    );
  } finally {
    for (const store of stores) {
      await prisma.tenant.deleteMany({ where: { id: store.tenant.id } });
      await prisma.user.deleteMany({ where: { id: store.user.id } });
    }
  }
}

/**
 * P4-23a: every tenant-scoped table is actually under forced RLS, with a policy.
 *
 * This is a CONFIGURATION claim, not an access claim, so unlike P4-23 it does not matter which
 * role runs it — it reads catalog metadata rather than anybody's rows. It exists because the
 * access checks can only cover tables somebody thought to cover: a migration that creates a
 * tenant-scoped table and forgets `ENABLE ROW LEVEL SECURITY`, or enables it without `FORCE`,
 * or creates no policy, leaves a table wide open and every existing check still passes.
 *
 * FORCE matters as much as ENABLE: without it, policies do not apply to the table's OWNER, and
 * the owner is what migrations and any future admin script connect as.
 */
async function rlsConfigurationCheck() {
  type Row = { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean };
  const tables = await prisma.$queryRaw<Row[]>`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `;
  const policies = await prisma.$queryRaw<{ tablename: string; policyname: string }[]>`
    SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  `;
  const columns = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenantId'
  `;

  const withTenantId = new Set(columns.map((c) => c.table_name));
  const byName = new Map(tables.map((t) => [t.relname, t]));
  const policyFor = new Map<string, string[]>();
  for (const p of policies) {
    policyFor.set(p.tablename, [...(policyFor.get(p.tablename) ?? []), p.policyname]);
  }

  /**
   * Tables that carry a tenantId and are deliberately NOT under RLS, each with the reason.
   * Anything else with a tenantId must be protected, and a new one shows up as a failure rather
   * than as silence.
   */
  const DELIBERATELY_OPEN: Record<string, string> = {
    // An audit record ABOUT a store is not data belonging to it: a store owner must not be able
    // to read or alter it, and it outlives the store (nullable tenantId, ON DELETE SET NULL).
    AnalyticsAuditLog: "platform evidence about a store, not the store's data",
  };

  /**
   * Gaps this check FOUND, recorded rather than papered over. The list may only shrink, and it
   * is printed on every run so an entry cannot quietly become permanent.
   *
   * It is empty. Its one entry was TenantLicense, which carried a tenantId with no policy on it;
   * the migration 20261105230000_tenant_license_rls closed that, together with the code change
   * it needed — enabling RLS alone would have made getTenantBySlug's license read return null
   * for every store, and isLicenseActive(null) is true by design during the opt-in rollout, so
   * licensing would have stopped being enforced without an error anywhere. verify:isolation
   * holds both halves down: another store can neither read nor write the row, and an expired
   * license still stops a store serving.
   */
  const KNOWN_UNPROTECTED: Record<string, string> = {};

  const unprotected: string[] = [];
  const unforced: string[] = [];
  const policyless: string[] = [];
  let protectedCount = 0;

  for (const table of withTenantId) {
    if (table in DELIBERATELY_OPEN) continue;
    if (table in KNOWN_UNPROTECTED) continue;
    const row = byName.get(table);
    if (!row) continue;
    if (!row.relrowsecurity) unprotected.push(table);
    else if (!row.relforcerowsecurity) unforced.push(table);
    else if (!(policyFor.get(table) ?? []).length) policyless.push(table);
    else protectedCount += 1;
  }

  assert.deepEqual(
    unprotected,
    [],
    `these tables carry a tenantId with NO row-level security: ${unprotected.join(", ")}`,
  );
  // The recorded gaps are printed on every run, so they cannot quietly become permanent — and
  // the list may only shrink: a table that gains RLS must be removed from it.
  for (const [table, why] of Object.entries(KNOWN_UNPROTECTED)) {
    const row = byName.get(table);
    assert.ok(row, `KNOWN_UNPROTECTED names ${table}, which no longer exists — remove it`);
    assert.equal(
      row.relrowsecurity,
      false,
      `${table} now has RLS — remove it from KNOWN_UNPROTECTED so a regression can be seen`,
    );
    console.log(`  --  gap   ${table}: ${why}`);
  }
  assert.deepEqual(
    unforced,
    [],
    `RLS is enabled but not FORCED on: ${unforced.join(", ")} — policies would not apply to the ` +
      "table owner, which is what migrations connect as",
  );
  assert.deepEqual(
    policyless,
    [],
    `RLS is forced but no policy exists on: ${policyless.join(", ")} — which denies everything, ` +
      "so this is a broken table rather than a safe one",
  );
  assert.ok(protectedCount >= 20, `expected the tenant-scoped tables, found ${protectedCount}`);

  // And the platform-level tables must stay out, deliberately: putting the job's own run records
  // under a tenant policy would make them invisible to the job.
  for (const table of ["AnalyticsScheduledRun", "AnalyticsOperationalMetric"]) {
    assert.ok(!withTenantId.has(table), `${table} must not carry a tenantId`);
    assert.equal(
      byName.get(table)?.relrowsecurity,
      false,
      `${table} is platform-level and must not be under RLS`,
    );
  }
  ok(
    "P4-23a",
    `${protectedCount} tenant-scoped tables have FORCED RLS and a policy; ` +
      `${Object.keys(DELIBERATELY_OPEN).length} documented exception, ` +
      `${Object.keys(KNOWN_UNPROTECTED).length} recorded gaps, 2 platform tables excluded`,
  );
}

async function main() {
  timeZoneChecks();
  await aggregateChecks();
  await isolationCheck();
  await rlsConfigurationCheck();

  // Every store carries a zone already (Phase 1's Tenant.analyticsTimezone); this phase is
  // where it starts deciding anything. A store with a zone the runtime cannot resolve would
  // break its own reports, so the data is checked, not just the code.
  const zones = await prisma.tenant.findMany({
    select: { slug: true, analyticsTimezone: true },
  });
  const broken = zones.filter((t) => {
    try {
      localDayOf(new Date(), t.analyticsTimezone);
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(
    broken.map((t) => `${t.slug}: ${t.analyticsTimezone}`),
    [],
    "these stores have a reporting zone this runtime cannot resolve",
  );
  ok("P4-06", `all ${zones.length} store reporting zone(s) resolve on this runtime`);
}

async function shutdown() {
  await disconnectJobPrisma().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

// No process.exit(): see the note in scripts/verify-search.ts — on Windows it trips a libuv
// assertion while a pooled socket is still closing, after every check has already passed.
main()
  .then(async () => {
    await shutdown();
    console.log(`\n${checks} checks passed.`);
  })
  .catch(async (error) => {
    await shutdown();
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
