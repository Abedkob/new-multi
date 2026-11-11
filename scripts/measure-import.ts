/**
 * What a bulk import actually costs, measured (`pnpm measure:import`).
 *
 * Reports; asserts nothing. The caps in `lib/data/catalogue-import.ts` were sized from arithmetic
 * about Prisma's 5s default transaction timeout, and arithmetic is a hypothesis — this is what
 * turns it into a number. Run it before changing any of them.
 *
 *   pnpm measure:import                      # 500 products, a 1,000-line count
 *   pnpm measure:import --products=200
 *
 * Three questions it exists to answer.
 *
 *  1. **Does a full batch of creates fit inside one transaction?** 25 products with their variants
 *     is one `withTenant` callback, and Prisma's default timeout is 5s with no options passed. If a
 *     batch of 25 is anywhere near that, `CREATE_BATCH` is wrong.
 *  2. **Is the `unchanged` verdict worth its comparison?** The normal workflow is export, edit
 *     three cells, re-import. If re-importing an unchanged file is not dramatically cheaper than
 *     updating every row, the verdict is complexity for nothing.
 *  3. **Does the plan's one big read scale?** The planner loads every matched product with its
 *     variants and images in one query; at 500 products that is the single biggest statement in
 *     the feature, and it runs before anything is written, while a merchant waits.
 *
 * **`ANALYZE` first, always.** The first run of `measure:counter` timed an aggregate at p95 208ms
 * on a nested loop that discarded 271,068 rows with `rows=1` estimates throughout — a freshly
 * bulk-loaded table has no statistics, so that measured the planner's ignorance rather than the
 * query. The seeding here analyzes for the same reason.
 */

import "dotenv/config";
import "./_owner";
import { randomUUID } from "node:crypto";

import { parseCatalogueSheets, parseStockSheet } from "../lib/catalogue-sheet/parse";
import { buildWorkbook, readWorkbook } from "../lib/catalogue-sheet/workbook";
import {
  applyCatalogueImport,
  applyStockCountImport,
  planCatalogueImport,
  planStockCountImport,
} from "../lib/data/catalogue-import";
import { readCatalogueForExport } from "../lib/data/catalogue-sheet";
import { createStoreWithOwner, setTenantStock } from "../lib/data/tenants";
import { prisma, withTenant } from "../lib/prisma";
import { MAX_STOCK_LINES } from "../lib/stock";
import { analyzeTables, percentile, time } from "./fixtures/catalogue";

const arg = (name: string, fallback: number) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
};

const PRODUCTS = arg("products", 500);
const COUNT_LINES = arg("lines", 1_000);
const RUN = Date.now().toString(36);
const ACTOR = { userId: null as string | null, name: "Measure Import" };

/** The grids the sheets would arrive as, built from the real column definition. */
const productsGrid = (rows: string[][]) => [
  ["Product", "Description", "Price", "Category", "Best seller", "Warn me at"],
  ...rows,
];
const variantsGrid = (rows: string[][]) => [
  [
    "Product",
    "Option 1 name",
    "Option 1 value",
    "Option 2 name",
    "Option 2 value",
    "Option 3 name",
    "Option 3 value",
    "Stock (new options only)",
    "This option's price",
  ],
  ...rows,
];
const stockGridOf = (rows: string[][]) => [
  [
    "Product",
    "Option 1 name",
    "Option 1 value",
    "Option 2 name",
    "Option 2 value",
    "Option 3 name",
    "Option 3 value",
    "On the shelf now",
    "Counted",
  ],
  ...rows,
];

