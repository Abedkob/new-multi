/**
 * What the stockroom actually costs, measured (`pnpm measure:stock`).
 *
 * Separate from `pnpm verify:stock` on purpose. That suite asserts correctness and must stay fast
 * enough to run constantly; this one builds a realistically large catalogue and a realistically
 * long ledger, times the operations somebody waits on, and prints the plans for the statements
 * that could degrade. It reports and judges against the written budgets — it does not assert, so a
 * decision about an index is made from a plan and a number rather than from a feeling.
 *
 *   pnpm measure:stock                                      # 2,000 products / 100,000 movements
 *   pnpm measure:stock --products=5000 --movements=500000    # bigger
 *
 * Two questions it exists to answer.
 *
 *  1. **Does the history screen survive a long ledger?** A movement is written for every sale,
 *     every cancellation, every till sale, every correction — a busy shop produces them faster
 *     than orders. 100,000 is roughly a year of a shop doing fifty movements a day with room to
 *     spare, and the screen pages through it ordered by `(createdAt desc, id desc)`.
 *  2. **Does the module cost a store that has it off anything?** The whole promise of the switch is
 *     that `stockEnabled = false` behaves exactly as before, so `placeOrder` is timed both ways and
 *     the difference is judged against 10%.
 *
 * The catalogue comes from scripts/fixtures/catalogue.ts, shared with `pnpm measure:counter`, so
 * "at 2,000 products" means the same rows in both sets of figures.
 *
 * **Not measured here:** the two page-render budgets (`/admin/stock` and `/admin/stock/history`
 * end to end). Those need a production build — `next dev` numbers measure the compiler — and this
 * machine cannot produce one, because `lib/env.ts` refuses to boot without five production
 * secrets this .env does not have. What is below is the database half of those pages, which is
 * where their cost is; the page figures belong in the VPS run before the pilot, beside the load
 * test. Said plainly rather than quietly skipped.
 */

import "dotenv/config";
import "./_owner";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner, setTenantStock } from "../lib/data/tenants";
import { placeOrder } from "../lib/data/orders";
import { recordStockReceipt, recordStocktake } from "../lib/data/stock-batches";
import {
  getStockAttention,
  listStockMovementsPage,
  searchStockVariants,
} from "../lib/data/stock-ledger";
import { MAX_STOCK_LINES } from "../lib/stock";
import {
  CATALOGUE_WORDS,
  analyzeTables,
  explain,
  percentile,
  seedCatalogue,
  time,
} from "./fixtures/catalogue";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const PRODUCTS = Number(arg("products") ?? 2000);
const VARIANTS_EACH = Number(arg("variants") ?? 3);
const MOVEMENTS = Number(arg("movements") ?? 100_000);
const ITERATIONS = Number(arg("iterations") ?? 25);

/** The budgets this phase committed to, in the plan. Reported against, never asserted. */
const BUDGETS = {
  attention: 800,
  history: 800,
  search: 300,
  receipt: 1000,
  orderOverhead: 10,
} as const;

const verdict = (p95: number, budget: number) =>
  `${p95 <= budget ? "within" : "OVER"} the ${budget}ms budget`;

const customer = {
  customerName: "Measure Shopper",
  customerPhone: "+1 555 010 0000",
  customerAddress: "1 Measure Street",
  deliveryLocation: "Front door",
  notes: "",
};

