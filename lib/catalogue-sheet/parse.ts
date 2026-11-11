/**
 * A grid of strings in, typed rows and numbered complaints out. Pure: no database, no file, no
 * spreadsheet library, no request.
 *
 * That purity is the point rather than a style preference. Every rule below is a line in a table
 * in `pnpm verify:sheet` — a hundred malformed inputs cost nothing to assert when the function
 * under test takes `string[][]` and returns data. The alternative, validating inside the writer,
 * means a database and two throwaway stores to find out what happens when a merchant types
 * `12.3.4` into a price cell.
 *
 * **Every message is an i18n dictionary key**, encoded by `encodeMessage` when it interpolates, the
 * same contract as `variantSetIssues` and the zod schemas — because the person reading the complaint
 * is a merchant, half of them reading Arabic, and an English string baked in here would reach them
 * untranslated. Wherever an existing rule already has a key (`products.variant.*`,
 * `validation.*`), that key is reused so the sheet's wording matches the product form's.
 */

import { encodeMessage } from "@/lib/i18n/types";
import { parsePriceToCents } from "@/lib/validation";
import { MAX_STOCK, variantSetIssues, type Attributes, type VariantDraft } from "@/lib/variants";

import {
  MAX_OPTION_PAIRS,
  mapHeaderRow,
  productSheetColumns,
  stockSheetColumns,
  variantSheetColumns,
  type SheetColumn,
} from "./columns";

export type SheetId = "products" | "variants" | "stock";

export type SheetIssue = {
  sheet: SheetId;
  /** The row number the merchant sees in their spreadsheet. `null` for a whole-sheet problem. */
  row: number | null;
  /** An i18n dictionary key, encoded with its parameters when it has any. */
  message: string;
};

/**
 * `null` on an optional field means **the cell was blank**, which this sheet defines as "leave it
 * alone" (see `BLANK_RULE`). It never means "set this to empty".
 */
export type ProductRow = {
  row: number;
  name: string;
  /** Trimmed, inner whitespace collapsed, case-folded — what re-import matches on. */
  matchKey: string;
  description: string | null;
  priceCents: number;
  /** The full path, outermost first: `["Clothing", "Shirts"]`. */
  categoryPath: string[] | null;
  bestSeller: boolean | null;
  warnAt: number | null;
};

export type VariantRow = {
  row: number;
  productName: string;
  matchKey: string;
  /** `{}` is the single default variant of a product sold in one version. */
  attributes: Attributes;
  /** Only ever applied to a variant being created — see D90 and the plan's "Stock is not a catalogue column". */
  stock: number | null;
  priceOverrideCents: number | null;
};

export type StockRow = {
  row: number;
  productName: string;
  matchKey: string;
  attributes: Attributes;
  /** Required, and `0` is a real count. A blank line never reaches here. */
  counted: number;
};

export type ParsedCatalogue = {
  products: ProductRow[];
  variants: VariantRow[];
  issues: SheetIssue[];
  /**
   * Match keys whose variant rows did not form a coherent set, so none of them is usable.
   *
   * The writer must skip these products **entirely** rather than apply the product row alone: a
   * create would then invent the single default variant that every product needs, which is not the
   * catalogue the merchant described, and an update would leave the product's real variants
   * untouched while reporting success. The preview names them so the merchant fixes the sheet.
   */
  rejectedProducts: string[];
};

/** The product form's own ceilings, so a sheet cannot smuggle past what the form refuses. */
const MAX_NAME = 120;
const MAX_DESCRIPTION = 5_000;
const MAX_PRICE_CENTS = 100_000_000;
const MAX_CATEGORY_NAME = 80;
const MAX_ATTRIBUTE_KEY = 40;
const MAX_ATTRIBUTE_VALUE = 80;

/**
 * Four levels of category, where the application itself has no limit.
 *
 * Not a technical constraint — `lib/categories.ts` walks any depth and guards against cycles. It
 * is here because the failure it prevents is silent: a stray slash in `Men/s Shirts` would build a
 * chain nobody asked for, and a category tree is tedious to unpick by hand. Four is deeper than
 * any store in the fixtures and deeper than the admin tree is comfortable to read.
 */
