/**
 * In-store counter sales (`pnpm verify:counter`).
 *
 * The till takes money and moves stock, so the assertions here are about the four things that
 * would cost a merchant real money if they were wrong:
 *
 *   1. A sale is recorded ONCE, however many times the cashier taps or the network retries.
 *   2. Stock moves exactly once in each direction, and a shortfall writes nothing at all.
 *   3. A receipt still says what was sold after the catalogue has moved on.
 *   4. A store can never see or write another store's sales.
 *
 * Plus the two rules that exist because a person at a till is not the owner: the manual-discount
 * ceiling, and the feature switch — which is checked in the data layer, because a server action is
 * its own HTTP endpoint and the page's guard does not protect it.
 *
 * Runs as the owner (scripts/_owner) so fixtures can be built across stores. That makes RLS inert
 * here, which is exactly why the cross-tenant checks run in a SUBPROCESS as app_user instead.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner, setTenantCounterSales } from "../lib/data/tenants";
import { createProduct, updateProduct } from "../lib/data/products";
import { placeOrder } from "../lib/data/orders";
import { recomputeDays } from "../lib/analytics/aggregate";
import { localDayOf } from "../lib/analytics/local-day";
import { runScheduled } from "../lib/analytics/scheduled";
import { newOrderCatchUp } from "../lib/notifications/stages";
import {
  CounterSaleError,
  counterSaleFingerprint,
  getCounterSale,
  getCounterTakings,
  listCounterSalesPage,
  recordCounterSale,
  searchTillItems,
  voidCounterSale,
} from "../lib/data/counter-sales";
import { maxManualDiscountCents, STAFF_MAX_MANUAL_DISCOUNT_PERCENT } from "../lib/counter-sales";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const productInput = {
  description: "d",
  imageUrl: "",
  images: [],
  isBestSeller: false,
  categoryId: null,
};

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The till's own view of a variant's stock, without going through the catalogue reader. */
async function stockOf(variantId: string) {
  const row = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { stock: true },
  });
  return row?.stock ?? -1;
}

