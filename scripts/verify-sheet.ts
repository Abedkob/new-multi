/**
 * The catalogue sheet's pure core (pnpm verify:sheet).
 *
 * No server, no database, no file, no browser, no `.env`. That is what the split in
 * `lib/catalogue-sheet/` buys: a CSV reader and a row validator take strings and return data, so a
 * hundred malformed inputs cost a line each. Anything here that needed a store to assert would be
 * a sign the rule is in the wrong file.
 *
 * Two kinds of check, and the second kind is the one that earns its keep:
 *
 *  - **Tables of inputs**, one line per rule, each naming the mistake a merchant actually makes.
 *  - **Properties**, which hold for inputs nobody thought to write down — a round trip through the
 *    CSV writer and reader, and the invariant that no sheet rule can ever let a value past a limit
 *    the product form itself enforces.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";

import {
  BLANK_RULE,
  MAX_OPTION_PAIRS,
  OPTION_PAIRS_IN_TEMPLATE,
  SHEET_NAMES,
  headerAliases,
  mapHeaderRow,
  normalizeHeader,
  productSheetColumns,
  stockSheetColumns,
  variantSheetColumns,
} from "../lib/catalogue-sheet/columns";
import { parseCsv, sniffDelimiter, writeCsv } from "../lib/catalogue-sheet/csv";
import {
  MAX_SHEET_ROWS,
  buildWorkbook,
  readWorkbook,
  type ExportProduct,
  type ExportStockLine,
  type ExportVariant,
} from "../lib/catalogue-sheet/workbook";
import {
  matchKeyOf,
  parseCatalogueSheets,
  parseProductSheet,
  parseStockSheet,
  parseVariantSheet,
} from "../lib/catalogue-sheet/parse";
import { LOCALES } from "../lib/i18n/types";
import { MAX_STOCK } from "../lib/variants";

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
}
async function acheck(name: string, fn: () => Promise<void>) {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
}

/** The products sheet as a grid, with a header row the reader has to recognise. */
function productGrid(rows: string[][], headers?: string[]): string[][] {
  return [headers ?? productSheetColumns().map((c) => c.header.en), ...rows];
}
function variantGrid(rows: string[][]): string[][] {
  return [variantSheetColumns().map((c) => c.header.en), ...rows];
}
function stockGrid(rows: string[][]): string[][] {
  return [stockSheetColumns().map((c) => c.header.en), ...rows];
}

/** `name, description, price, category, best seller, warn at` */
const product = (name: string, price = "10", rest: string[] = []) => [name, "", price, ...rest];

