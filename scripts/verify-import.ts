/**
 * What a spreadsheet actually does to a catalogue (pnpm verify:import).
 *
 * In-process through the real data layer, against throwaway stores it creates and removes. The row
 * *rules* are held down by `pnpm verify:sheet`, which needs no database; this suite is only for
 * the claims that involve writing — slug allocation, category creation, the ledger, and above all
 * the things an import must **not** destroy.
 *
 * **The first leg is the one that matters most**, and it exists because the approved plan had a
 * data-loss bug in it. `updateProduct` is a *replace*, not a merge: anything absent from its
 * payload is deleted, and for a variant its stock is written off first. The sheet has no image
 * column by design, so the straightforward `images: []` would have destroyed every product's
 * gallery on the first re-import, and a Variants sheet that omitted a row would have deleted that
 * variant. Nobody would have noticed from the outcome, which would have said "1 updated".
 */

import "dotenv/config";
// AFTER dotenv, BEFORE anything that imports @/lib/prisma: this suite reads with the bare client
// to check what the writers actually left behind, and the bare client is RLS-bound when
// APP_DATABASE_URL points at the restricted role — every such read came back empty, which looks
// exactly like "the writer did nothing".
import "./_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { prisma, withTenant } from "../lib/prisma";
import { createStoreWithOwner, setTenantStock } from "../lib/data/tenants";
import { createProduct, type ProductInput } from "../lib/data/products";
import { createCategory } from "../lib/data/categories";
import {
  MAX_IMPORT_PRODUCTS,
  applyCatalogueImport,
  applyStockCountImport,
  planCatalogueImport,
  planStockCountImport,
} from "../lib/data/catalogue-import";
import { parseCatalogueSheets, parseStockSheet, type ParsedCatalogue } from "../lib/catalogue-sheet/parse";
import { productSheetColumns, stockSheetColumns, variantSheetColumns } from "../lib/catalogue-sheet/columns";
import { buildWorkbook, readWorkbook, type ExportProduct, type ExportVariant } from "../lib/catalogue-sheet/workbook";
import { describeStockDrift, findStockDrift } from "../lib/stock/invariant";
import { MAX_STOCK_LINES } from "../lib/stock";
import { parseAttributes, attributeSignature } from "../lib/variants";

let checks = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
}

const RUN = Date.now().toString(36);
const ACTOR = { userId: null as string | null, name: "Import Suite" };

/** The sheets as grids, built from the real column definition so a rename cannot desync them. */
const headers = (columns: { header: { en: string } }[]) => columns.map((c) => c.header.en);
const productsGrid = (rows: (string | number | null)[][]) => [
  headers(productSheetColumns()),
  ...rows.map((r) => r.map((c) => (c === null ? "" : String(c)))),
];
const variantsGrid = (rows: (string | number | null)[][]) => [
  headers(variantSheetColumns()),
  ...rows.map((r) => r.map((c) => (c === null ? "" : String(c)))),
];
const stockGrid = (rows: (string | number | null)[][]) => [
  headers(stockSheetColumns()),
  ...rows.map((r) => r.map((c) => (c === null ? "" : String(c)))),
];

const parse = (products?: (string | number | null)[][], variants?: (string | number | null)[][]): ParsedCatalogue =>
  parseCatalogueSheets({
    products: products ? productsGrid(products) : undefined,
    variants: variants ? variantsGrid(variants) : undefined,
  });