async function expectError(code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof CounterSaleError) {
      assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

async function main() {
  const run = Date.now().toString(36);
  const a = await createStoreWithOwner({
    storeName: `Till A ${run}`,
    ownerName: "A",
    ownerEmail: `till-a-${run}@example.test`,
    passwordHash: "x",
  });
  const b = await createStoreWithOwner({
    storeName: `Till B ${run}`,
    ownerName: "B",
    ownerEmail: `till-b-${run}@example.test`,
    passwordHash: "x",
  });
  const A = a.tenant.id;
  const B = b.tenant.id;
  const seller = { soldByUserId: a.user.id, soldByName: "Sam", role: "STORE_OWNER" as const };

  try {
    // ---------------------------------------------------------------------------------------
    // The switch
    // ---------------------------------------------------------------------------------------
    const p1 = await createProduct(A, {
      name: "Mug",
      basePriceCents: 1200,
      ...productInput,
      variants: [{ attributes: {}, stock: 10, priceCentsOverride: null, imageUrl: null }],
    });
    const v1 = p1.variants[0].id;

    console.log("The feature switch gates the writer, not just the screen:");
    await check("a store with the till off cannot record a sale", async () => {
      await expectError("FEATURE_OFF", () =>
        recordCounterSale(A, {
          submissionId: uuid(),
          payment: "CASH",
          lines: [{ variantId: v1, quantity: 1 }],
          ...seller,
        }),
      );
      assert.equal(await stockOf(v1), 10, "a refused sale must not touch stock");
      assert.equal(await prisma.counterSale.count({ where: { tenantId: A } }), 0);
    });

    await setTenantCounterSales(A, a.user.id);
    await setTenantCounterSales(B, b.user.id);

    await check("enabling stamps a first-enabled date, and disabling leaves it", async () => {
      const enabled = await prisma.tenant.findUniqueOrThrow({
        where: { id: A },
        select: { counterSalesEnabled: true, counterSalesFirstEnabledAt: true },
      });
      assert.equal(enabled.counterSalesEnabled, true);
      assert.ok(enabled.counterSalesFirstEnabledAt, "the first-enabled date must be stamped");

      await setTenantCounterSales(A, null);
      const off = await prisma.tenant.findUniqueOrThrow({
        where: { id: A },
        select: { counterSalesEnabled: true, counterSalesFirstEnabledAt: true },
      });
      assert.equal(off.counterSalesEnabled, false, "disabling must stop new sales");
      assert.deepEqual(
        off.counterSalesFirstEnabledAt,
        enabled.counterSalesFirstEnabledAt,
        "disabling must NOT clear the first-enabled date, or a store loses sight of its own history",
      );

      // Re-enabling keeps the original date rather than restamping it.
      await setTenantCounterSales(A, a.user.id);
      const again = await prisma.tenant.findUniqueOrThrow({
        where: { id: A },
        select: { counterSalesFirstEnabledAt: true },
      });
      assert.deepEqual(again.counterSalesFirstEnabledAt, enabled.counterSalesFirstEnabledAt);
    });

    // ---------------------------------------------------------------------------------------
    // Stock
    // ---------------------------------------------------------------------------------------
    console.log("\nStock moves exactly once, in each direction:");
    let firstSaleId = "";
    await check("a sale deducts what it sold", async () => {
      const sale = await recordCounterSale(A, {
        submissionId: uuid(),
        payment: "CASH",
        lines: [{ variantId: v1, quantity: 3 }],
        ...seller,
      });
      firstSaleId = sale.id;
      assert.equal(sale.idempotent, false);
      assert.equal(sale.totalCents, 3600, "3 x 1200");
      assert.equal(await stockOf(v1), 7);
    });

    await check("a shortfall writes nothing and reports what is left", async () => {
      const before = await prisma.counterSale.count({ where: { tenantId: A } });
      const error = await expectError("STOCK", () =>
        recordCounterSale(A, {
          submissionId: uuid(),
          payment: "CASH",
          lines: [{ variantId: v1, quantity: 99 }],
          ...seller,
        }),
      );
      assert.equal(error.detail?.available, 7, "the error must carry the live figure");
      assert.equal(await stockOf(v1), 7, "a refused sale must not take stock");
      assert.equal(await prisma.counterSale.count({ where: { tenantId: A } }), before);
    });

    await check("a multi-line sale is all or nothing", async () => {
      const p2 = await createProduct(A, {
        name: "Plate",
        basePriceCents: 500,
        ...productInput,
        variants: [{ attributes: {}, stock: 1, priceCentsOverride: null, imageUrl: null }],
      });
      const v2 = p2.variants[0].id;
      await expectError("STOCK", () =>
        recordCounterSale(A, {
          submissionId: uuid(),
          payment: "CASH",
          lines: [
            { variantId: v1, quantity: 2 },
            { variantId: v2, quantity: 5 },
          ],
          ...seller,
        }),
      );
      assert.equal(await stockOf(v1), 7, "the line that succeeded must roll back with the one that failed");
      assert.equal(await stockOf(v2), 1);
    });

    // ---------------------------------------------------------------------------------------
    // Idempotency
    // ---------------------------------------------------------------------------------------
    console.log("\nOne submission, one sale:");
    await check("retrying the same submission returns the same sale", async () => {
      const submissionId = uuid();
      const lines = [{ variantId: v1, quantity: 1 }];
      const first = await recordCounterSale(A, { submissionId, payment: "CASH", lines, ...seller });
      const stockAfterFirst = await stockOf(v1);
      const second = await recordCounterSale(A, { submissionId, payment: "CASH", lines, ...seller });
      assert.equal(second.id, first.id, "a retry must not create a second sale");
      assert.equal(second.idempotent, true, "and must say so");
      assert.equal(second.totalCents, first.totalCents);
      assert.equal(await stockOf(v1), stockAfterFirst, "a retry must not deduct stock twice");
    });

    await check("two concurrent submissions of the same cart produce one sale", async () => {
      const submissionId = uuid();
      const lines = [{ variantId: v1, quantity: 1 }];
      const before = await stockOf(v1);
      const results = await Promise.all([
        recordCounterSale(A, { submissionId, payment: "CASH", lines, ...seller }),
        recordCounterSale(A, { submissionId, payment: "CASH", lines, ...seller }),
      ]);
      assert.equal(results[0].id, results[1].id, "both callers must end up with the same sale");
      assert.equal(
        await prisma.counterSale.count({ where: { tenantId: A, submissionId } }),
        1,
        "the unique index is the mechanism: exactly one row",
      );
      assert.equal(await stockOf(v1), before - 1, "and stock moved once, not twice");
    });

    await check("the same id with different items is refused, not answered", async () => {
      const submissionId = uuid();
      await recordCounterSale(A, {
        submissionId,
        payment: "CASH",
        lines: [{ variantId: v1, quantity: 1 }],
        ...seller,
      });
      const before = await stockOf(v1);
      await expectError("SUBMISSION_REUSED", () =>
        recordCounterSale(A, {
          submissionId,
          payment: "CASH",
          lines: [{ variantId: v1, quantity: 2 }],
          ...seller,
        }),
      );
      assert.equal(await stockOf(v1), before, "a refused reuse must not take stock");
    });

    await check("a cart's fingerprint does not depend on line order", async () => {
      const left = counterSaleFingerprint({
        payment: "CASH",
        lines: [
          { variantId: "v-b", quantity: 2 },
          { variantId: "v-a", quantity: 1 },
        ],
      });
      const right = counterSaleFingerprint({
        payment: "CASH",
        lines: [
          { variantId: "v-a", quantity: 1 },
          { variantId: "v-b", quantity: 2 },
        ],
      });
      assert.equal(left, right);
      assert.notEqual(
        left,
        counterSaleFingerprint({ payment: "CARD", lines: [{ variantId: "v-a", quantity: 1 }] }),
      );
    });

    // ---------------------------------------------------------------------------------------
    // Voiding
    // ---------------------------------------------------------------------------------------
    console.log("\nA void returns stock once, and says what it could not return:");
    await check("voiding restores stock and is final", async () => {
      const before = await stockOf(v1);
      const result = await voidCounterSale(A, firstSaleId, {
        reason: "rang up twice",
        voidedByUserId: a.user.id,
      });
      assert.equal(result.restoredLines, 1);
      assert.equal(result.totalLines, 1);
      assert.equal(await stockOf(v1), before + 3, "the three units come back");
      await expectError("ALREADY_VOIDED", () =>
        voidCounterSale(A, firstSaleId, { reason: "again", voidedByUserId: a.user.id }),
      );
      assert.equal(await stockOf(v1), before + 3, "a second void must not restore again");
    });

    await check("two concurrent voids restore stock once", async () => {
      const sale = await recordCounterSale(A, {
        submissionId: uuid(),
        payment: "CARD",
        lines: [{ variantId: v1, quantity: 2 }],
        ...seller,
      });
      const before = await stockOf(v1);
      const results = await Promise.allSettled([
        voidCounterSale(A, sale.id, { reason: "double", voidedByUserId: a.user.id }),
        voidCounterSale(A, sale.id, { reason: "double", voidedByUserId: a.user.id }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      assert.equal(ok.length, 1, `exactly one void may win, got ${ok.length}`);
      assert.equal(await stockOf(v1), before + 2, "stock came back once");
    });

    await check("a void reports a line whose variant is gone", async () => {
      const p3 = await createProduct(A, {
        name: "Bowl",
        basePriceCents: 800,
        ...productInput,
        variants: [
          { attributes: { Size: "S" }, stock: 5, priceCentsOverride: null, imageUrl: null },
          { attributes: { Size: "L" }, stock: 5, priceCentsOverride: null, imageUrl: null },
        ],
      });
      const [small, large] = p3.variants;
      const sale = await recordCounterSale(A, {
        submissionId: uuid(),
        payment: "CASH",
        lines: [
          { variantId: small.id, quantity: 1 },
          { variantId: large.id, quantity: 1 },
        ],
        ...seller,
      });
      // Remove one variant from the product, the way an owner editing the form does. The sale's
      // line keeps its snapshot and loses its link.
      await updateProduct(A, p3.id, {
        name: "Bowl",
        basePriceCents: 800,
        ...productInput,
        variants: [
          { id: large.id, attributes: { Size: "L" }, stock: 4, priceCentsOverride: null, imageUrl: null },
        ],
      });
      const result = await voidCounterSale(A, sale.id, {
        reason: "customer changed their mind",
        voidedByUserId: a.user.id,
      });
      assert.equal(result.totalLines, 2);
      assert.equal(result.restoredLines, 1, "only the surviving line can be restored");
      const stored = await getCounterSale(A, sale.id);
      assert.equal(
        stored?.voidRestoredLines,
        1,
        "the count is recorded, so a later read cannot draw the opposite conclusion",
      );
    });

    // ---------------------------------------------------------------------------------------
    // Snapshots
    // ---------------------------------------------------------------------------------------
    console.log("\nA receipt outlives the catalogue:");
    await check("renaming, repricing and deleting leave the sale untouched", async () => {
      const product = await createProduct(A, {
        name: "Original name",
        basePriceCents: 2500,
        ...productInput,
        variants: [{ attributes: { Color: "Red" }, stock: 4, priceCentsOverride: null, imageUrl: null }],
      });
      const variantId = product.variants[0].id;
      const sale = await recordCounterSale(A, {
        submissionId: uuid(),
        payment: "CARD",
        lines: [{ variantId, quantity: 1 }],
        ...seller,
      });

      await updateProduct(A, product.id, {
        name: "Renamed later",
        basePriceCents: 9900,
        ...productInput,
        variants: [{ attributes: { Color: "Blue" }, stock: 1, priceCentsOverride: null, imageUrl: null }],
      });

      const stored = await getCounterSale(A, sale.id);
      const line = stored!.items[0];
      assert.equal(line.productNameSnapshot, "Original name");
      assert.deepEqual(line.variantAttributesSnapshot, { Color: "Red" });
      assert.equal(line.regularPriceCentsSnapshot, 2500);
      assert.equal(line.priceCentsSnapshot, 2500);
      assert.equal(line.variantId, null, "the link is gone, the record is not");
    });

    // ---------------------------------------------------------------------------------------
    // Manual discounts
    // ---------------------------------------------------------------------------------------
    console.log("\nA reduction at the till is bounded and explained:");
    await check("staff are capped and the owner is not", async () => {
      assert.equal(maxManualDiscountCents("STAFF", 1000), 200, `${STAFF_MAX_MANUAL_DISCOUNT_PERCENT}% of 1000`);
      assert.equal(maxManualDiscountCents("STORE_OWNER", 1000), 1000);
      assert.equal(maxManualDiscountCents("STAFF", 0), 0);
      // Rounded down, so the stated percentage is a true ceiling.
      assert.equal(maxManualDiscountCents("STAFF", 999), 199);
    });

    await check("a staff member cannot exceed the ceiling", async () => {
      const before = await stockOf(v1);
      await expectError("DISCOUNT_REFUSED", () =>
        recordCounterSale(A, {
          submissionId: uuid(),
          payment: "CASH",
          lines: [{ variantId: v1, quantity: 1, manualDiscountCents: 500, manualDiscountReason: "friend" }],
          soldByUserId: a.user.id,
          soldByName: "Staff",
          role: "STAFF",
        }),
      );
      assert.equal(await stockOf(v1), before, "a refused discount must not take stock");
    });

    await check("a reduction without a reason is refused", async () => {
      await expectError("DISCOUNT_REFUSED", () =>
        recordCounterSale(A, {
          submissionId: uuid(),
          payment: "CASH",
          lines: [{ variantId: v1, quantity: 1, manualDiscountCents: 100 }],
          ...seller,
        }),
      );
    });

    await check("an allowed reduction is recorded with its reason and arithmetic", async () => {
      const sale = await recordCounterSale(A, {
        submissionId: uuid(),
        payment: "CASH",
        lines: [
          { variantId: v1, quantity: 2, manualDiscountCents: 200, manualDiscountReason: "chipped" },
        ],
        soldByUserId: a.user.id,
        soldByName: "Staff",
        role: "STAFF",
      });
      const stored = await getCounterSale(A, sale.id);
      const line = stored!.items[0];
      assert.equal(line.regularPriceCentsSnapshot, 1200);
      assert.equal(line.manualDiscountCentsSnapshot, 200);
      assert.equal(line.manualDiscountReason, "chipped");
      assert.equal(line.priceCentsSnapshot, 1000, "regular - automatic - manual");
      assert.equal(sale.totalCents, 2000, "2 x 1000");
    });

    await check("Postgres refuses an unexplained reduction, not just the application", async () => {
      const sale = await prisma.counterSale.findFirstOrThrow({
        where: { tenantId: A },
        select: { id: true },
      });
      await assert.rejects(
        prisma.$executeRaw`
          INSERT INTO "CounterSaleItem"
            ("id","tenantId","counterSaleId","productNameSnapshot",
             "regularPriceCentsSnapshot","manualDiscountCentsSnapshot","priceCentsSnapshot","quantity")
          VALUES (${`probe-${run}-1`}, ${A}, ${sale.id}, 'probe', 500, 100, 400, 1)`,
        /manual_discount_explained/,
        "a manual discount with no reason must be refused by the database",
      );
    });

    await check("Postgres refuses a price that is not derived from the snapshots", async () => {
      const sale = await prisma.counterSale.findFirstOrThrow({
        where: { tenantId: A },
        select: { id: true },
      });
      await assert.rejects(
        prisma.$executeRaw`
          INSERT INTO "CounterSaleItem"
            ("id","tenantId","counterSaleId","productNameSnapshot",
             "regularPriceCentsSnapshot","priceCentsSnapshot","quantity")
          VALUES (${`probe-${run}-2`}, ${A}, ${sale.id}, 'probe', 500, 450, 1)`,
        /price_is_derived/,
        "a charged price must equal regular minus the named reductions",
      );
    });

    await check("Postgres refuses an inconsistent void", async () => {
      await assert.rejects(
        prisma.$executeRaw`
          UPDATE "CounterSale" SET status = 'VOIDED', "voidedAt" = NULL, "voidReason" = NULL
          WHERE "tenantId" = ${A}`,
        /void_consistent/,
        "the void trio is held together by the database, not by a convention",
      );
    });

    // ---------------------------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------------------------
    console.log("\nThe readers agree with the rows:");
    await check("takings split cash from card and exclude voided sales", async () => {
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const takings = await getCounterTakings(A, { from, to });
      const live = await prisma.counterSale.findMany({
        where: { tenantId: A, status: "RECORDED" },
        select: { payment: true, items: { select: { priceCentsSnapshot: true, quantity: true } } },
      });
      const expected = (payment: string) =>
        live
          .filter((s) => s.payment === payment)
          .reduce(
            (sum, s) => sum + s.items.reduce((n, i) => n + i.priceCentsSnapshot * i.quantity, 0),
            0,
          );
      assert.equal(takings.saleCount, live.length);
      assert.equal(takings.cashCents, expected("CASH"));
      assert.equal(takings.cardCents, expected("CARD"));
      assert.equal(takings.totalCents, expected("CASH") + expected("CARD"));
      assert.equal(
        takings.voidedSales,
        await prisma.counterSale.count({ where: { tenantId: A, status: "VOIDED" } }),
      );
    });

    await check("the history list paginates and counts by status", async () => {
      const page = await listCounterSalesPage(A, 1, undefined, 25);
      assert.equal(page.page, 1);
      assert.ok(page.total > 0);
      assert.equal(
        page.counts.reduce((sum, row) => sum + row._count._all, 0),
        page.total,
        "the status tabs must add up to the unfiltered total",
      );
      const voided = await listCounterSalesPage(A, 1, "VOIDED", 25);
      assert.ok(voided.items.every((s) => s.status === "VOIDED"));
    });

    await check("the till search prices a variant the way the writer does", async () => {
      const items = await searchTillItems(A, "Mug", 20);
      const mug = items.find((i) => i.variantId === v1);
      assert.ok(mug, "the search must find the product by name");
      assert.equal(mug.regularPriceCents, 1200);
      assert.equal(mug.finalPriceCents, 1200);
      assert.equal(mug.productName, "Mug");
      assert.ok(items.length <= 20, "results are bounded");
      assert.equal((await searchTillItems(A, "nothing-matches-this", 20)).length, 0);
    });

    // ---------------------------------------------------------------------------------------
    // Separation from web analytics — the assertions this whole design exists for
    // ---------------------------------------------------------------------------------------
    console.log("\nThe till never touches the web figures:");
    await check("a counter sale moves no web aggregate, and a web order moves them exactly", async () => {
      const product = await createProduct(A, {
        name: "Separation Mug",
        basePriceCents: 1000,
        ...productInput,
        variants: [{ attributes: {}, stock: 50, priceCentsOverride: null, imageUrl: null }],
      });
      const variantId = product.variants[0].id;
      const zone = (
        await prisma.tenant.findUniqueOrThrow({ where: { id: A }, select: { analyticsTimezone: true } })
      ).analyticsTimezone;
      const today = localDayOf(new Date(), zone);
      const agg = { id: A, analyticsTimezone: zone };

      // Baseline: whatever today looks like before either sale exists.
      await recomputeDays(agg, [today]);
      const before = await prisma.analyticsDailyMetric.findUnique({
        where: { tenantId_localDay: { tenantId: A, localDay: new Date(`${today}T00:00:00.000Z`) } },
        select: { orders: true, orderValueCents: true, sessions: true },
      });
      const base = {
        orders: before?.orders ?? 0,
        orderValueCents: before?.orderValueCents ?? 0,
        sessions: before?.sessions ?? 0,
      };

      // A counter sale FIRST, so if it leaked it would already be in the figures below.
      await recordCounterSale(A, {
        submissionId: uuid(),
        payment: "CASH",
        lines: [{ variantId, quantity: 4 }],
        ...seller,
      });
      await recomputeDays(agg, [today]);
      const afterTill = await prisma.analyticsDailyMetric.findUnique({
        where: { tenantId_localDay: { tenantId: A, localDay: new Date(`${today}T00:00:00.000Z`) } },
        select: { orders: true, orderValueCents: true, sessions: true },
      });
      assert.equal(afterTill?.orders ?? 0, base.orders, "a counter sale must not be a website order");
      assert.equal(
        afterTill?.orderValueCents ?? 0,
        base.orderValueCents,
        "nor website revenue — 4,000 cents of in-store money must be absent from this column",
      );
      assert.equal(afterTill?.sessions ?? 0, base.sessions, "and it is not a session");

      // Now a web order on the same day, and the figures must move by EXACTLY its amount.
      await placeOrder(
        A,
        {
          customerName: "Web Shopper",
          customerPhone: "+961 70 000 030",
          customerAddress: "1 Web Street",
          deliveryLocation: "Test location",
          notes: "",
        },
        [{ variantId, quantity: 2 }],
        { expectedDeliveryFeeCents: 0 },
      );
      await recomputeDays(agg, [today]);
      const afterWeb = await prisma.analyticsDailyMetric.findUniqueOrThrow({
        where: { tenantId_localDay: { tenantId: A, localDay: new Date(`${today}T00:00:00.000Z`) } },
        select: { orders: true, orderValueCents: true },
      });
      assert.equal(afterWeb.orders, base.orders + 1, "exactly one more website order");
      assert.equal(
        afterWeb.orderValueCents,
        base.orderValueCents + 2000,
        "and exactly its 2,000 cents. If this is 6,000 the till has been folded into web revenue, " +
          "which is the refactor this assertion exists to catch.",
      );
    });

    await check("the new-order notification sweep ignores a counter sale", async () => {
      // notificationLinks: { none: {} } announces ANY order with no link, so an Order-shaped
      // counter sale would have pushed "you have a new order" for a sale the staff member just
      // rang up in front of the customer. CounterSale has no such relation, which is why.
      // In a dry run `items` is the number of STORES the sweep would announce for, not the
      // number of orders — one notification per store claims that store's backlog. So the
      // expectation is the set of stores with an announceable ORDER, derived from the table
      // rather than written as a number: this suite has placed a real web order by now, and
      // the dev database may hold others, so a hard-coded 0 would only have proved the test ran
      // before any of them existed.
      const window = { gte: new Date(Date.now() - 30 * 60_000) };
      const announceable = await prisma.order.findMany({
        where: { status: { not: "CANCELLED" }, notificationLinks: { none: {} }, createdAt: window },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      const storeIds = announceable.map((row) => row.tenantId);

      // Store B is the control: counter sales and no orders at all. If a sale ever became an
      // Order row, B would appear in the list above and the count below would be one higher.
      const bProduct = await createProduct(B, {
        name: "Control Mug",
        basePriceCents: 900,
        ...productInput,
        variants: [{ attributes: {}, stock: 5, priceCentsOverride: null, imageUrl: null }],
      });
      await recordCounterSale(B, {
        submissionId: uuid(),
        payment: "CARD",
        lines: [{ variantId: bProduct.variants[0].id, quantity: 1 }],
        soldByUserId: b.user.id,
        soldByName: "B",
        role: "STORE_OWNER",
      });
      assert.ok(
        (await prisma.counterSale.count({ where: { tenantId: B } })) > 0,
        "the control store needs a counter sale for this check to mean anything",
      );
      assert.equal(
        await prisma.order.count({ where: { tenantId: B } }),
        0,
        "the control store must have no orders, or it would legitimately be announced",
      );
      assert.ok(!storeIds.includes(B), "a store with only counter sales must not be announceable");

      const report = await runScheduled([newOrderCatchUp], { log: () => {}, dryRun: true });
      const stage = report.stages[0];
      assert.equal(stage?.status, "OK", JSON.stringify(report));
      assert.equal(
        stage.items,
        storeIds.length,
        `the sweep would announce for ${stage.items} store(s) but only ${storeIds.length} have a ` +
          `pending web order. A counter sale is not an Order and can never appear here — a higher ` +
          `number means something has started writing sales into the Order table.`,
      );
    });

    // ---------------------------------------------------------------------------------------
    // One stock primitive
    // ---------------------------------------------------------------------------------------
    console.log("\nStock is moved in exactly one place:");
    await check("only lib/data/stock.ts holds a conditional decrement", async () => {
      // Two writers now take stock off the shelf. The `stock >= qty` guard is the entire reason
      // the system cannot oversell, so a second copy of it is the thing worth forbidding — a
      // reviewer should have to delete this check to add one.
      for (const [label, pattern] of [
        ["a conditional decrement", "stock: { decrement"],
        ["a stock floor guard", "stock: { gte"],
        ["a stock increment", "stock: { increment"],
      ] as const) {
        const files = gitGrepFiles(pattern).filter((f) => f.endsWith(".ts") && !f.startsWith("scripts/"));
        assert.deepEqual(
          files,
          ["lib/data/stock.ts"],
          `${label} must exist only in lib/data/stock.ts, found: ${files.join(", ") || "nowhere"}`,
        );
      }
      // And the deadlock-avoidance sort travels with the primitive rather than with its callers.
      assert.match(
        readFileSync("lib/data/stock.ts", "utf8"),
        /\[\.\.\.wanted\.keys\(\)\]\.sort\(\)/,
        "the id sort belongs inside the primitive: it is not a rule a second caller should have to remember",
      );
    });

    // ---------------------------------------------------------------------------------------
    // Isolation, as the restricted role
    // ---------------------------------------------------------------------------------------
    console.log("\nAnother store's till is unreachable (as app_user, in a subprocess):");
    await check("store B can neither read, write, nor attach to store A's sales", async () => {
      const ownerUrl = process.env.DATABASE_URL;
      assert.ok(ownerUrl, "DATABASE_URL is needed to read the restricted role's URL from .env");
      const appUrl = parseEnvFile(readFileSync(".env", "utf8")).APP_DATABASE_URL;
      assert.ok(
        appUrl && new URL(appUrl).username !== new URL(ownerUrl).username,
        "APP_DATABASE_URL must point at a restricted role for this check to mean anything",
      );

      const saleOfA = await prisma.counterSale.findFirstOrThrow({
        where: { tenantId: A },
        select: { id: true },
      });
      const child = spawnSync(
        `npx tsx scripts/fixtures/counter-cross-tenant.ts ${B} ${A} ${saleOfA.id}`,
        { shell: true, encoding: "utf8", env: { ...process.env, APP_DATABASE_URL: appUrl } },
      );
      const line = (child.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "{}";
      const result = JSON.parse(line) as {
        role?: { current_user: string; rolsuper: boolean; rolbypassrls: boolean };
        probes?: { name: string; leakedRows?: number; refused: boolean; error: string }[];
        threw?: string;
      };
      assert.ok(!result.threw, `the fixture failed: ${result.threw} ${child.stderr}`);
      assert.ok(result.role, `the fixture reported no role: ${line}`);
      assert.equal(result.role.rolsuper, false, "the fixture must not run as a superuser");
      assert.equal(result.role.rolbypassrls, false, "and must not bypass RLS");

      const byName = new Map((result.probes ?? []).map((p) => [p.name, p]));
      assert.equal(byName.get("read")?.leakedRows, 0, "another store's sales were readable");
      assert.equal(byName.get("write-sale")?.refused, true, "a sale for another store was WRITTEN");
      assert.match(
        byName.get("write-sale")?.error ?? "",
        /row-level security|violates/i,
        `refused for the wrong reason (${byName.get("write-sale")?.error})`,
      );
      assert.equal(
        byName.get("foreign-parent")?.refused,
        true,
        "a line was attached to another store's sale",
      );
    });

    console.log(`\nAll ${passed} counter-sale checks passed.`);
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  }
}

/** Tracked files containing a literal, the way verify:aggregates' P4-22 grep works. */
function gitGrepFiles(needle: string): string[] {
  try {
    // --untracked, so a new file counts: a second decrement written today should fail this check
    // today, not first become visible once someone commits it.
    return execFileSync("git", ["grep", "-l", "-F", "--untracked", needle, "--", "*.ts"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

/** Minimal .env reader, matching the one verify:aggregates uses for the same purpose. */
function parseEnvFile(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

main()
  .catch((error) => {
    console.error("\nCOUNTER SALE CHECK FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