async function main() {
  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({
    storeName: `Measure Stock ${run}`,
    ownerName: "M",
    ownerEmail: `measure-stock-${run}@example.test`,
    passwordHash: "x",
  });
  const tenantId = store.tenant.id;
  const actor = { userId: store.user.id, name: "M" };
  // The platform switch. Without it every document below is refused by assertCanMove, which is
  // correct behaviour and exactly what the "module OFF" leg relies on further down.
  await setTenantStock(tenantId, store.user.id);

  try {
    console.log(
      `\nSeeding ${PRODUCTS} products x ${VARIANTS_EACH} variants and ${MOVEMENTS} movements...`,
    );
    const seedStarted = performance.now();
    const catalogue = await seedCatalogue(tenantId, run, {
      products: PRODUCTS,
      variantsEach: VARIANTS_EACH,
      sample: MAX_STOCK_LINES + 4,
    });

    // The ledger, spread over the catalogue and over time. `variantSeq` is derived from the series
    // so the (variantId, variantSeq) unique index is satisfied without a round trip per row, and
    // `balanceAfter` stays above zero to satisfy the CHECK. These rows are a shape to read, not a
    // history that reconciles — the invariant is `verify:stock`'s business, not this script's.
    // Every parameter is cast. Prisma sends them untyped, so `$1 * $2` is `unknown * unknown` and
    // Postgres refuses it outright ("operator is not unique") — and `g % $1` is the same problem
    // one step quieter. The stride is computed here rather than in SQL for the same reason.
    const seqStride = PRODUCTS * VARIANTS_EACH;
    await prisma.$executeRaw`
      INSERT INTO "StockMovement"
        ("id","tenantId","variantId","variantSeq","productNameSnapshot","variantAttributesSnapshot",
         "delta","balanceAfter","reason","note","actorNameSnapshot","createdAt")
      SELECT 'msm-' || ${run} || '-' || g,
             ${tenantId},
             'mv-' || ${run} || '-' || (1 + (g % ${PRODUCTS}::int)) || '-'
               || (1 + (g % ${VARIANTS_EACH}::int)),
             1 + (g / ${seqStride}::int),
             'Measured product',
             '{}'::jsonb,
             CASE WHEN g % 3 = 0 THEN 2 ELSE -1 END,
             100 + (g % 400),
             (ARRAY['SALE','RECEIPT','COUNT','ADJUST','COUNTER_SALE'])[1 + (g % 5)]::"StockMovementReason",
             '', 'Measure',
             now() - ((g % 8760) || ' hours')::interval
      FROM generate_series(1, ${MOVEMENTS}::int) AS g`;

    // ANALYZE before measuring anything — see the helper for the plan this prevents.
    await analyzeTables(["Product", "ProductVariant", "StockMovement", "StockBatch"]);
    console.log(
      `  seeded and analyzed in ${((performance.now() - seedStarted) / 1000).toFixed(1)}s`,
    );
    console.log(
      `  ${await prisma.stockMovement.count({ where: { tenantId } })} movements in the ledger\n`,
    );

    const sample = catalogue.sample;

    console.log("Reading (the two screens' database halves):");
    const attentionP95 = await time("getStockAttention", ITERATIONS, () =>
      getStockAttention(tenantId),
    );
    const historyP95 = await time("listStockMovementsPage p1", ITERATIONS, () =>
      listStockMovementsPage(tenantId, 1, {}, 25, true),
    );
    // Page 200 as well: `skip` grows linearly, and a budget met only on the first page is a budget
    // met only for somebody who never scrolls.
    const deepP95 = await time("listStockMovementsPage p200", ITERATIONS, () =>
      listStockMovementsPage(tenantId, 200, {}, 25, true),
    );
    const scopedP95 = await time("...scoped to one variant", ITERATIONS, (i) =>
      listStockMovementsPage(tenantId, 1, { variantId: sample[i % sample.length] }, 25, true),
    );
    const searchP95 = await time("searchStockVariants", ITERATIONS, (i) =>
      searchStockVariants(tenantId, CATALOGUE_WORDS[i % CATALOGUE_WORDS.length]),
    );

    console.log("\nWriting:");
    // A full document, which is the number that decides whether the 50-line cap is usable.
    const receiptLines = sample.slice(0, MAX_STOCK_LINES).map((variantId) => ({
      variantId,
      quantity: 2,
      unitCostCents: 450,
    }));
    const receiptP95 = await time(`receipt (${receiptLines.length} lines)`, ITERATIONS, (i) =>
      recordStockReceipt(tenantId, {
        submissionId: `measure-r-${run}-${i}`,
        reference: "DN-measure",
        actor,
        lines: receiptLines,
      }),
    );
    const countLines = sample.slice(0, MAX_STOCK_LINES).map((variantId) => ({
      variantId,
      counted: 400,
    }));
    await time(`stocktake (${countLines.length} lines)`, ITERATIONS, (i) =>
      recordStocktake(tenantId, {
        submissionId: `measure-c-${run}-${i}`,
        actor,
        lines: countLines,
      }),
    );

    // ---- what the module costs a store that has it off -------------------------------------
    //
    // **Interleaved, and with four times the runs.** Timing twenty-five orders with the module
    // off and then twenty-five with it on attributes every bit of drift in between — a vacuum, a
    // checkpoint, this laptop deciding to do something else — to the module. Alternating cancels
    // that, and `placeOrder` is 15ms, so the samples are cheap enough to take a hundred of.
    console.log("\nThe switch, both ways (one line, one order, alternating):");
    const orderLine = [{ variantId: sample[sample.length - 1], quantity: 1 }];
    const COMPARISON_RUNS = Number(arg("switch-runs") ?? 100);
    const offSamples: number[] = [];
    const onSamples: number[] = [];
    for (let i = 0; i < COMPARISON_RUNS; i++) {
      const off = i % 2 === 0;
      await setTenantStock(tenantId, off ? null : store.user.id);
      const started = performance.now();
      await placeOrder(tenantId, customer, orderLine);
      (off ? offSamples : onSamples).push(performance.now() - started);
    }
    await setTenantStock(tenantId, store.user.id);
    const offP95 = percentile(offSamples, 95);
    const onP95 = percentile(onSamples, 95);
    const offP50 = percentile(offSamples, 50);
    const onP50 = percentile(onSamples, 50);
    console.log(
      `  ${"placeOrder — module OFF".padEnd(30)} p50 ${offP50.toFixed(0).padStart(5)}ms   ` +
        `p95 ${offP95.toFixed(0).padStart(5)}ms   (${offSamples.length} runs)`,
    );
    console.log(
      `  ${"placeOrder — module ON".padEnd(30)} p50 ${onP50.toFixed(0).padStart(5)}ms   ` +
        `p95 ${onP95.toFixed(0).padStart(5)}ms   (${onSamples.length} runs)`,
    );
    const overhead = offP50 === 0 ? 0 : ((onP50 - offP50) / offP50) * 100;

    // ---- the plans worth reading ------------------------------------------------------------
    await explain(
      "the attention list (a column-to-column comparison, so no index can serve it)",
      prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN ANALYZE
        SELECT v."id", v."stock", COALESCE(p."lowStockThreshold", 3) AS "lowAt"
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."productId"
        WHERE p."tenantId" = ${tenantId}
          AND v."stock" <= COALESCE(p."lowStockThreshold", 3)
        ORDER BY v."stock" ASC, p."name" ASC, v."id" ASC
        LIMIT 40`,
    );

    await explain(
      "one page of the history (StockMovement_tenantId_createdAt_idx)",
      prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN ANALYZE
        SELECT * FROM "StockMovement"
        WHERE "tenantId" = ${tenantId}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 25 OFFSET 4975`,
    );

    await explain(
      "one variant's own history (the (variantId, variantSeq) unique index)",
      prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN ANALYZE
        SELECT * FROM "StockMovement"
        WHERE "tenantId" = ${tenantId} AND "variantId" = ${sample[0]}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 25`,
    );

    console.log("\nAgainst the budgets:");
    for (const [label, p95, budget] of [
      ["the overview's reads", attentionP95, BUDGETS.attention],
      ["the history, first page", historyP95, BUDGETS.history],
      ["the history, page 200", deepP95, BUDGETS.history],
      ["one variant's history", scopedP95, BUDGETS.history],
      ["the picker's search", searchP95, BUDGETS.search],
      [`a ${MAX_STOCK_LINES}-line receipt`, receiptP95, BUDGETS.receipt],
    ] as const) {
      console.log(`  ${label.padEnd(30)} p95 ${p95.toFixed(0).padStart(5)}ms   ${verdict(p95, budget)}`);
    }
    console.log(
      `  ${"the module's cost to a sale".padEnd(30)} ` +
        `${overhead >= 0 ? "+" : ""}${overhead.toFixed(1)}%   ` +
        `${Math.abs(overhead) <= BUDGETS.orderOverhead ? "within" : "OVER"} the ` +
        `${BUDGETS.orderOverhead}% budget ` +
        `(p50 off ${offP50.toFixed(1)}ms, on ${onP50.toFixed(1)}ms, ` +
        `${(onP50 - offP50).toFixed(1)}ms absolute)`,
    );
    // Said plainly, because the first version of this script hid it. Timing twenty-five orders
    // with the module off and then twenty-five with it on put the figure at 15ms vs 17ms — within
    // budget, and wrong: the "off" block had run before everything else had warmed the cache, so
    // drift was cancelling the real cost. Alternating the two configurations showed the cost is
    // real, which is also what made cutting a round trip (one `DISTINCT ON` instead of a mark
    // query and a balance query) worth doing. It is still over the percentage budget.
    console.log(
      `    The percentage budget is exceeded and the absolute cost is ` +
        `${(onP50 - offP50).toFixed(1)}ms per order, for the three statements that write the ` +
        `movement. The budget's 10% was written against an unknown baseline; at ${offP50.toFixed(1)}ms ` +
        `it allows ${(offP50 * 0.1).toFixed(1)}ms, which no round trip fits inside. Whether that ` +
        `trade is worth making is a decision, not a measurement — recorded here either way.`,
    );
    console.log(
      `    A store with the module OFF has no baseline to be compared against: it IS the ` +
        `baseline. What it pays is one extra column on a SELECT placeOrder already runs, and ` +
        `verify:stock holds that down statically (no separate read on the checkout path).`,
    );
    console.log(
      `\n  Product.name still has no text index. The picker's unanchored ILIKE measured ` +
        `${searchP95.toFixed(0)}ms p95 at ${PRODUCTS} products; the written trigger for adding ` +
        `pg_trgm is 150ms, ${searchP95 < 150 ? "NOT reached" : "REACHED"}.`,
    );
  } finally {
    // One cascade takes the catalogue, the ledger, the documents and the orders with it.
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { id: store.user.id } });
    console.log("\nFixtures removed.");
  }
}

main()
  .catch((error) => {
    console.error("\nMEASUREMENT FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