async function main() {
  console.log("The column definition:");

  check("every column has a key, both languages, and help in both", () => {
    const all = [...productSheetColumns(), ...variantSheetColumns(MAX_OPTION_PAIRS), ...stockSheetColumns(MAX_OPTION_PAIRS)];
    for (const column of all) {
      assert.ok(column.key, "a column with no key cannot be parsed into anything");
      for (const locale of LOCALES) {
        assert.ok(column.header[locale]?.trim(), `${column.key} has no ${locale} header`);
        assert.ok(column.help[locale]?.trim(), `${column.key} has no ${locale} help`);
      }
    }
    // The help text is what a merchant reads instead of asking us, so it is held to a length that
    // means a real sentence rather than a restated header.
    for (const column of all) {
      assert.ok(column.help.en.length > 25, `${column.key}'s English help says too little`);
      assert.ok(column.help.ar.length > 20, `${column.key}'s Arabic help says too little`);
    }
    for (const locale of LOCALES) {
      assert.ok(BLANK_RULE[locale].length > 60, `the blank rule is not stated in ${locale}`);
      for (const sheet of Object.values(SHEET_NAMES)) {
        assert.ok(sheet[locale]?.trim(), "a sheet has no name in one language");
      }
    }
  });

  check("no two columns of one sheet share a header in either language", () => {
    for (const columns of [productSheetColumns(), variantSheetColumns(MAX_OPTION_PAIRS), stockSheetColumns(MAX_OPTION_PAIRS)]) {
      const seen = new Map<string, string>();
      for (const column of columns) {
        // A column's own three aliases may coincide (`description` is both its English header and
        // its key); what must never happen is two DIFFERENT columns answering to one spelling.
        for (const alias of new Set(headerAliases(column))) {
          const clash = seen.get(alias);
          // A shared header means `mapHeaderRow` resolves one of the two columns to the other's
          // cell, silently — the merchant fills in Price and the importer reads it as a stock
          // figure. First-occurrence-wins makes that quiet rather than loud, so it is refused here.
          assert.ok(
            clash === undefined || clash === column.key,
            `${column.key} and ${clash} both answer to "${alias}"`,
          );
          seen.set(alias, column.key);
        }
      }
    }
  });

  check("a header is matched case-folded, space-collapsed and in Arabic", () => {
    const columns = productSheetColumns();
    const map = mapHeaderRow(["  PRODUCT ", "الوصف", "price", "Category", "best seller", "warnAt"], columns);
    assert.deepEqual([...map.keys()].sort(), ["bestSeller", "category", "description", "name", "price", "warnAt"]);
    assert.equal(normalizeHeader("Option 1 name"), normalizeHeader("option  1  NAME"));
    // Arabic diacritics and the tatweel: a header typed by hand will not match a generated one byte
    // for byte, and a merchant does not get told their own language is spelled wrong.
    assert.equal(normalizeHeader("المنتـــج"), normalizeHeader("المنتج"));
  });

  check("an unknown column is ignored, not refused", () => {
    // A merchant's own "Supplier" note column must not reject the file, and the export deliberately
    // carries a read-only column (`On the shelf now`) that the importer ignores.
    const grid = productGrid([["Mug", "", "9.99", "", "", "", "Acme Ltd"]], [
      "Product", "Description", "Price", "Category", "Best seller", "Warn me at", "Supplier",
    ]);
    const { rows, issues } = parseProductSheet(grid);
    assert.equal(issues.length, 0);
    assert.equal(rows[0].name, "Mug");
  });

  check("a missing required column is one whole-sheet complaint, not one per row", () => {
    const grid = [["Product", "Description"], ["Mug", "x"], ["Bowl", "y"]];
    const { rows, issues } = parseProductSheet(grid);
    assert.equal(rows.length, 0);
    assert.equal(issues.length, 1, "500 rows must not produce 500 identical complaints");
    assert.equal(issues[0].row, null);
    assert.match(issues[0].message, /^import\.sheet\.missingColumn/);
  });

  check("a sheet with no recognisable header says so once", () => {
    const { rows, issues } = parseProductSheet([["my stuff"], ["Mug", "9.99"]]);
    assert.equal(rows.length, 0);
    assert.deepEqual(issues, [{ sheet: "products", row: null, message: "import.sheet.noHeader" }]);
  });

  check("a header below a title row still works, and row numbers stay honest", () => {
    const grid = [
      ["Demo Boutique — catalogue"],
      [],
      productSheetColumns().map((c) => c.header.en),
      product("Mug", "9.99"),
    ];
    const { rows, issues } = parseProductSheet(grid);
    assert.equal(issues.length, 0);
    // Row 4 in the spreadsheet's own numbering, which is the number the merchant is told.
    assert.equal(rows[0].row, 4, "a row number a merchant cannot find in Excel is useless");
  });

  console.log("\nCSV, as real spreadsheets write it:");

  check("quoted commas, embedded newlines and doubled quotes", () => {
    const text = 'Product,Description\n"Mug, large","Holds ""a lot""\nof tea"\n';
    assert.deepEqual(parseCsv(text), [
      ["Product", "Description"],
      ["Mug, large", 'Holds "a lot"\nof tea'],
    ]);
  });

  check("a BOM, CRLF and a lone CR", () => {
    assert.deepEqual(parseCsv("﻿a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
    assert.deepEqual(parseCsv("a,b\rc,d"), [["a", "b"], ["c", "d"]]);
    // Without the BOM strip the first header cell is "﻿Product", which matches nothing — the
    // whole file then reads as unknown columns and the merchant is told their template is wrong.
    const { issues } = parseProductSheet(parseCsv(`﻿${writeCsv([["Product", "Price"], ["Mug", "9.99"]], { bom: false })}`));
    assert.equal(issues.length, 0);
  });

  check("a trailing newline does not invent a blank final row", () => {
    assert.equal(parseCsv("a,b\nc,d\n").length, 2);
    assert.equal(parseCsv("a,b\nc,d").length, 2);
    // But a genuinely blank line in the middle is a row, because the parser must not decide that
    // for the caller — `parse.ts` skips blank rows, and it is the only place that should.
    assert.equal(parseCsv("a,b\n\nc,d\n").length, 3);
  });

  check("a semicolon or tab delimiter is sniffed, not configured", () => {
    // Excel writes the system list separator, which is `;` across most of Europe and the Middle
    // East. A merchant there saves as CSV and gets semicolons without ever choosing them.
    assert.equal(sniffDelimiter("Product;Price;Category"), ";");
    assert.equal(sniffDelimiter("Product\tPrice\tCategory"), "\t");
    assert.equal(sniffDelimiter("Product,Price,Category"), ",");
    assert.deepEqual(parseCsv("Product;Price\nMug;9.99"), [["Product", "Price"], ["Mug", "9.99"]]);
    // Separators inside quotes are decoys: this header has ONE real separator and two commas.
    assert.equal(sniffDelimiter('"Product, size, colour";Price'), ";");
  });

  check("an empty document and a single cell", () => {
    assert.deepEqual(parseCsv(""), []);
    assert.deepEqual(parseCsv("﻿"), []);
    assert.deepEqual(parseCsv("Mug"), [["Mug"]]);
  });

  check("writing then reading is the identity, for everything awkward", () => {
    const grid = [
      ["Product", "Description"],
      ["Mug, large", 'Holds "a lot"'],
      ["قميص كتان", "وصف\nعلى سطرين"],
      [" padded ", ""],
      ["semi;colon", "tab\there"],
    ];
    assert.deepEqual(parseCsv(writeCsv(grid)), grid);
    // And with each delimiter, since the writer quotes based on which one it used.
    for (const delimiter of [",", ";", "\t"] as const) {
      assert.deepEqual(parseCsv(writeCsv(grid, { delimiter }), delimiter), grid);
    }
  });

  check("a cell that Excel would execute is neutralised on write", () => {
    // A shop's own catalogue gets exported, mailed to an accountant, and opened. `=cmd|...` in a
    // product name is a formula to Excel; prefixed with a tab it is text, and Excel hides the tab.
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "=cmd|' /C calc'!A0"]) {
      const written = writeCsv([[dangerous]]);
      assert.ok(!written.includes(`﻿${dangerous}`), `${dangerous} was written unguarded`);
      assert.equal(parseCsv(written)[0][0], `\t${dangerous}`, "and it still reads back as that text");
    }
    assert.equal(parseCsv(writeCsv([["9.99"]]))[0][0], "9.99", "an ordinary value is untouched");
  });

  check("a BOM is written by default, because Excel needs it for Arabic", () => {
    assert.ok(writeCsv([["قميص"]]).startsWith("﻿"));
    assert.ok(!writeCsv([["قميص"]], { bom: false }).startsWith("﻿"));
  });

  console.log("\nProduct rows:");

  const priceCases: [string, number | null][] = [
    ["9.99", 999],
    ["9", 900],
    ["9.5", 950],
    ["$1,299.50", 129_950],
    [" 10 ", 1000],
    ["٩٩", 9900],
    ["٩٫٥٠", 950],
    ["0", 0],
    ["12.3.4", null],
    ["9.999", null],
    ["abc", null],
    ["-5", null],
    ["", null],
    ["1e3", null],
  ];
  check(`${priceCases.length} price shapes, good and bad`, () => {
    for (const [input, expected] of priceCases) {
      const { rows, issues } = parseProductSheet(productGrid([product("Mug", input)]));
      if (expected === null) {
        assert.equal(rows.length, 0, `"${input}" should not have become a product`);
        assert.deepEqual(issues, [{ sheet: "products", row: 2, message: "validation.price.invalidOrEmpty" }], `"${input}"`);
      } else {
        assert.equal(issues.length, 0, `"${input}" was refused: ${JSON.stringify(issues)}`);
        assert.equal(rows[0].priceCents, expected, `"${input}"`);
      }
    }
  });

  check("a price above the form's own ceiling is refused here too", () => {
    const { rows, issues } = parseProductSheet(productGrid([product("Mug", "1000000.01")]));
    assert.equal(rows.length, 0);
    assert.equal(issues[0].message, "validation.price.invalidOrEmpty");
    // The form's limit is 100,000,000 cents, and one cent under it must still pass or the sheet
    // would be refusing what the form accepts.
    assert.equal(parseProductSheet(productGrid([product("Mug", "1000000")])).rows[0].priceCents, 100_000_000);
  });

  check("blank means leave it alone, on every optional column", () => {
    const { rows, issues } = parseProductSheet(productGrid([["Mug", "", "9.99", "", "", ""]]));
    assert.equal(issues.length, 0);
    const row = rows[0];
    // Not "", not false, not 0 — `null` is the signal the writer needs to leave the field out of
    // its update payload entirely. `false` and `0` are real values a merchant can also mean.
    assert.equal(row.description, null);
    assert.equal(row.categoryPath, null);
    assert.equal(row.bestSeller, null);
    assert.equal(row.warnAt, null);
  });

  check("an entirely blank row is skipped in silence", () => {
    const grid = productGrid([product("Mug", "9.99"), [], ["", "", "", "", "", ""], product("Bowl", "4")]);
    const { rows, issues } = parseProductSheet(grid);
    assert.equal(issues.length, 0, "a spreadsheet is full of blank rows and none of them is a mistake");
    assert.deepEqual(rows.map((r) => r.name), ["Mug", "Bowl"]);
    assert.deepEqual(rows.map((r) => r.row), [2, 5], "and the numbering still points at the real rows");
  });

  check("a row with a price but no name is a complaint, not a skip", () => {
    const { rows, issues } = parseProductSheet(productGrid([["", "", "9.99", "", "", ""]]));
    assert.equal(rows.length, 0);
    assert.deepEqual(issues, [{ sheet: "products", row: 2, message: "validation.name.required" }]);
  });

  const boolCases: [string, boolean | null | "err"][] = [
    ["yes", true], ["Yes", true], ["TRUE", true], ["1", true], ["y", true], ["نعم", true],
    ["no", false], ["No", false], ["false", false], ["0", false], ["n", false], ["لا", false],
    ["", null], ["maybe", "err"], ["2", "err"], ["نعم لا", "err"],
  ];
  check(`${boolCases.length} yes/no values, in both languages`, () => {
    for (const [input, expected] of boolCases) {
      const { rows, issues } = parseProductSheet(productGrid([["Mug", "", "9", "", input, ""]]));
      if (expected === "err") {
        assert.deepEqual(issues, [{ sheet: "products", row: 2, message: "import.issue.notYesOrNo" }], `"${input}"`);
      } else {
        assert.equal(issues.length, 0, `"${input}" was refused`);
        assert.equal(rows[0].bestSeller, expected, `"${input}"`);
      }
    }
  });

  const wholeCases: [string, number | null][] = [
    ["0", 0], ["5", 5], ["12.0", 12], ["1,000", 1000], [" 7 ", 7], ["٥", 5],
    ["12.5", null], ["-1", null], ["abc", null], [String(MAX_STOCK + 1), null],
  ];
  check(`${wholeCases.length} whole-number values, as a spreadsheet hands them over`, () => {
    for (const [input, expected] of wholeCases) {
      const { rows, issues } = parseProductSheet(productGrid([["Mug", "", "9", "", "", input]]));
      if (expected === null) {
        assert.deepEqual(issues, [{ sheet: "products", row: 2, message: "import.issue.notAWholeNumber" }], `"${input}"`);
      } else {
        // "12.0" is accepted because a numeric Excel cell read as text arrives that way, and a
        // merchant who typed 12 would be baffled to be told 12 is not a whole number.
        assert.equal(issues.length, 0, `"${input}" was refused`);
        assert.equal(rows[0].warnAt, expected, `"${input}"`);
      }
    }
    // 0 is a real threshold ("warn me only when it runs out"), distinguishable from blank.
    assert.equal(parseProductSheet(productGrid([["Mug", "", "9", "", "", "0"]])).rows[0].warnAt, 0);
    assert.equal(parseProductSheet(productGrid([["Mug", "", "9", "", "", ""]])).rows[0].warnAt, null);
  });

  check("a category is one column holding the whole path", () => {
    const cases: [string, string[] | null][] = [
      ["Clothing", ["Clothing"]],
      ["Clothing / Shirts", ["Clothing", "Shirts"]],
      ["Clothing/Shirts", ["Clothing", "Shirts"]],
      ["Clothing > Shirts", ["Clothing", "Shirts"]],
      ["Clothing / Shirts / ", ["Clothing", "Shirts"]],
      ["ملابس / قمصان", ["ملابس", "قمصان"]],
      ["a / b / c / d", ["a", "b", "c", "d"]],
      ["a / b / c / d / e", null],
      ["Men / / Shirts", null],
      ["/", null],
      [`${"x".repeat(81)}`, null],
    ];
    for (const [input, expected] of cases) {
      const { rows, issues } = parseProductSheet(productGrid([["Mug", "", "9", input, "", ""]]));
      if (expected === null) {
        assert.equal(rows.length, 0, `"${input}" should have been refused`);
        assert.match(issues[0].message, /^import\.issue\.categoryInvalid/, `"${input}"`);
      } else {
        assert.equal(issues.length, 0, `"${input}" was refused: ${JSON.stringify(issues)}`);
        assert.deepEqual(rows[0].categoryPath, expected, `"${input}"`);
      }
    }
  });

  check("the name and description ceilings are the product form's own", () => {
    assert.equal(parseProductSheet(productGrid([product("x".repeat(120))])).rows.length, 1);
    const tooLong = parseProductSheet(productGrid([product("x".repeat(121))]));
    assert.equal(tooLong.rows.length, 0);
    assert.equal(tooLong.issues[0].message, "import.issue.nameTooLong");
    assert.equal(parseProductSheet(productGrid([["Mug", "d".repeat(5000), "9", "", "", ""]])).rows.length, 1);
    assert.equal(
      parseProductSheet(productGrid([["Mug", "d".repeat(5001), "9", "", "", ""]])).issues[0].message,
      "import.issue.descriptionTooLong",
    );
  });

  console.log("\nMatching by name, which is the risk the user accepted:");

  check("the match key folds case and collapses inner whitespace", () => {
    assert.equal(matchKeyOf("Linen Shirt"), matchKeyOf("linen  shirt"));
    assert.equal(matchKeyOf(" Linen\tShirt "), matchKeyOf("Linen Shirt"));
    // The whole mitigation in one line: this is what stops `Linen shirt` becoming a SECOND product
    // beside `Linen Shirt` on a re-import. It cannot stop a real rename, which is why the preview
    // is mandatory.
    assert.notEqual(matchKeyOf("Linen Shirt"), matchKeyOf("Linen Shirts"));
    assert.equal(matchKeyOf("قميص  كتان"), matchKeyOf("قميص كتان"));
  });

  check("two rows for one product are refused, naming the row they collide with", () => {
    const grid = productGrid([product("Linen Shirt", "20"), product("Bowl", "4"), product("linen  shirt", "25")]);
    const { rows, issues } = parseProductSheet(grid);
    // Applying the last would silently discard the first, and applying the first would silently
    // discard an edit the merchant made. Neither is a guess worth making.
    assert.deepEqual(rows.map((r) => r.name), ["Linen Shirt", "Bowl"]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].row, 4);
    assert.match(issues[0].message, /^import\.issue\.duplicateProductRow/);
    assert.ok(issues[0].message.endsWith("2"), "it must name row 2, the one that already claimed the name");
  });

  console.log("\nOption rows:");

  check("both option cells blank is the single default variant", () => {
    const { rows, issues } = parseVariantSheet(variantGrid([["Mug", "", "", "", "", "", "", "5", ""]]));
    assert.equal(issues.length, 0);
    assert.deepEqual(rows[0].attributes, {});
    assert.equal(rows[0].stock, 5);
  });

  check("one half of an option pair is refused rather than guessed", () => {
    for (const row of [
      ["Mug", "Size", "", "", "", "", "", "", ""],
      ["Mug", "", "M", "", "", "", "", "", ""],
    ]) {
      const { rows, issues } = parseVariantSheet(variantGrid([row]));
      assert.equal(rows.length, 0);
      assert.equal(issues[0].message, "validation.attributes.needNameAndValue");
    }
  });

  check("a second and third option pair are read into one attribute set", () => {
    const { rows, issues } = parseVariantSheet(
      variantGrid([["Shirt", "Size", "M", "Colour", "Blue", "Fit", "Slim", "3", "25"]]),
    );
    assert.equal(issues.length, 0);
    assert.deepEqual(rows[0].attributes, { Size: "M", Colour: "Blue", Fit: "Slim" });
    assert.equal(rows[0].priceOverrideCents, 2500);
  });

  check("a repeated option name on one row is refused", () => {
    const { rows, issues } = parseVariantSheet(
      variantGrid([["Shirt", "Size", "M", "size", "L", "", "", "", ""]]),
    );
    assert.equal(rows.length, 0);
    assert.match(issues[0].message, /^validation\.attributes\.duplicate/);
  });

  check("a variant row with no product is refused, never attached to the row above", () => {
    const grid = variantGrid([
      ["Shirt", "Size", "M", "", "", "", "", "3", ""],
      ["", "Size", "L", "", "", "", "", "4", ""],
    ]);
    const { rows, issues } = parseVariantSheet(grid);
    // Sorting or filtering the sheet would reattach a blank row to a different product, so a
    // silently mis-filed variant is far worse than a refused row with a number on it.
    assert.deepEqual(rows.map((r) => r.attributes.Size), ["M"]);
    assert.deepEqual(issues, [{ sheet: "variants", row: 3, message: "import.issue.variantNeedsProduct" }]);
  });

  check("the same option twice for one product is refused", () => {
    const grid = variantGrid([
      ["Shirt", "Size", "M", "", "", "", "", "3", ""],
      ["Shirt", "Size", "m", "", "", "", "", "4", ""],
    ]);
    const { rows, issues } = parseVariantSheet(grid);
    assert.equal(rows.length, 1);
    assert.match(issues[0].message, /^products\.variant\.duplicateOf/);
    assert.ok(issues[0].message.endsWith("2"));
  });

  check("the same option for two different products is fine", () => {
    const grid = variantGrid([
      ["Shirt", "Size", "M", "", "", "", "", "3", ""],
      ["Trousers", "Size", "M", "", "", "", "", "4", ""],
    ]);
    assert.equal(parseVariantSheet(grid).issues.length, 0);
  });

  check("variant stock and override obey the same number rules", () => {
    const bad = parseVariantSheet(variantGrid([["Mug", "", "", "", "", "", "", "2.5", ""]]));
    assert.equal(bad.issues[0].message, "import.issue.notAWholeNumber");
    const badPrice = parseVariantSheet(variantGrid([["Mug", "", "", "", "", "", "", "", "9.999"]]));
    assert.equal(badPrice.issues[0].message, "validation.price.invalidOrEmpty");
    const blank = parseVariantSheet(variantGrid([["Mug", "", "", "", "", "", "", "", ""]]));
    assert.equal(blank.issues.length, 0);
    assert.equal(blank.rows[0].stock, null, "blank stock is 'leave it alone', not zero");
    assert.equal(blank.rows[0].priceOverrideCents, null);
  });

  console.log("\nA product's variants judged as a set, which is why the two sheets parse together:");

  check("variants disagreeing about their option NAMES reject the whole product", () => {
    const parsed = parseCatalogueSheets({
      products: productGrid([product("Shirt", "20"), product("Mug", "9")]),
      variants: variantGrid([
        ["Shirt", "Size", "M", "", "", "", "", "3", ""],
        ["Shirt", "Colour", "Blue", "", "", "", "", "4", ""],
        ["Mug", "", "", "", "", "", "", "5", ""],
      ]),
    });
    // Not "import the subset that agrees": that would build a catalogue the merchant did not
    // describe, and an update would silently leave the real variants alone while reporting success.
    assert.deepEqual(parsed.products.map((p) => p.name), ["Mug"]);
    assert.deepEqual(parsed.variants.map((v) => v.productName), ["Mug"]);
    assert.deepEqual(parsed.rejectedProducts, [matchKeyOf("Shirt")]);
    const issue = parsed.issues.find((i) => i.message === "products.variant.sameAttributeNames");
    assert.ok(issue, `expected the form's own message, got ${JSON.stringify(parsed.issues)}`);
    assert.equal(issue.row, 3, "and it must point at the row that disagreed");
  });

  check("one attribute-less variant among several rejects the product", () => {
    const parsed = parseCatalogueSheets({
      products: productGrid([product("Shirt", "20")]),
      variants: variantGrid([
        ["Shirt", "Size", "M", "", "", "", "", "3", ""],
        ["Shirt", "", "", "", "", "", "", "4", ""],
      ]),
    });
    assert.equal(parsed.variants.length, 0);
    assert.ok(parsed.issues.some((i) => i.message === "products.variant.needAttribute"));
  });

  check("a product with no variant rows at all is left to the writer", () => {
    // Legitimate: a products-only sheet repricing forty items must not be told its variants are
    // missing. Creating such a product needs a default variant, which is the writer's business.
    const parsed = parseCatalogueSheets({ products: productGrid([product("Mug", "9")]) });
    assert.equal(parsed.products.length, 1);
    assert.equal(parsed.variants.length, 0);
    assert.deepEqual(parsed.issues, []);
  });

  check("a variants-only sheet parses, for a stock-in on existing products", () => {
    const parsed = parseCatalogueSheets({ variants: variantGrid([["Mug", "", "", "", "", "", "", "5", ""]]) });
    assert.equal(parsed.products.length, 0);
    assert.equal(parsed.variants.length, 1);
    assert.deepEqual(parsed.issues, []);
  });

  console.log("\nThe stock count sheet, where blank means something different:");

  check("a blank count is skipped, and 0 is a real count", () => {
    const grid = stockGrid([
      ["Mug", "", "", "", "", "", "", "12", "0"],
      ["Bowl", "", "", "", "", "", "", "4", ""],
      ["Plate", "", "", "", "", "", "", "9", "7"],
    ]);
    const { rows, issues } = parseStockSheet(grid);
    assert.equal(issues.length, 0, "an exported count sheet arrives with every line blank by design");
    assert.deepEqual(rows.map((r) => [r.productName, r.counted]), [["Mug", 0], ["Plate", 7]]);
  });

  check("the 'on the shelf now' column is read-only in both directions", () => {
    // It exists so the merchant can see what they are checking against. Whatever they type in it is
    // ignored — the live figure is re-read under a row lock at apply time (D94), never taken from
    // the sheet, or two people counting at once would overwrite each other.
    const { rows } = parseStockSheet(stockGrid([["Mug", "", "", "", "", "", "", "999", "4"]]));
    assert.equal(rows[0].counted, 4);
    assert.ok(!("onHand" in rows[0]), "the parsed row must not even carry it");
  });

  check("two counts of one shelf are refused rather than ordered by guesswork", () => {
    const grid = stockGrid([
      ["Shirt", "Size", "M", "", "", "", "", "", "3"],
      ["Shirt", "size", "m", "", "", "", "", "", "5"],
    ]);
    const { rows, issues } = parseStockSheet(grid);
    assert.equal(rows.length, 1);
    assert.match(issues[0].message, /^import\.issue\.duplicateCountRow/);
  });

  check("a count sheet needs only a product and a figure", () => {
    const { rows, issues } = parseStockSheet([["Product", "Counted"], ["Mug", "6"]]);
    assert.equal(issues.length, 0);
    assert.equal(rows[0].counted, 6);
    const missing = parseStockSheet([["Product", "Option 1 name"], ["Mug", "Size"]]);
    assert.equal(missing.issues.length, 1);
    assert.match(missing.issues[0].message, /^import\.sheet\.missingColumn/);
  });

  console.log("\nProperties, which hold for inputs nobody wrote down:");

  check("a full round trip through CSV preserves every parsed field", () => {
    const grid = productGrid([
      ["قميص كتان", "وصف, مع فاصلة", "٩٩٫٥٠", "ملابس / قمصان", "نعم", "3"],
      ['Mug "large"', "Holds\na lot", "$1,299.50", "Kitchen", "no", "0"],
    ]);
    const before = parseProductSheet(grid);
    const after = parseProductSheet(parseCsv(writeCsv(grid)));
    assert.equal(before.issues.length, 0, JSON.stringify(before.issues));
    assert.deepEqual(after.rows, before.rows, "the CSV layer must be transparent to the parser");
    assert.equal(after.rows[0].priceCents, 9950, "Arabic-Indic digits and the Arabic decimal mark");
    assert.equal(after.rows[0].bestSeller, true);
    assert.deepEqual(after.rows[0].categoryPath, ["ملابس", "قمصان"]);
  });

  check("every issue message is a dictionary key, never English prose", () => {
    const all = [
      ...parseProductSheet(productGrid([
        ["", "", "9", "", "", ""],
        product("x".repeat(200)),
        product("A", "zz"),
        ["B", "d".repeat(6000), "9", "", "", ""],
        ["C", "", "9", "/", "", ""],
        ["D", "", "9", "", "maybe", ""],
        ["E", "", "9", "", "", "-1"],
        product("A", "9"),
      ])).issues,
      ...parseProductSheet([["Product", "Description"], ["Mug", "x"]]).issues,
      ...parseProductSheet([["nothing", "recognisable"]]).issues,
      ...parseVariantSheet(variantGrid([
        ["", "Size", "M", "", "", "", "", "", ""],
        ["Mug", "Size", "", "", "", "", "", "", ""],
        ["Mug", "S", "x".repeat(200), "", "", "", "", "", ""],
        ["Mug", "Size", "M", "size", "L", "", "", "", ""],
        ["Mug", "", "", "", "", "", "", "2.5", ""],
        ["Mug", "", "", "", "", "", "", "", "zz"],
      ])).issues,
      ...parseStockSheet(stockGrid([
        ["", "", "", "", "", "", "", "", "3"],
        ["Mug", "", "", "", "", "", "", "", "x"],
        ["Mug", "", "", "", "", "", "", "", "1"],
        ["Mug", "", "", "", "", "", "", "", "2"],
      ])).issues,
      ...parseCatalogueSheets({
        variants: variantGrid([
          ["S", "Size", "M", "", "", "", "", "", ""],
          ["S", "Colour", "B", "", "", "", "", "", ""],
        ]),
      }).issues,
    ];
    // Deliberately wide: this is the one check that sees every message the module can produce, so
    // a new rule added with an English string in it has to get past this.
    assert.ok(all.length >= 15, `the probe produced only ${all.length} complaints`);
    for (const issue of all) {
      const key = issue.message.split("\u0001")[0];
      // Half the merchants read Arabic. An English string baked into the parser reaches them
      // untranslated, which is why every message here is a key the dictionaries resolve.
      assert.match(
        key,
        /^(import\.(sheet|issue)|validation|products\.variant)\.[A-Za-z0-9.]+$/,
        `"${issue.message}" is not a dictionary key`,
      );
      assert.ok(!/\s/.test(key), `"${key}" looks like a sentence`);
    }
  });

  check("one bad row produces exactly one complaint, not a pile", () => {
    // The same rule the delivery-fee field was fixed to obey: a field gives ONE verdict. A row
    // where the name, the price, the category and the flag are all wrong must not hand the merchant
    // four messages about one line — they fix the first thing and re-upload anyway.
    const awful = productGrid([["", "d".repeat(6000), "12.3.4", "a/b/c/d/e", "maybe", "-1"]]);
    assert.equal(parseProductSheet(awful).issues.length, 1);
    const awfulVariant = variantGrid([["", "Size", "", "size", "L", "", "", "2.5", "zz"]]);
    assert.equal(parseVariantSheet(awfulVariant).issues.length, 1);
  });

  check("one row's mistake never costs another row", () => {
    // "Import the good rows, report the rest" is what the user chose over all-or-nothing, so this
    // is the behaviour that choice rests on.
    const grid = productGrid([
      product("Good One", "9.99"),
      product("Bad Price", "12.3.4"),
      product("Good Two", "4"),
      ["", "", "5", "", "", ""],
      product("Good Three", "٥"),
    ]);
    const { rows, issues } = parseProductSheet(grid);
    assert.deepEqual(rows.map((r) => r.name), ["Good One", "Good Two", "Good Three"]);
    assert.deepEqual(issues.map((i) => i.row), [3, 5]);
  });

  check("the template is narrower than the reader, deliberately", () => {
    // Three option pairs on the sheet a merchant gets; ten accepted on read, which is
    // `variantInputSchema`'s own limit. A merchant who needs a fourth adds the columns and the
    // importer reads them, without us shipping a sheet that looks like a form nobody can fill in.
    assert.ok(OPTION_PAIRS_IN_TEMPLATE < MAX_OPTION_PAIRS);
    assert.equal(variantSheetColumns().length, 1 + OPTION_PAIRS_IN_TEMPLATE * 2 + 2);
    const wide = [
      ["Product", ...Array.from({ length: MAX_OPTION_PAIRS }, (_, i) => [`Option ${i + 1} name`, `Option ${i + 1} value`]).flat(), "Counted"],
      ["Mug", ...Array.from({ length: MAX_OPTION_PAIRS }, (_, i) => [`K${i}`, `V${i}`]).flat(), "3"],
    ];
    const { rows, issues } = parseStockSheet(wide);
    assert.equal(issues.length, 0);
    assert.equal(Object.keys(rows[0].attributes).length, MAX_OPTION_PAIRS);
    // An eleventh pair is simply not read, rather than refused: the row is still valid, and
    // `variantInputSchema` would refuse eleven anyway.
    const tooWide = [[...wide[0].slice(0, -1), "Option 11 name", "Option 11 value", "Counted"], [...wide[1].slice(0, -1), "K10", "V10", "3"]];
    assert.equal(Object.keys(parseStockSheet(tooWide).rows[0].attributes).length, MAX_OPTION_PAIRS);
  });

  check("the pure modules stay pure", () => {
    // The reason a hundred malformed inputs cost a line each. A database import here, and this
    // suite needs two throwaway stores to find out what `12.3.4` does.
    for (const file of ["lib/catalogue-sheet/parse.ts", "lib/catalogue-sheet/csv.ts", "lib/catalogue-sheet/columns.ts"]) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of ["@/lib/prisma", "withTenant", "process.env", "node:fs", "exceljs", "@/lib/env"]) {
        assert.ok(!source.includes(forbidden), `${file} must not reach for ${forbidden}`);
      }
    }
    // And the quarantine holds from the other side: exactly one file may import the library.
    const importers = ["parse.ts", "csv.ts", "columns.ts", "workbook.ts"].filter((f) =>
      readFileSync(`lib/catalogue-sheet/${f}`, "utf8").includes('from "exceljs"'),
    );
    assert.deepEqual(importers, ["workbook.ts"], "the spreadsheet library has escaped its one file");
  });

  console.log("\nThe workbook, written and read back:");

  const CATEGORIES = ["Clothing", "Clothing / Shirts", "Kitchen"];
  const EXPORTED: {
    products: ExportProduct[];
    variants: ExportVariant[];
    stock: ExportStockLine[];
  } = {
    products: [
      {
        name: "Linen Shirt",
        description: "Light, with a comma, and\na second line",
        priceCents: 12_999,
        categoryPath: ["Clothing", "Shirts"],
        bestSeller: true,
        warnAt: 3,
      },
      { name: "قميص كتان", description: "", priceCents: 950, categoryPath: null, bestSeller: false, warnAt: null },
      { name: 'Mug "large"', description: "", priceCents: 0, categoryPath: ["Kitchen"], bestSeller: false, warnAt: 0 },
    ],
    variants: [
      { productName: "Linen Shirt", attributes: { Size: "M", Colour: "Blue" }, stock: 4, priceOverrideCents: 13_500 },
      { productName: "Linen Shirt", attributes: { Size: "L", Colour: "Blue" }, stock: 2, priceOverrideCents: null },
      { productName: "قميص كتان", attributes: {}, stock: 7, priceOverrideCents: null },
    ],
    stock: [
      { productName: "Linen Shirt", attributes: { Size: "M", Colour: "Blue" }, onHand: 4 },
      { productName: "قميص كتان", attributes: {}, onHand: 7 },
    ],
  };

  await acheck("a blank template is a real xlsx whose every sheet the reader recognises", async () => {
    const buffer = await buildWorkbook({
      locale: "en",
      storeName: "Demo Boutique",
      categoryPaths: CATEGORIES,
      productNames: ["Linen Shirt"],
    });
    assert.equal(buffer.subarray(0, 2).toString(), "PK", "an xlsx is a zip; this is not one");
    const { sheets, truncated, sheetNames } = await readWorkbook(buffer);
    assert.equal(truncated, false);
    assert.deepEqual(Object.keys(sheets).sort(), ["products", "stock", "variants"]);
    // The Instructions sheet must be FIRST, because it is the thing a merchant opening the file
    // has not read yet, and the hidden Lists sheet must not be offered as a sheet to fill in.
    assert.equal(sheetNames[0], SHEET_NAMES.instructions.en);
    assert.ok(sheetNames.includes(SHEET_NAMES.lists.en));
    // Headers recognised, no rows, no complaints: a blank template is not an error.
    const parsed = parseCatalogueSheets({ products: sheets.products, variants: sheets.variants });
    assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));
    assert.equal(parsed.products.length, 0);
    assert.deepEqual(parseStockSheet(sheets.stock!).issues, []);
  });

  await acheck("an export, read back and parsed, is exactly what went in", async () => {
    const buffer = await buildWorkbook({
      locale: "en",
      storeName: "Demo Boutique",
      categoryPaths: CATEGORIES,
      productNames: EXPORTED.products.map((p) => p.name),
      ...EXPORTED,
    });
    const { sheets } = await readWorkbook(buffer);
    const parsed = parseCatalogueSheets({ products: sheets.products, variants: sheets.variants });
    assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));

    // One assertion covering the writer, the reader, the column definition and the parser at once
    // — and the reason all four read `columns.ts`. A column added to one and not another dies here.
    assert.deepEqual(
      parsed.products.map((p) => ({
        name: p.name,
        description: p.description ?? "",
        priceCents: p.priceCents,
        categoryPath: p.categoryPath,
        bestSeller: p.bestSeller,
        warnAt: p.warnAt,
      })),
      EXPORTED.products,
    );
    assert.deepEqual(
      parsed.variants.map((v) => ({
        productName: v.productName,
        attributes: v.attributes,
        priceOverrideCents: v.priceOverrideCents,
      })),
      EXPORTED.variants.map(({ productName, attributes, priceOverrideCents }) => ({
        productName,
        attributes,
        priceOverrideCents,
      })),
    );
    // Stock is deliberately NOT round-tripped on the Options sheet: it applies only to options
    // being created, so an export leaves it blank rather than writing a figure that a re-import
    // would ignore and report — which looks exactly like a bug to the person reading the preview.
    assert.deepEqual(parsed.variants.map((v) => v.stock), [null, null, null]);
  });

  await acheck("the stock sheet exports what is on the shelf and leaves the counting to the shop", async () => {
    const buffer = await buildWorkbook({
      locale: "en",
      storeName: "Demo Boutique",
      categoryPaths: CATEGORIES,
      productNames: EXPORTED.products.map((p) => p.name),
      ...EXPORTED,
    });
    const { sheets } = await readWorkbook(buffer);
    const { rows, issues } = parseStockSheet(sheets.stock!);
    assert.deepEqual(issues, []);
    // Every `Counted` cell is blank, so nothing parses — a count sheet that arrived pre-filled
    // with the system's own figures would be a stocktake that agrees with itself by construction.
    assert.equal(rows.length, 0, "an exported count sheet must not pre-fill the count");
    // And `On the shelf now` is there to be read: the figures are in the grid even though the
    // parser drops them.
    const flat = sheets.stock!.flat().join("|");
    assert.ok(flat.includes("4") && flat.includes("7"), "the live figures must be visible");
  });

  await acheck("an Arabic workbook is Arabic throughout, and right-to-left", async () => {
    const buffer = await buildWorkbook({
      locale: "ar",
      storeName: "متجر تجريبي",
      categoryPaths: ["ملابس / قمصان"],
      productNames: ["قميص كتان"],
      products: [{ name: "قميص كتان", description: "", priceCents: 950, categoryPath: ["ملابس", "قمصان"], bestSeller: true, warnAt: null }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(SHEET_NAMES.products.ar);
    assert.ok(sheet, `the sheet must be named in Arabic; got ${workbook.worksheets.map((w) => w.name).join(", ")}`);
    // Without this the headers are Arabic and the columns run the wrong way, which is the same
    // half-translated feeling as an Arabic page with a left-aligned table.
    assert.equal(sheet.views[0]?.rightToLeft, true);
    assert.equal(workbook.getWorksheet(SHEET_NAMES.lists.ar)?.state, "hidden");

    // And the Arabic headers parse: the whole point of bilingual headers is that a merchant can
    // download in their own language, type into it, and upload it back.
    const { sheets } = await readWorkbook(buffer);
    const parsed = parseProductSheet(sheets.products!);
    assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));
    assert.equal(parsed.rows[0].bestSeller, true, "and 'نعم' reads as yes");
    assert.deepEqual(parsed.rows[0].categoryPath, ["ملابس", "قمصان"]);
  });

  await acheck("the category dropdown exists, and suggests rather than refuses", async () => {
    const buffer = await buildWorkbook({
      locale: "en",
      storeName: "Demo Boutique",
      categoryPaths: CATEGORIES,
      productNames: ["Linen Shirt"],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(SHEET_NAMES.products.en)!;
    const categoryColumn = productSheetColumns().findIndex((c) => c.key === "category") + 1;
    const validation = sheet.getCell(2, categoryColumn).dataValidation;
    assert.ok(validation, "the dropdown is the only thing .xlsx buys over a CSV here");
    assert.equal(validation.type, "list");
    assert.ok(validation.formulae?.[0]?.includes(SHEET_NAMES.lists.en), "it must point at the hidden sheet");
    // A merchant typing a brand-new category must not be blocked by a dialog we did not write:
    // this importer CREATES missing categories, so refusing the cell would refuse the feature.
    //
    // Asserted as falsy rather than `=== false` because the attribute comes back *absent* from a
    // written-then-read workbook: `showErrorMessage` defaults to false in the file format, so
    // exceljs omits it. Absent and false are the same instruction to Excel — do not block — and
    // pinning the assertion to the literal `false` would fail on a correct file.
    assert.ok(!validation.showErrorMessage, "the dropdown must suggest, not refuse");
    const bestSellerColumn = productSheetColumns().findIndex((c) => c.key === "bestSeller") + 1;
    assert.equal(sheet.getCell(2, bestSellerColumn).dataValidation?.type, "list");
  });

  await acheck("every cell shape a merchant's workbook can produce is read safely", async () => {
    // `CellValue` is nine shapes wide and `String(value)` on the object ones yields
    // "[object Object]" — which would be imported as a product name.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAMES.products.en);
    sheet.addRow(["Product", "Description", "Price"]);
    const row = sheet.addRow([]);
    row.getCell(1).value = { richText: [{ text: "Linen " }, { text: "Shirt" }] };
    row.getCell(2).value = { text: "see this", hyperlink: "https://example.com" };
    row.getCell(3).value = { formula: "1*2", result: 12.5 };
    const dates = sheet.addRow([]);
    dates.getCell(1).value = "Dated";
    dates.getCell(3).value = new Date("2026-03-09T00:00:00Z");
    const broken = sheet.addRow([]);
    broken.getCell(1).value = "Broken";
    broken.getCell(3).value = { formula: "1/0", result: undefined };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { sheets } = await readWorkbook(buffer);
    const grid = sheets.products!;
    assert.equal(grid[1][0], "Linen Shirt", "rich text must be joined, not stringified");
    assert.equal(grid[1][1], "see this", "a hyperlink's text, not its object");
    assert.equal(grid[1][2], "12.5", "a formula's cached result, never evaluated by us");
    const parsed = parseProductSheet(grid);
    assert.equal(parsed.rows[0].priceCents, 1250);
    // A date in a price column and a formula with no result are both mistakes, and both become a
    // complaint with a row number rather than a value.
    assert.deepEqual(
      parsed.issues.map((i) => [i.row, i.message]),
      [[3, "validation.price.invalidOrEmpty"], [4, "validation.price.invalidOrEmpty"]],
    );
  });

  await acheck("an export refuses to write a figure that is not one", async () => {
    // Found by running this against the real demo store: the caller read `priceCents` where the
    // column is `basePriceCents`, every price cell came out as the string "NaN", and the workbook
    // was produced and then parsed back as six numbered complaints about a file our own code had
    // written. A missing figure on the export side is our bug, and it has to stop here.
    await assert.rejects(
      () =>
        buildWorkbook({
          locale: "en",
          storeName: "Demo Boutique",
          categoryPaths: [],
          productNames: [],
          products: [
            {
              name: "Mug",
              description: "",
              priceCents: undefined as unknown as number,
              categoryPath: null,
              bestSeller: false,
              warnAt: null,
            },
          ],
        }),
      /non-numeric amount/,
    );
  });

  await acheck("a sheet called Sheet1 is identified by its headers", async () => {
    // What a merchant exporting from another system, or pasting into a fresh workbook, hands over.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Product", "Price"]);
    sheet.addRow(["Mug", 9.99]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { sheets } = await readWorkbook(buffer);
    assert.ok(sheets.products, "a file whose sheet is unnamed must still work");
    assert.equal(parseProductSheet(sheets.products).rows[0].priceCents, 999);
  });

  await acheck("a sheet longer than the cap is read to the cap and says so", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAMES.products.en);
    sheet.addRow(["Product", "Price"]);
    for (let i = 0; i < MAX_SHEET_ROWS + 20; i++) sheet.addRow([`Item ${i}`, 1]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { sheets, truncated } = await readWorkbook(buffer);
    assert.equal(truncated, true, "silently dropping rows is the worst possible outcome here");
    assert.equal(sheets.products!.length, MAX_SHEET_ROWS);
  });

  await acheck("trailing formatting is not mistaken for truncated data", async () => {
    // A merchant who styled their sheet to row 5,000 has a huge `rowCount` and nothing past row
    // 400. Warning about that would cry wolf on every file anyone has ever formatted.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAMES.products.en);
    sheet.addRow(["Product", "Price"]);
    sheet.addRow(["Mug", 9.99]);
    sheet.getCell(`A${MAX_SHEET_ROWS + 500}`).fill = {
      type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" },
    };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { truncated, sheets } = await readWorkbook(buffer);
    assert.equal(truncated, false);
    assert.equal(parseProductSheet(sheets.products!).rows.length, 1);
  });
}

main().then(
  () => console.log(`\n${checks} checks passed.`),
  (error: unknown) => {
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  },
);