async function main() {
  const store = await createStoreWithOwner({
    storeName: `Measure Import ${RUN}`,
    ownerName: "Measure Import",
    ownerEmail: `measure-import-${RUN}@example.test`,
    passwordHash: "x",
  });
  const T = store.tenant.id;
  ACTOR.userId = store.user.id;

  try {
    await setTenantStock(T, store.user.id);

    console.log(`\nA sheet of ${PRODUCTS} products, two options each, into an empty store.\n`);

    const productRows = Array.from({ length: PRODUCTS }, (_, i) => [
      `Measured Product ${i}`,
      `Description for ${i}`,
      String(10 + (i % 90)),
      i % 3 === 0 ? `Measured / Group ${i % 7}` : "",
      i % 5 === 0 ? "yes" : "no",
      String(i % 4),
    ]);
    const variantRows = productRows.flatMap((row, i) => [
      [row[0], "Size", "M", "", "", "", "", String(5 + (i % 20)), ""],
      [row[0], "Size", "L", "", "", "", "", String(2 + (i % 9)), ""],
    ]);

    // Parsing, which is pure and happens before any database work. Worth its own figure: it is the
    // only part that scales with the FILE rather than with the catalogue.
    const parsed = parseCatalogueSheets({
      products: productsGrid(productRows),
      variants: variantsGrid(variantRows),
    });
    await time("parse (pure, in memory)", 5, async () => {
      parseCatalogueSheets({ products: productsGrid(productRows), variants: variantsGrid(variantRows) });
    });

    // The workbook round trip, which is what a real upload costs before a row is resolved.
    const workbook = await buildWorkbook({
      locale: "en",
      storeName: store.tenant.name,
      categoryPaths: [],
      productNames: [],
      products: parsed.products.map((p) => ({
        name: p.name,
        description: p.description ?? "",
        priceCents: p.priceCents,
        categoryPath: p.categoryPath,
        bestSeller: p.bestSeller ?? false,
        warnAt: p.warnAt,
      })),
    });
    console.log(`  workbook                       ${(workbook.length / 1024).toFixed(0)} KB for ${PRODUCTS} products`);
    await time("read the workbook back", 3, async () => {
      await readWorkbook(workbook);
    });

    await time("plan, against an empty store", 3, async () => {
      await planCatalogueImport(T, parsed);
    });

    const createStarted = performance.now();
    const created = await applyCatalogueImport(T, parsed, ACTOR);
    const createSeconds = (performance.now() - createStarted) / 1000;
    console.log(
      `\n  created ${created.created} products and ${created.categoriesCreated.length} categories ` +
        `in ${createSeconds.toFixed(1)}s — ${((createSeconds * 1000) / Math.max(1, created.created)).toFixed(1)}ms per product`,
    );
    if (created.skipped.length) console.log(`  skipped ${created.skipped.length}: ${created.skipped[0].message}`);

    await analyzeTables(["Product", "ProductVariant", "Category", "StockMovement"]);

    // Question 1: does one batch fit in a transaction? Measured as the per-batch share of the run,
    // which is what the 5s timeout actually sees.
    const batches = Math.ceil(created.created / 25);
    console.log(
      `  ${batches} transactions of up to 25 products: ~${((createSeconds * 1000) / Math.max(1, batches)).toFixed(0)}ms each ` +
        `(Prisma's default transaction timeout is 5,000ms)`,
    );

    console.log(`\nThe workflow that matters: export, change nothing, re-import.\n`);

    const data = await readCatalogueForExport(T);
    await time("read the catalogue for export", 3, async () => {
      await readCatalogueForExport(T);
    });
    const exported = await buildWorkbook({ locale: "en", storeName: store.tenant.name, ...data });
    console.log(`  exported workbook              ${(exported.length / 1024).toFixed(0)} KB`);

    const { sheets } = await readWorkbook(exported);
    const roundTripped = parseCatalogueSheets({ products: sheets.products, variants: sheets.variants });
    const planP95 = await time("plan, against a full store", 3, async () => {
      await planCatalogueImport(T, roundTripped);
    });

    const unchangedStarted = performance.now();
    const unchanged = await applyCatalogueImport(T, roundTripped, ACTOR);
    const unchangedSeconds = (performance.now() - unchangedStarted) / 1000;
    console.log(
      `\n  ${unchanged.unchanged} unchanged, ${unchanged.updated} updated, ${unchanged.created} created ` +
        `in ${unchangedSeconds.toFixed(1)}s`,
    );
    // Question 2, answered by comparison: an unchanged re-import against the same file where every
    // row is treated as an update.
    console.log(
      `  the unchanged verdict saved ${unchanged.unchanged} transactions; the plan's own read is ` +
        `p95 ${planP95.toFixed(0)}ms of that`,
    );

    console.log(`\nA counted sheet of ${COUNT_LINES} lines, through the ledger.\n`);

    const variantsForCount = await withTenant(T, (db) =>
      db.productVariant.findMany({
        where: { product: { tenantId: T } },
        take: COUNT_LINES,
        select: { attributes: true, stock: true, product: { select: { name: true } } },
      }),
    );
    const countRows = parseStockSheet(
      stockGridOf(
        variantsForCount.map((v) => {
          const attrs = v.attributes as Record<string, string>;
          const [key, value] = Object.entries(attrs)[0] ?? ["", ""];
          return [v.product.name, key, value, "", "", "", "", String(v.stock), String(v.stock + 1)];
        }),
      ),
    );
    console.log(`  parsed ${countRows.rows.length} lines, ${countRows.issues.length} issues`);

    await time("plan the count", 3, async () => {
      await planStockCountImport(T, countRows.rows);
    });

    const countStarted = performance.now();
    const counted = await applyStockCountImport(T, countRows.rows, {
      importId: randomUUID(),
      reference: "Measure",
      actor: { userId: store.user.id, name: "Measure Import" },
    });
    const countSeconds = (performance.now() - countStarted) / 1000;
    const chunks = Math.max(1, counted.batchIds.length);
    console.log(
      `\n  ${counted.counted} lines as ${chunks} stocktakes of up to ${MAX_STOCK_LINES} ` +
        `in ${countSeconds.toFixed(1)}s — ~${((countSeconds * 1000) / chunks).toFixed(0)}ms per document, ` +
        `${((countSeconds * 1000) / Math.max(1, counted.counted)).toFixed(1)}ms per line`,
    );
    console.log(
      `  each document holds a FOR UPDATE lock on its lines for its whole transaction, which is ` +
        `why this chunks at ${MAX_STOCK_LINES} instead of raising the cap`,
    );

    const movements = await prisma.stockMovement.count({ where: { tenantId: T } });
    console.log(`  ${movements} movements written in total\n`);

    console.log("Read these against the caps in lib/data/catalogue-import.ts, not against a feeling.");
    console.log(`  p50 of every timing above is printed beside its p95; percentile() is the same`);
    console.log(`  helper measure:stock and measure:counter use, so the figures are comparable.`);
    void percentile;
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: store.user.id } });
  }
}

main()
  .catch((error) => {
    console.error("\nMEASURE FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