async function main() {
  const store = await createStoreWithOwner({
    storeName: `Import ${RUN}`,
    ownerName: "Import Owner",
    ownerEmail: `import-owner-${RUN}@example.test`,
    passwordHash: "x",
  });
  const T = store.tenant.id;
  const OWNER = store.user.id;
  ACTOR.userId = OWNER;

  const base = (over: Partial<ProductInput> = {}): ProductInput => ({
    name: "Thing",
    description: "",
    basePriceCents: 10_000,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: null,
    variants: [{ attributes: {}, stock: 5, priceCentsOverride: null, imageUrl: null }],
    ...over,
  });

  /** The ledger's newest balance must equal the shelf, for every variant of this store. */
  const assertNoDrift = async () => {
    const rows = await withTenant(T, (db) => findStockDrift(db, T));
    assert.equal(rows.length, 0, `the ledger and the shelf disagree — ${describeStockDrift(rows)}`);
  };

  const snapshot = (id: string) =>
    withTenant(T, (db) =>
      db.product.findUniqueOrThrow({
        where: { id },
        select: {
          name: true,
          description: true,
          basePriceCents: true,
          isBestSeller: true,
          lowStockThreshold: true,
          categoryId: true,
          imageUrl: true,
          images: { select: { id: true, url: true }, orderBy: { sortOrder: "asc" } },
          variants: {
            select: { id: true, attributes: true, stock: true, priceCentsOverride: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      }),
    );

  try {
    console.log("What an import must never destroy:");

    await check("an update from a sheet with no image column keeps every photo", async () => {
      // THE leg. `updateProduct` does `productImage.deleteMany({ id: { notIn: keepImages } })`, so
      // the obvious `images: []` deletes the whole gallery — and the outcome still reports
      // "1 updated", so nothing about the result would have given it away.
      const created = await createProduct(
        T,
        base({
          name: "Photographed Shirt",
          basePriceCents: 5_000,
          imageUrl: "/a.png",
          images: [{ url: "/a.png" }, { url: "/b.png" }, { url: "/c.png" }],
          variants: [
            { attributes: { Size: "M" }, stock: 4, priceCentsOverride: null, imageUrl: null },
            { attributes: { Size: "L" }, stock: 2, priceCentsOverride: null, imageUrl: null },
          ],
        }),
        ACTOR,
      );
      const before = await snapshot(created.id);
      assert.equal(before.images.length, 3);

      // A sheet that names ONE of the two options, no photos, and a new price.
      const outcome = await applyCatalogueImport(
        T,
        parse(
          [["Photographed Shirt", "", "60.00", "", "", ""]],
          [["Photographed Shirt", "Size", "M", "", "", "", "", "", ""]],
        ),
        ACTOR,
      );
      assert.equal(outcome.updated, 1, JSON.stringify(outcome));
      const after = await snapshot(created.id);
      assert.equal(after.basePriceCents, 6_000, "the price change must have landed");
      assert.deepEqual(
        after.images.map((i) => i.id),
        before.images.map((i) => i.id),
        "all three photos must survive, with their own ids",
      );
      assert.equal(after.imageUrl, "/a.png", "and the main image");
      // And the variant the sheet did not mention is still there, with its stock.
      assert.deepEqual(
        after.variants.map((v) => [parseAttributes(v.attributes).Size, v.stock]).sort(),
        [["L", 2], ["M", 4]],
        "an omitted option must be kept, not deleted and written off",
      );
    });

    await check("the preview says out loud which options it is keeping", async () => {
      const plan = await planCatalogueImport(
        T,
        parse(
          [["Photographed Shirt", "", "60.00", "", "", ""]],
          [["Photographed Shirt", "Size", "M", "", "", "", "", "", ""]],
        ),
      );
      // A merchant who MEANT to remove an option has to learn that the import did not, or they
      // will believe the file is the whole truth about their catalogue.
      assert.deepEqual(plan.keptVariants, [{ productName: "Photographed Shirt", label: "Size: L" }]);
    });

    await check("a blank cell leaves its field alone, and never empties it", async () => {
      const created = await createProduct(
        T,
        base({
          name: "Described Mug",
          description: "A long description nobody retyped into a spreadsheet.",
          basePriceCents: 1_200,
          isBestSeller: true,
          lowStockThreshold: 7,
        }),
        ACTOR,
      );
      await applyCatalogueImport(T, parse([["Described Mug", "", "15.00", "", "", ""]]), ACTOR);
      const after = await snapshot(created.id);
      assert.equal(after.basePriceCents, 1_500);
      // The one rule the whole sheet is built on. Blank is not empty and not zero.
      assert.equal(after.description, "A long description nobody retyped into a spreadsheet.");
      assert.equal(after.isBestSeller, true);
      assert.equal(after.lowStockThreshold, 7);
    });

    await check("an existing option's stock is carried, not reset to zero", async () => {
      // With the ledger ON `updateProduct` ignores the submitted figure (D90) — but with it OFF it
      // writes what it is given, so a 0 in the payload empties the shelf on exactly the stores
      // that have no ledger to find out from. This store has no ledger yet.
      const created = await createProduct(
        T,
        base({ name: "Stocked Bowl", variants: [{ attributes: {}, stock: 33, priceCentsOverride: null, imageUrl: null }] }),
        ACTOR,
      );
      await applyCatalogueImport(T, parse([["Stocked Bowl", "", "99.00", "", "", ""]]), ACTOR);
      assert.equal((await snapshot(created.id)).variants[0].stock, 33);
    });

    console.log("\nMatching, and refusing to guess:");

    await check("a name that matches two products is refused, not guessed", async () => {
      // `Product.name` has no unique constraint — only (tenantId, slug) — so a store can already
      // hold two of these, and updating whichever came back first would edit one at random.
      const a = await createProduct(T, base({ name: "Twin" }), ACTOR);
      const b = await createProduct(T, base({ name: "twin  " }), ACTOR);
      const plan = await planCatalogueImport(T, parse([["Twin", "", "11.00", "", "", ""]]));
      const row = plan.products.find((p) => p.matchKey === "twin")!;
      assert.equal(row.verdict, "skip");
      assert.match(row.reason!, /^import\.issue\.ambiguousName/);
      const outcome = await applyCatalogueImport(T, parse([["Twin", "", "11.00", "", "", ""]]), ACTOR);
      assert.equal(outcome.updated, 0);
      assert.equal(outcome.created, 0, "and it must not create a third");
      assert.equal(outcome.skipped.length, 1);
      await prisma.product.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    });

    await check("case and inner whitespace do not create a second product", async () => {
      const created = await createProduct(T, base({ name: "Linen Shirt" }), ACTOR);
      const outcome = await applyCatalogueImport(T, parse([["linen  shirt", "", "77.00", "", "", ""]]), ACTOR);
      assert.equal(outcome.created, 0, "this is the mitigation for matching by name");
      assert.equal(outcome.updated, 1);
      const after = await snapshot(created.id);
      assert.equal(after.basePriceCents, 7_700);
      // The stored name is NOT overwritten with the sheet's casing, because `Linen Shirt` and
      // `linen  shirt` are the same product and the sheet's spelling is not more authoritative.
      assert.equal(await prisma.product.count({ where: { tenantId: T, name: { contains: "inen" } } }), 1);
    });

    await check("an unchanged row writes nothing at all", async () => {
      const created = await createProduct(
        T,
        base({ name: "Steady Lamp", basePriceCents: 4_500, description: "Steady." }),
        ACTOR,
      );
      const before = await prisma.product.findUniqueOrThrow({
        where: { id: created.id },
        select: { updatedAt: true },
      });
      const sheet = parse([["Steady Lamp", "Steady.", "45.00", "", "", ""]]);
      const plan = await planCatalogueImport(T, sheet);
      assert.equal(plan.products.find((p) => p.matchKey === "steady lamp")!.verdict, "unchanged");
      const outcome = await applyCatalogueImport(T, sheet, ACTOR);
      assert.equal(outcome.unchanged, 1);
      assert.equal(outcome.updated, 0, "the export → edit a few cells → re-import case must be cheap");
      const after = await prisma.product.findUniqueOrThrow({
        where: { id: created.id },
        select: { updatedAt: true },
      });
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "nothing may have been written");
    });

    await check("applying the same file twice is an update to identical, never a duplicate", async () => {
      const sheet = () => parse([["Twice Imported", "", "9.00", "", "", ""]]);
      const first = await applyCatalogueImport(T, sheet(), ACTOR);
      assert.equal(first.created, 1);
      const second = await applyCatalogueImport(T, sheet(), ACTOR);
      // The catalogue sheet has no submission-id table, so this — not a unique index — is what
      // makes a double-apply safe, and it is the second real benefit of matching by name.
      assert.equal(second.created, 0);
      assert.equal(second.unchanged, 1);
      assert.equal(await prisma.product.count({ where: { tenantId: T, name: "Twice Imported" } }), 1);
    });

    console.log("\nCreating:");

    await check("two rows whose names slugify the same both land", async () => {
      // The case `createProduct` cannot handle: its taken-slug set is read from COMMITTED rows
      // only, so two rows in one file compute the same suffix and the second collides.
      const outcome = await applyCatalogueImport(
        T,
        parse([
          ["Blue Vase!", "", "10.00", "", "", ""],
          ["Blue Vase?", "", "11.00", "", "", ""],
          ["blue-vase", "", "12.00", "", "", ""],
        ]),
        ACTOR,
      );
      assert.equal(outcome.created, 3, JSON.stringify(outcome));
      const slugs = await prisma.product.findMany({
        where: { tenantId: T, slug: { startsWith: "blue-vase" } },
        select: { slug: true },
      });
      assert.equal(new Set(slugs.map((s) => s.slug)).size, 3, "three distinct URLs");
    });

    await check("a products-only sheet gives each new product its default option", async () => {
      await applyCatalogueImport(T, parse([["Plain Tray", "", "20.00", "", "", ""]]), ACTOR);
      const made = await prisma.product.findFirstOrThrow({
        where: { tenantId: T, name: "Plain Tray" },
        select: { variants: { select: { attributes: true, stock: true } } },
      });
      // Every product has at least one variant; a product sold in one version has an
      // attribute-less default. A products-only sheet is a legitimate way to add a catalogue.
      assert.equal(made.variants.length, 1);
      assert.deepEqual(parseAttributes(made.variants[0].attributes), {});
    });

    await check("missing categories are created parent-first, and reused across rows", async () => {
      const outcome = await applyCatalogueImport(
        T,
        parse([
          ["Deep A", "", "10.00", "Outer / Middle / Inner", "", ""],
          ["Deep B", "", "11.00", "Outer / Middle", "", ""],
          ["Deep C", "", "12.00", "Outer / Other", "", ""],
        ]),
        ACTOR,
      );
      assert.equal(outcome.created, 3);
      // `createCategory` asserts its parent exists, so the order is load-bearing rather than tidy.
      assert.deepEqual(outcome.categoriesCreated, ["Outer", "Outer / Middle", "Outer / Middle / Inner", "Outer / Other"]);
      const cats = await prisma.category.findMany({
        where: { tenantId: T, name: { in: ["Outer", "Middle", "Inner", "Other"] } },
        select: { id: true, name: true, parentId: true },
      });
      assert.equal(cats.length, 4, "and exactly four, not one per row that mentioned them");
      const byName = new Map(cats.map((c) => [c.name, c]));
      assert.equal(byName.get("Outer")!.parentId, null);
      assert.equal(byName.get("Middle")!.parentId, byName.get("Outer")!.id);
      assert.equal(byName.get("Inner")!.parentId, byName.get("Middle")!.id);
      assert.equal(byName.get("Other")!.parentId, byName.get("Outer")!.id);
      const a = await prisma.product.findFirstOrThrow({ where: { tenantId: T, name: "Deep A" } });
      assert.equal(a.categoryId, byName.get("Inner")!.id);
    });

    await check("an existing category is matched case-insensitively, never duplicated", async () => {
      await createCategory(T, { name: "Homeware", parentId: null });
      const outcome = await applyCatalogueImport(T, parse([["Matched Jug", "", "10.00", "homeware", "", ""]]), ACTOR);
      assert.equal(outcome.created, 1);
      assert.deepEqual(outcome.categoriesCreated, [], "a typo in case must not fork the tree");
      assert.equal(await prisma.category.count({ where: { tenantId: T, name: { in: ["Homeware", "homeware"] } } }), 1);
    });

    console.log("\nOptions and stock, which the sheet is deliberately bad at:");

    await check("stock on a NEW option is applied; on an existing one it is ignored and reported", async () => {
      const created = await createProduct(
        T,
        base({
          name: "Optioned Tee",
          variants: [{ attributes: { Size: "S" }, stock: 3, priceCentsOverride: null, imageUrl: null }],
        }),
        ACTOR,
      );
      const sheet = parse(
        [["Optioned Tee", "", "30.00", "", "", ""]],
        [
          ["Optioned Tee", "Size", "S", "", "", "", "", "999", ""],
          ["Optioned Tee", "Size", "M", "", "", "", "", "8", ""],
        ],
      );
      const plan = await planCatalogueImport(T, sheet);
      // Reported rather than silently dropped: a figure typed into the wrong column has to come
      // back as something the merchant can act on.
      assert.deepEqual(
        plan.ignoredStock.map((i) => [i.productName, i.attributes.Size, i.stock]),
        [["Optioned Tee", "S", 999]],
      );
      await applyCatalogueImport(T, sheet, ACTOR);
      const after = await snapshot(created.id);
      const bySize = new Map(after.variants.map((v) => [parseAttributes(v.attributes).Size, v.stock]));
      assert.equal(bySize.get("S"), 3, "an existing shelf must not move through this path");
      assert.equal(bySize.get("M"), 8, "a brand-new option's figure is the one a sheet may set");
    });

    await check("a sheet cannot give a one-version product its first option", async () => {
      // The union of a lone attribute-less variant and an attributed one fails `variantSetIssues`,
      // and the only way through would be to DELETE that variant and write off its stock — which
      // this feature promises never to do. Refused, naming where it CAN be done.
      const created = await createProduct(T, base({ name: "Single Version Hat" }), ACTOR);
      const sheet = parse(undefined, [["Single Version Hat", "Size", "M", "", "", "", "", "4", ""]]);
      const plan = await planCatalogueImport(T, sheet);
      const row = plan.products.find((p) => p.matchKey === "single version hat")!;
      assert.equal(row.verdict, "skip");
      assert.equal(row.reason, "import.issue.firstOptionOnProductScreen");
      await applyCatalogueImport(T, sheet, ACTOR);
      const after = await snapshot(created.id);
      assert.equal(after.variants.length, 1, "and nothing was touched");
      assert.deepEqual(parseAttributes(after.variants[0].attributes), {});
    });

    await check("a sheet naming different option names than the product has is refused", async () => {
      const created = await createProduct(
        T,
        base({
          name: "Sized Sock",
          variants: [
            { attributes: { Size: "S" }, stock: 1, priceCentsOverride: null, imageUrl: null },
            { attributes: { Size: "M" }, stock: 1, priceCentsOverride: null, imageUrl: null },
          ],
        }),
        ACTOR,
      );
      // The union can fail where neither half did: `Size` variants plus a `Colour` row disagree
      // about their attribute names. Caught in the plan, so it is a numbered refusal on the
      // preview rather than a thrown error halfway through the apply.
      const plan = await planCatalogueImport(
        T,
        parse(undefined, [["Sized Sock", "Colour", "Blue", "", "", "", "", "4", ""]]),
      );
      const row = plan.products.find((p) => p.matchKey === "sized sock")!;
      assert.equal(row.verdict, "skip");
      assert.equal(row.reason, "products.variant.sameAttributeNames");
      assert.equal((await snapshot(created.id)).variants.length, 2);
    });

    await check("options for a product that is nowhere are refused, not invented", async () => {
      const plan = await planCatalogueImport(
        T,
        parse(undefined, [["Ghost Product", "Size", "M", "", "", "", "", "4", ""]]),
      );
      const row = plan.products.find((p) => p.matchKey === "ghost product")!;
      assert.equal(row.verdict, "skip");
      assert.match(row.reason!, /^import\.issue\.unknownProduct/);
    });

    await check("an option's price override is set, and a blank leaves it alone", async () => {
      const created = await createProduct(
        T,
        base({
          name: "Overridden Cup",
          variants: [
            { attributes: { Size: "S" }, stock: 1, priceCentsOverride: 2_500, imageUrl: null },
            { attributes: { Size: "L" }, stock: 1, priceCentsOverride: 3_000, imageUrl: null },
          ],
        }),
        ACTOR,
      );
      await applyCatalogueImport(
        T,
        parse(undefined, [
          ["Overridden Cup", "Size", "S", "", "", "", "", "", "99.00"],
          ["Overridden Cup", "Size", "L", "", "", "", "", "", ""],
        ]),
        ACTOR,
      );
      const after = await snapshot(created.id);
      const bySize = new Map(
        after.variants.map((v) => [parseAttributes(v.attributes).Size, v.priceCentsOverride]),
      );
      assert.equal(bySize.get("S"), 9_900);
      assert.equal(bySize.get("L"), 3_000, "blank means leave it alone, here too");
    });

    console.log("\nThe round trip on real rows, which is what a merchant actually does:");

    await check("export, read back, re-import: nothing changes and nothing is lost", async () => {
      // The flow the whole feature is shaped around — and the check that catches a mistyped field
      // name on an OPTIONAL column, which no throw can catch because blank is legal there.
      const created = await createProduct(
        T,
        base({
          name: "Round Trip Rug",
          description: "Woven, with a comma, and a \"quote\".",
          basePriceCents: 18_900,
          isBestSeller: true,
          lowStockThreshold: 2,
          images: [{ url: "/rug-a.png" }, { url: "/rug-b.png" }],
          imageUrl: "/rug-a.png",
          variants: [
            { attributes: { Size: "S", Colour: "Rust" }, stock: 6, priceCentsOverride: 17_500, imageUrl: null },
            { attributes: { Size: "L", Colour: "Rust" }, stock: 2, priceCentsOverride: null, imageUrl: null },
          ],
        }),
        ACTOR,
      );
      const live = await snapshot(created.id);
      const products: ExportProduct[] = [
        {
          name: live.name,
          description: live.description ?? "",
          priceCents: live.basePriceCents,
          categoryPath: null,
          bestSeller: live.isBestSeller,
          warnAt: live.lowStockThreshold,
        },
      ];
      const variants: ExportVariant[] = live.variants.map((v) => ({
        productName: live.name,
        attributes: parseAttributes(v.attributes),
        stock: v.stock,
        priceOverrideCents: v.priceCentsOverride,
      }));
      const buffer = await buildWorkbook({
        locale: "en",
        storeName: "Import Suite",
        categoryPaths: [],
        productNames: [live.name],
        products,
        variants,
      });
      const { sheets } = await readWorkbook(buffer);
      const parsed = parseCatalogueSheets({ products: sheets.products, variants: sheets.variants });
      assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));

      const plan = await planCatalogueImport(T, parsed);
      assert.equal(
        plan.products.find((p) => p.matchKey === "round trip rug")!.verdict,
        "unchanged",
        "an export fed straight back must change nothing — if an optional column was exported " +
          "blank by mistake, this is where it shows",
      );
      const outcome = await applyCatalogueImport(T, parsed, ACTOR);
      assert.equal(outcome.unchanged, 1);
      assert.equal(outcome.updated, 0);
      const after = await snapshot(created.id);
      assert.deepEqual(after.images.map((i) => i.url), ["/rug-a.png", "/rug-b.png"]);
      assert.deepEqual(
        after.variants.map((v) => [attributeSignature(parseAttributes(v.attributes)), v.stock, v.priceCentsOverride]),
        live.variants.map((v) => [attributeSignature(parseAttributes(v.attributes)), v.stock, v.priceCentsOverride]),
      );
    });

    console.log("\nThe stock count sheet, through the ledger:");

    await check("a count sheet becomes stocktakes, every line a movement", async () => {
      await setTenantStock(T, OWNER);
      const created = await createProduct(
        T,
        base({
          name: "Counted Crate",
          variants: [
            { attributes: { Size: "S" }, stock: 10, priceCentsOverride: null, imageUrl: null },
            { attributes: { Size: "L" }, stock: 4, priceCentsOverride: null, imageUrl: null },
          ],
        }),
        ACTOR,
      );
      const rows = parseStockSheet(
        stockGrid([
          ["Counted Crate", "Size", "S", "", "", "", "", "10", "7"],
          ["Counted Crate", "Size", "L", "", "", "", "", "4", "4"],
        ]),
      );
      assert.deepEqual(rows.issues, []);
      const plan = await planStockCountImport(T, rows.rows);
      assert.equal(plan.lines.length, 2);
      assert.equal(plan.chunks, 1);

      const importId = randomUUID();
      const outcome = await applyStockCountImport(T, rows.rows, {
        importId,
        reference: "Import — count.xlsx",
        actor: { userId: OWNER, name: "Import Owner" },
      });
      assert.equal(outcome.counted, 2);
      assert.equal(outcome.moved, 1, "one shelf differed; the one that agreed moved nothing");
      assert.equal(outcome.batchIds.length, 1);
      const after = await snapshot(created.id);
      const bySize = new Map(after.variants.map((v) => [parseAttributes(v.attributes).Size, v.stock]));
      assert.equal(bySize.get("S"), 7);
      assert.equal(bySize.get("L"), 4);
      // A line that agrees with the shelf is still written, as a zero-delta COUNT — the only
      // evidence the count happened at all.
      const movements = await prisma.stockMovement.count({
        where: { tenantId: T, batchId: outcome.batchIds[0] },
      });
      assert.equal(movements, 2, "a stocktake records the shelf it confirmed as well as the one it corrected");
      await assertNoDrift();
    });

    await check("re-uploading the same count is answered, not applied twice", async () => {
      const created = await createProduct(
        T,
        base({ name: "Replayed Box", variants: [{ attributes: {}, stock: 9, priceCentsOverride: null, imageUrl: null }] }),
        ACTOR,
      );
      const rows = parseStockSheet(stockGrid([["Replayed Box", "", "", "", "", "", "", "9", "3"]]));
      const importId = randomUUID();
      const opts = { importId, reference: "Import — replay.xlsx", actor: { userId: OWNER, name: "Import Owner" } };
      const first = await applyStockCountImport(T, rows.rows, opts);
      const second = await applyStockCountImport(T, rows.rows, opts);
      assert.equal(first.moved, 1);
      // The chunk id meets the existing (tenantId, submissionId) unique index, so a replay is
      // answered with the document that did commit and moves nothing.
      assert.equal(second.moved, 0, "a replay must not move the shelf again");
      assert.deepEqual(second.batchIds, first.batchIds);
      assert.equal((await snapshot(created.id)).variants[0].stock, 3);
      await assertNoDrift();
    });

    await check(`a count longer than ${MAX_STOCK_LINES} lines becomes several documents`, async () => {
      const names: string[] = [];
      for (let i = 0; i < MAX_STOCK_LINES + 5; i++) {
        const name = `Chunked ${i}`;
        names.push(name);
        await createProduct(
          T,
          base({ name, variants: [{ attributes: {}, stock: 1, priceCentsOverride: null, imageUrl: null }] }),
          ACTOR,
        );
      }
      const rows = parseStockSheet(stockGrid(names.map((n) => [n, "", "", "", "", "", "", "1", "2"])));
      assert.equal(rows.rows.length, MAX_STOCK_LINES + 5);
      const plan = await planStockCountImport(T, rows.rows);
      assert.equal(plan.chunks, 2, "the cap on a typed stocktake is not raised for a sheet");
      const outcome = await applyStockCountImport(T, rows.rows, {
        importId: randomUUID(),
        reference: "Import — big.xlsx",
        actor: { userId: OWNER, name: "Import Owner" },
      });
      assert.equal(outcome.batchIds.length, 2);
      assert.equal(outcome.counted, MAX_STOCK_LINES + 5);
      const batches = await prisma.stockBatch.findMany({
        where: { id: { in: outcome.batchIds } },
        select: { reference: true },
        orderBy: { createdAt: "asc" },
      });
      // Each chunk says which part of one document it is, which is what that free-text field is for.
      assert.deepEqual(batches.map((b) => b.reference), ["Import — big.xlsx (1/2)", "Import — big.xlsx (2/2)"]);
      await assertNoDrift();
    });

    await check("a count line naming an option that is not there is refused", async () => {
      await createProduct(
        T,
        base({ name: "Mislabelled Pot", variants: [{ attributes: { Size: "S" }, stock: 2, priceCentsOverride: null, imageUrl: null }] }),
        ACTOR,
      );
      const rows = parseStockSheet(
        stockGrid([
          ["Mislabelled Pot", "Size", "XL", "", "", "", "", "", "5"],
          ["Nonexistent Pot", "", "", "", "", "", "", "", "5"],
        ]),
      );
      const plan = await planStockCountImport(T, rows.rows);
      assert.equal(plan.lines.length, 0);
      assert.equal(plan.issues.length, 2);
      // Guessing which shelf was meant is the one thing a stocktake must never do.
      for (const issue of plan.issues) assert.match(issue.message, /^import\.issue\.unknownOption/);
      const outcome = await applyStockCountImport(T, rows.rows, {
        importId: randomUUID(),
        reference: "Import — wrong.xlsx",
        actor: { userId: OWNER, name: "Import Owner" },
      });
      assert.equal(outcome.counted, 0);
      assert.equal(outcome.skipped.length, 2);
      await assertNoDrift();
    });

    await check("an import leaves the ledger reconcilable, and every created unit accounted for", async () => {
      const outcome = await applyCatalogueImport(
        T,
        parse(
          [["Ledgered Lamp", "", "40.00", "", "", ""]],
          [
            ["Ledgered Lamp", "Size", "S", "", "", "", "", "12", ""],
            ["Ledgered Lamp", "Size", "L", "", "", "", "", "0", ""],
          ],
        ),
        { userId: OWNER, name: "Import Owner" },
      );
      assert.equal(outcome.created, 1);
      const made = await prisma.product.findFirstOrThrow({
        where: { tenantId: T, name: "Ledgered Lamp" },
        select: { variants: { select: { id: true, stock: true, attributes: true } } },
      });
      const openings = await prisma.stockMovement.findMany({
        where: { tenantId: T, variantId: { in: made.variants.map((v) => v.id) } },
        select: { reason: true, delta: true, balanceAfter: true },
      });
      // A product created with twelve on the shelf is twelve units the ledger has to account for.
      // The empty option gets no OPENING: a zero states nothing, and the first real movement on it
      // writes its own.
      //
      // `delta` is 0 and that is correct — an OPENING is not a movement. Nothing moved; the units
      // came into existence along with the row that holds them, so the figure is in `balanceAfter`
      // and the invariant reconciles against that.
      assert.deepEqual(openings.map((o) => [o.reason, o.delta, o.balanceAfter]), [["OPENING", 0, 12]]);
      await assertNoDrift();
    });

    console.log("\nCaps and failure:");

    await check("a file over the product cap is refused as one complaint", async () => {
      const rows = Array.from({ length: MAX_IMPORT_PRODUCTS + 1 }, (_, i) => [`Capped ${i}`, "", "1.00", "", "", ""]);
      const plan = await planCatalogueImport(T, parse(rows));
      assert.ok(
        plan.issues.some((i) => i.row === 0 && i.message.startsWith("import.cap.")),
        `expected a cap complaint, got ${JSON.stringify(plan.issues.slice(0, 3))}`,
      );
    });

    await check("a row problem never stops the rows around it", async () => {
      // "Import the good rows, report the rest", which is what the user chose over
      // all-or-nothing — so this is the behaviour that choice rests on. Both kinds of bad row are
      // here, because they are refused in different places: a malformed price never reaches the
      // writer at all, and an ambiguous name is refused by the plan.
      await createProduct(T, base({ name: "Partial Twin" }), ACTOR);
      await createProduct(T, base({ name: "partial  twin" }), ACTOR);
      const sheet = parse([
        ["Partial One", "", "10.00", "", "", ""],
        ["Partial Bad Price", "", "12.3.4", "", "", ""],
        ["Partial Twin", "", "11.00", "", "", ""],
        ["Partial Two", "", "12.00", "", "", ""],
      ]);
      assert.equal(sheet.products.length, 3, "the malformed price is dropped before the writer");
      assert.equal(sheet.issues.length, 1);
      const outcome = await applyCatalogueImport(T, sheet, ACTOR);
      assert.equal(outcome.created, 2, JSON.stringify(outcome));
      assert.equal(outcome.skipped.length, 1, "the ambiguous name, reported with its row");
      assert.equal(outcome.skipped[0].row, 4);
      assert.equal(
        await prisma.product.count({ where: { tenantId: T, name: { startsWith: "Partial O" } } }),
        1,
      );
      assert.equal(
        await prisma.product.count({ where: { tenantId: T, name: "Partial Bad Price" } }),
        0,
        "and the bad row created nothing",
      );
    });
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: OWNER } });
  }

  console.log(`\nAll ${checks} import checks passed (test store removed).`);
}

main()
  .catch((error) => {
    console.error("\nIMPORT CHECK FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