const MAX_CATEGORY_DEPTH = 4;

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits, and the Arabic decimal mark. */
function foldDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹٫٬]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    if (ch === "٫") return ".";
    if (ch === "٬") return "";
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
}

const cell = (row: readonly string[], index: number | undefined): string =>
  index === undefined ? "" : (row[index] ?? "").trim();

/** Trimmed, inner whitespace collapsed, case-folded. `Linen  shirt` and `Linen Shirt` are one key. */
export function matchKeyOf(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A whole number, as a spreadsheet hands it over.
 *
 * `"12.0"` is accepted because a numeric Excel cell read as text often arrives that way, and a
 * merchant who typed 12 would be baffled to be told 12 is not a whole number. `"12.5"` is still
 * refused — that is a real mistake in a count of physical objects.
 */
function parseWhole(raw: string): number | null {
  const cleaned = foldDigits(raw).replace(/[,\s]/g, "");
  if (!/^\d+(\.0+)?$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned));
  return Number.isSafeInteger(n) ? n : null;
}

function parseMoney(raw: string): number | null {
  return parsePriceToCents(foldDigits(raw));
}

const TRUE_WORDS = new Set(["yes", "y", "true", "1", "نعم", "أجل", "اجل", "صح"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0", "لا", "كلا", "خطأ", "خطا"]);

function parseBoolean(raw: string): boolean | null | "invalid" {
  if (raw === "") return null;
  const word = foldDigits(raw).toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return "invalid";
}

/** `"Clothing / Shirts"`, `"Clothing>Shirts"`, `"Clothing / "` → `["Clothing", "Shirts"]`. */
function parseCategoryPath(raw: string): string[] | "invalid" {
  const parts = raw
    .split(/[/>]/)
    .map((part) => part.trim())
    // A trailing or leading separator is harmless typing; an empty segment in the MIDDLE is a typo
    // worth refusing, so those are dropped only at the ends.
    .filter((part, index, all) => part !== "" || (index !== 0 && index !== all.length - 1));
  if (parts.length === 0) return "invalid";
  if (parts.some((part) => part === "" || part.length > MAX_CATEGORY_NAME)) return "invalid";
  if (parts.length > MAX_CATEGORY_DEPTH) return "invalid";
  return parts;
}

const isBlankRow = (row: readonly string[]) => row.every((c) => (c ?? "").trim() === "");

/**
 * Finds the header row, then the columns in it.
 *
 * The header is not assumed to be row 1: an exported workbook may carry a title, and a merchant
 * may add a note above the table. The first row that maps at least two known columns wins, within
 * the first ten — far enough for any decoration, near enough that a file whose second *data* row
 * happens to contain the word "Price" cannot be mistaken for a header.
 */
function locateHeader(
  grid: readonly (readonly string[])[],
  columns: readonly SheetColumn[],
): { headerIndex: number; map: Map<string, number> } | null {
  const limit = Math.min(grid.length, 10);
  for (let i = 0; i < limit; i++) {
    const map = mapHeaderRow(grid[i] ?? [], columns);
    if (map.size >= 2) return { headerIndex: i, map };
  }
  return null;
}

function requireColumns(
  sheet: SheetId,
  map: Map<string, number>,
  columns: readonly SheetColumn[],
): SheetIssue[] {
  return columns
    .filter((column) => column.required && !map.has(column.key))
    .map((column) => ({
      sheet,
      row: null,
      message: encodeMessage("import.sheet.missingColumn", column.header.en),
    }));
}

/**
 * Reads the `Option N name` / `Option N value` pairs on one row into an attribute set.
 *
 * Both blank is the single default variant and the common case. One blank is a half-typed option,
 * which is refused rather than guessed — `Size` with no value and `M` with no name are different
 * mistakes and neither has a safe reading.
 */
function readAttributes(
  row: readonly string[],
  map: Map<string, number>,
): { attributes: Attributes } | { error: string } {
  const attributes: Attributes = {};
  const seen = new Set<string>();
  for (let i = 1; i <= MAX_OPTION_PAIRS; i++) {
    const name = cell(row, map.get(`option${i}Name`));
    const value = cell(row, map.get(`option${i}Value`));
    if (name === "" && value === "") continue;
    if (name === "" || value === "") return { error: "validation.attributes.needNameAndValue" };
    if (name.length > MAX_ATTRIBUTE_KEY || value.length > MAX_ATTRIBUTE_VALUE) {
      return { error: "validation.attributes.tooLong" };
    }
    if (seen.has(name.toLowerCase())) {
      return { error: encodeMessage("validation.attributes.duplicate", name) };
    }
    seen.add(name.toLowerCase());
    attributes[name] = value;
  }
  return { attributes };
}

/**
 * Which of the three sheets a grid appears to be, from its headers alone.
 *
 * Pure, and here rather than in `workbook.ts`, because a **CSV** has exactly one unnamed sheet and
 * the importer has to decide what it is without touching the spreadsheet library. It is also what
 * makes an `.xlsx` whose sheet is called `Sheet1` work — what a merchant exporting from another
 * system, or pasting into a fresh workbook, hands over.
 *
 * **Two columns matched, one of them the distinguishing one.** A looser version of this claimed
 * the template's own Instructions sheet: that sheet documents every column, and one of its rows is
 * labelled `Stock`, which a single-column match read as the Options sheet — so the real Options
 * sheet was then skipped and reported as having no header. The three sheets each have a column the
 * others lack (`Counted` only on the stock sheet, `Price` only on the products sheet), and
 * requiring a second match alongside it is what separates a header row from prose that happens to
 * contain a column's name.
 */
export function guessSheetFromHeaders(grid: readonly (readonly string[])[]): SheetId | null {
  const candidates: [SheetId, readonly SheetColumn[], string][] = [
    ["stock", stockSheetColumns(MAX_OPTION_PAIRS), "counted"],
    ["products", productSheetColumns(), "price"],
    ["variants", variantSheetColumns(MAX_OPTION_PAIRS), "stock"],
  ];
  const limit = Math.min(grid.length, 10);
  for (let i = 0; i < limit; i++) {
    for (const [id, columns, distinguishing] of candidates) {
      const map = mapHeaderRow(grid[i] ?? [], columns);
      if (map.size >= 2 && map.has(distinguishing)) return id;
    }
  }
  return null;
}

export function parseProductSheet(grid: readonly (readonly string[])[]): {
  rows: ProductRow[];
  issues: SheetIssue[];
} {
  const columns = productSheetColumns();
  const located = locateHeader(grid, columns);
  if (!located) {
    return { rows: [], issues: [{ sheet: "products", row: null, message: "import.sheet.noHeader" }] };
  }
  const { headerIndex, map } = located;
  const issues = requireColumns("products", map, columns);
  if (issues.length > 0) return { rows: [], issues };

  const rows: ProductRow[] = [];
  const firstSeenAt = new Map<string, number>();

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const row = i + 1; // what the spreadsheet's own row numbers say
    if (isBlankRow(raw)) continue; // a sheet is full of these and none of them is a mistake

    const complain = (message: string) => issues.push({ sheet: "products", row, message });

    const name = cell(raw, map.get("name"));
    if (name === "") {
      complain("validation.name.required");
      continue;
    }
    if (name.length > MAX_NAME) {
      complain("import.issue.nameTooLong");
      continue;
    }

    const matchKey = matchKeyOf(name);
    const earlier = firstSeenAt.get(matchKey);
    if (earlier !== undefined) {
      // Two rows for one product cannot both be applied, and applying the last would silently
      // discard the first. Refused with the row it collides with, so the merchant can see both.
      complain(encodeMessage("import.issue.duplicateProductRow", String(earlier)));
      continue;
    }

    const priceRaw = cell(raw, map.get("price"));
    const priceCents = priceRaw === "" ? null : parseMoney(priceRaw);
    if (priceCents === null || priceCents > MAX_PRICE_CENTS) {
      complain("validation.price.invalidOrEmpty");
      continue;
    }

    const descriptionRaw = cell(raw, map.get("description"));
    if (descriptionRaw.length > MAX_DESCRIPTION) {
      complain("import.issue.descriptionTooLong");
      continue;
    }

    const categoryRaw = cell(raw, map.get("category"));
    let categoryPath: string[] | null = null;
    if (categoryRaw !== "") {
      const parsed = parseCategoryPath(categoryRaw);
      if (parsed === "invalid") {
        complain(encodeMessage("import.issue.categoryInvalid", String(MAX_CATEGORY_DEPTH)));
        continue;
      }
      categoryPath = parsed;
    }

    const bestSellerRaw = parseBoolean(cell(raw, map.get("bestSeller")));
    if (bestSellerRaw === "invalid") {
      complain("import.issue.notYesOrNo");
      continue;
    }

    const warnAtRaw = cell(raw, map.get("warnAt"));
    let warnAt: number | null = null;
    if (warnAtRaw !== "") {
      const parsed = parseWhole(warnAtRaw);
      if (parsed === null || parsed > MAX_STOCK) {
        complain("import.issue.notAWholeNumber");
        continue;
      }
      warnAt = parsed;
    }

    firstSeenAt.set(matchKey, row);
    rows.push({
      row,
      name,
      matchKey,
      description: descriptionRaw === "" ? null : descriptionRaw,
      priceCents,
      categoryPath,
      bestSeller: bestSellerRaw,
      warnAt,
    });
  }

  return { rows, issues };
}

export function parseVariantSheet(grid: readonly (readonly string[])[]): {
  rows: VariantRow[];
  issues: SheetIssue[];
} {
  const columns = variantSheetColumns(MAX_OPTION_PAIRS);
  const located = locateHeader(grid, columns);
  if (!located) {
    return { rows: [], issues: [{ sheet: "variants", row: null, message: "import.sheet.noHeader" }] };
  }
  const { headerIndex, map } = located;
  const issues = requireColumns("variants", map, columns);
  if (issues.length > 0) return { rows: [], issues };

  const rows: VariantRow[] = [];
  const seenPerProduct = new Map<string, Map<string, number>>();

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const row = i + 1;
    if (isBlankRow(raw)) continue;

    const complain = (message: string) => issues.push({ sheet: "variants", row, message });

    const productName = cell(raw, map.get("productName"));
    if (productName === "") {
      // Deliberately NOT "the product from the row above". Sorting or filtering the sheet would
      // reattach a blank row to a different product, and a silently mis-filed variant is far
      // worse than a refused row with a number on it.
      complain("import.issue.variantNeedsProduct");
      continue;
    }

    const attrs = readAttributes(raw, map);
    if ("error" in attrs) {
      complain(attrs.error);
      continue;
    }

    const stockRaw = cell(raw, map.get("stock"));
    let stock: number | null = null;
    if (stockRaw !== "") {
      const parsed = parseWhole(stockRaw);
      if (parsed === null || parsed > MAX_STOCK) {
        complain("import.issue.notAWholeNumber");
        continue;
      }
      stock = parsed;
    }

    const overrideRaw = cell(raw, map.get("priceOverride"));
    let priceOverrideCents: number | null = null;
    if (overrideRaw !== "") {
      const parsed = parseMoney(overrideRaw);
      if (parsed === null || parsed > MAX_PRICE_CENTS) {
        complain("validation.price.invalidOrEmpty");
        continue;
      }
      priceOverrideCents = parsed;
    }

    const matchKey = matchKeyOf(productName);
    const signature = JSON.stringify(
      Object.entries(attrs.attributes)
        .map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    const seen = seenPerProduct.get(matchKey) ?? new Map<string, number>();
    const earlier = seen.get(signature);
    if (earlier !== undefined) {
      complain(encodeMessage("products.variant.duplicateOf", String(earlier)));
      continue;
    }
    seen.set(signature, row);
    seenPerProduct.set(matchKey, seen);

    rows.push({ row, productName, matchKey, attributes: attrs.attributes, stock, priceOverrideCents });
  }

  return { rows, issues };
}

export function parseStockSheet(grid: readonly (readonly string[])[]): {
  rows: StockRow[];
  issues: SheetIssue[];
} {
  const columns = stockSheetColumns(MAX_OPTION_PAIRS);
  const located = locateHeader(grid, columns);
  if (!located) {
    return { rows: [], issues: [{ sheet: "stock", row: null, message: "import.sheet.noHeader" }] };
  }
  const { headerIndex, map } = located;
  const issues = requireColumns("stock", map, columns);
  if (issues.length > 0) return { rows: [], issues };

  const rows: StockRow[] = [];
  const seen = new Map<string, number>();

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const row = i + 1;
    if (isBlankRow(raw)) continue;

    const complain = (message: string) => issues.push({ sheet: "stock", row, message });

    const productName = cell(raw, map.get("productName"));
    if (productName === "") {
      complain("import.issue.variantNeedsProduct");
      continue;
    }

    const attrs = readAttributes(raw, map);
    if ("error" in attrs) {
      complain(attrs.error);
      continue;
    }

    // The one place on any sheet where a blank cell is not "leave it alone": a stocktake line with
    // no figure was not counted, and a stocktake that read it as 0 would write off the shelf.
    // Skipped silently rather than reported, because an exported count sheet arrives with every
    // line blank by design and a merchant counts the aisle they walked.
    const countedRaw = cell(raw, map.get("counted"));
    if (countedRaw === "") continue;

    const counted = parseWhole(countedRaw);
    if (counted === null || counted > MAX_STOCK) {
      complain("import.issue.notAWholeNumber");
      continue;
    }

    const matchKey = matchKeyOf(productName);
    const signature = `${matchKey}\u0000${JSON.stringify(
      Object.entries(attrs.attributes)
        .map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
        .sort(([a], [b]) => a.localeCompare(b)),
    )}`;
    const earlier = seen.get(signature);
    if (earlier !== undefined) {
      // Two counts of one shelf. Taking either would be a guess about which walk was later.
      complain(encodeMessage("import.issue.duplicateCountRow", String(earlier)));
      continue;
    }
    seen.set(signature, row);

    rows.push({ row, productName, matchKey, attributes: attrs.attributes, counted });
  }

  return { rows, issues };
}

