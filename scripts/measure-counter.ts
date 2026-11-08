/**
 * What the till actually costs, measured (`pnpm measure:counter`).
 *
 * Separate from `pnpm verify:counter` on purpose. That suite asserts correctness and must stay
 * fast enough to run constantly; this one builds a realistically large catalogue, times the four
 * operations a cashier and an owner wait on, and prints the query plans for the two statements
 * that could degrade. It asserts nothing — it reports, so a decision about an index is made from
 * a plan and a number rather than from a feeling.
 *
 *   pnpm measure:counter                                 # 2,000 products / 6,000 variants
 *   pnpm measure:counter --products=5000 --sales=2000    # bigger
 *
 * The question it exists to answer: `Product.name` has no text index in this schema (no pg_trgm,
 * no tsvector), and the till searches it with an unanchored ILIKE, which no btree can serve. The
 * trigger for adding the extension is written down rather than guessed: search p95 above 150ms at
 * a realistic catalogue. Below that, the index is not worth a new Postgres extension.
 *
 * Fixtures are bulk-inserted with generate_series rather than through createProduct: 2,000
 * transactions would make the setup longer than the measurement, and nothing here is testing the
 * product writer.
 */

import "dotenv/config";
import "./_owner";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner, setTenantCounterSales } from "../lib/data/tenants";
import {
  getCounterTakings,
  listCounterSalesPage,
  recordCounterSale,
  searchTillItems,
} from "../lib/data/counter-sales";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const PRODUCTS = Number(arg("products") ?? 2000);
const VARIANTS_EACH = Number(arg("variants") ?? 3);
const SALES = Number(arg("sales") ?? 500);
const ITERATIONS = Number(arg("iterations") ?? 25);

/** The words the fixture's product names are built from, so a search term matches a real subset. */
const WORDS = ["mug", "plate", "bowl", "shirt", "scarf", "lamp", "vase", "chair", "towel", "candle"];

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function time(label: string, iterations: number, fn: (i: number) => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    await fn(i);
    samples.push(performance.now() - started);
  }
  const row = {
    operation: label,
    runs: iterations,
    p50: `${percentile(samples, 50).toFixed(0)}ms`,
    p95: `${percentile(samples, 95).toFixed(0)}ms`,
    max: `${Math.max(...samples).toFixed(0)}ms`,
  };
  console.log(
    `  ${row.operation.padEnd(26)} p50 ${row.p50.padStart(7)}   p95 ${row.p95.padStart(7)}   max ${row.max.padStart(7)}   (${row.runs} runs)`,
  );
  return percentile(samples, 95);
}