/**
 * The two catalogue sheets together, plus the checks that only make sense across them.
 *
 * `variantSetIssues` is the reason this exists: whether a variant is valid depends on its
 * *siblings* — they must share attribute names, and a product with more than one variant cannot
 * have an attribute-less one. That is a per-product judgement over rows scattered down a sheet, so
 * it runs here, once, with each complaint mapped back to the spreadsheet row that caused it.
 */
export function parseCatalogueSheets(input: {
  products?: readonly (readonly string[])[];
  variants?: readonly (readonly string[])[];
}): ParsedCatalogue {
  const products = input.products ? parseProductSheet(input.products) : { rows: [], issues: [] };
  const variants = input.variants ? parseVariantSheet(input.variants) : { rows: [], issues: [] };
  const issues: SheetIssue[] = [...products.issues, ...variants.issues];

  const byProduct = new Map<string, VariantRow[]>();
  for (const variant of variants.rows) {
    const list = byProduct.get(variant.matchKey) ?? [];
    list.push(variant);
    byProduct.set(variant.matchKey, list);
  }

  // Keep only the variants whose set is coherent. A product whose variants disagree about their
  // attribute NAMES has no correct reading at all, so the whole product's variant rows are
  // reported and withheld — importing the subset that happens to agree would build a catalogue
  // the merchant did not describe.
  const rejected = new Set<string>();
  for (const [matchKey, rowsForProduct] of byProduct) {
    const drafts: VariantDraft[] = rowsForProduct.map((v) => ({ attributes: v.attributes }));
    for (const issue of variantSetIssues(drafts)) {
      const at = issue.index === null ? rowsForProduct[0] : rowsForProduct[issue.index];
      issues.push({ sheet: "variants", row: at?.row ?? null, message: issue.message });
      rejected.add(matchKey);
    }
  }

  return {
    products: products.rows.filter((p) => !rejected.has(p.matchKey)),
    variants: variants.rows.filter((v) => !rejected.has(v.matchKey)),
    issues,
    rejectedProducts: [...rejected],
  };
}