async function main() {
  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({
    storeName: `Measure Till ${run}`,
    ownerName: "M",
    ownerEmail: `measure-till-${run}@example.test`,
    passwordHash: "x",
  });
  const tenantId = store.tenant.id;
  await setTenantCounterSales(tenantId, store.user.id);

  try {
    console.log(
      `\nSeeding ${PRODUCTS} products x ${VARIANTS_EACH} variants and ${SALES} sales...`,
    );
    const seedStarted = performance.now();

    await prisma.$executeRaw`
      INSERT INTO "Product" ("id","tenantId","name","description","basePriceCents","imageUrl","slug","isBestSeller","createdAt","updatedAt")
      SELECT 'mp-' || ${run} || '-' || g, ${tenantId},
             (ARRAY['Mug','Plate','Bowl','Shirt','Scarf','Lamp','Vase','Chair','Towel','Candle'])[1 + (g % 10)]
               || ' ' || g,
             '', 500 + (g % 50) * 100, '',
             'mp-' || ${run} || '-' || g, false, now(), now()
      FROM generate_series(1, ${PRODUCTS}) AS g`;

    await prisma.$executeRaw`
      INSERT INTO "ProductVariant" ("id","productId","attributes","stock","sortOrder","createdAt")
      SELECT 'mv-' || ${run} || '-' || g || '-' || v,
             'mp-' || ${run} || '-' || g,
             jsonb_build_object('Size', (ARRAY['S','M','L'])[v]),
             500, v, now()
      FROM generate_series(1, ${PRODUCTS}) AS g,
           generate_series(1, ${VARIANTS_EACH}) AS v`;

    // Sales and their lines, so the history list and the takings aggregate have something to
    // scan. Half cash, half card, so the FILTER clauses in the aggregate do real work.
    await prisma.$executeRaw`
      INSERT INTO "CounterSale" ("id","tenantId","status","payment","submissionId","linesFingerprint","soldByNameSnapshot","notes","createdAt")
      SELECT 'ms-' || ${run} || '-' || g, ${tenantId}, 'RECORDED',
             (CASE WHEN g % 2 = 0 THEN 'CASH' ELSE 'CARD' END)::"CounterSalePayment",
             'msub-' || ${run} || '-' || g, 'f', 'Measure', '',
             now() - ((g % 30) || ' hours')::interval
      FROM generate_series(1, ${SALES}) AS g`;

    await prisma.$executeRaw`
      INSERT INTO "CounterSaleItem" ("id","tenantId","counterSaleId","productNameSnapshot","regularPriceCentsSnapshot","priceCentsSnapshot","quantity")
      SELECT 'msi-' || ${run} || '-' || g || '-' || l, ${tenantId}, 'ms-' || ${run} || '-' || g,
             'Measure line', 1000, 1000, 1 + (l % 3)
      FROM generate_series(1, ${SALES}) AS g, generate_series(1, 2) AS l`;

    // ANALYZE before measuring anything. A freshly bulk-loaded table has no statistics, so the
    // planner estimates one row everywhere and picks plans it would never choose in production.
    // Without this the first run timed the takings aggregate on a nested loop that discarded
    // 271,068 rows — a measurement of the planner's ignorance, not of the query.
    await prisma.$executeRawUnsafe(
      'ANALYZE "Product", "ProductVariant", "CounterSale", "CounterSaleItem"',
    );
    console.log(
      `  seeded and analyzed in ${((performance.now() - seedStarted) / 1000).toFixed(1)}s\n`,
    );

    const sellable = await prisma.productVariant.findMany({
      where: { product: { tenantId } },
      select: { id: true },
      take: 4,
    });

    console.log("Latency:");
    const searchP95 = await time("searchTillItems", ITERATIONS, (i) =>
      searchTillItems(tenantId, WORDS[i % WORDS.length]),
    );
    await time("recordCounterSale (2 lines)", ITERATIONS, (i) =>
      recordCounterSale(tenantId, {
        submissionId: `measure-${run}-${i}`,
        payment: "CASH",
        lines: [
          { variantId: sellable[0].id, quantity: 1 },
          { variantId: sellable[1].id, quantity: 2 },
        ],
        soldByUserId: store.user.id,
        soldByName: "M",
        role: "STORE_OWNER",
      }),
    );
    await time("listCounterSalesPage", ITERATIONS, () => listCounterSalesPage(tenantId, 1));
    await time("getCounterTakings", ITERATIONS, () =>
      getCounterTakings(tenantId, {
        from: new Date(Date.now() - 86_400_000),
        to: new Date(Date.now() + 86_400_000),
      }),
    );

    // ---- the two plans worth reading -------------------------------------------------------
    console.log("\nEXPLAIN ANALYZE — the product search (an unanchored ILIKE):");
    const searchPlan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN ANALYZE
      SELECT id, name FROM "Product"
      WHERE "tenantId" = ${tenantId} AND name ILIKE ${"%mug%"}
      ORDER BY name ASC LIMIT 20`;
    for (const row of searchPlan) console.log(`  ${row["QUERY PLAN"]}`);

    console.log("\nEXPLAIN ANALYZE — the takings aggregate:");
    const takingsPlan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN ANALYZE
      WITH per_sale AS (
        SELECT s.id, s.payment, s.status,
               SUM(i."priceCentsSnapshot" * i.quantity)::int AS total
        FROM "CounterSale" s
        JOIN "CounterSaleItem" i ON i."counterSaleId" = s.id AND i."tenantId" = s."tenantId"
        WHERE s."tenantId" = ${tenantId}
          AND s."createdAt" >= ${new Date(Date.now() - 86_400_000)}
          AND s."createdAt" < ${new Date(Date.now() + 86_400_000)}
        GROUP BY s.id, s.payment, s.status
      )
      SELECT COUNT(*)::int, COALESCE(SUM(total), 0)::int FROM per_sale`;
    for (const row of takingsPlan) console.log(`  ${row["QUERY PLAN"]}`);

    console.log(
      `\nThe index decision: search p95 was ${searchP95.toFixed(0)}ms at ${PRODUCTS} products ` +
        `(${PRODUCTS * VARIANTS_EACH} variants). The threshold for adding pg_trgm and a GIN index ` +
        `on Product.name is 150ms — ${searchP95 < 150 ? "NOT reached, so no extension" : "REACHED, so add it"}.`,
    );
  } finally {
    // One cascade takes the products, variants, sales and lines with it.
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
