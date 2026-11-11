/**
 * The only file in this repository that imports a spreadsheet library.
 *
 * Everything either side of it speaks `string[][]`: `columns.ts` says what the columns are,
 * `parse.ts` turns a grid into rows, and this module is the quarantine between them and
 * `exceljs`. If the library ever has to be replaced, one file changes and `pnpm verify:sheet` —
 * which imports none of it — still passes unaltered.
 *
 * **On the dependency, honestly.** The plan costed `exceljs` at "roughly a megabyte"; the package
 * is 21.8 MB and pulls 75 packages, six of them deprecated. Both halves of that turned out to
 * matter less than they look: 21 MB of it is `dist/`, the *browser* bundle, which the Node entry
 * never loads — the code that actually runs is `lib/`, 997 KB — and no security advisory in this
 * tree reaches through it. What it buys that the 1.8 MB alternative cannot is **data validation**:
 * `write-excel-file` has no dropdown API at all, and a dropdown on the category column is the main
 * defence against a typo silently creating a junk category, now that missing categories are
 * created. Hand-writing the XML was considered and rejected for one reason: a malformed workbook
 * is refused by Excel with a useless error, and Excel is the one program this cannot be tested in
 * from here.
 *
 * **A merchant's workbook is untrusted input.** It arrives over HTTP from a signed-in owner, which
 * makes it low-risk rather than no-risk, and a zip archive is the classic shape for a decompression
 * bomb. Three bounds, all here rather than at the call site: the route caps the *compressed* size
 * before this is reached, `MAX_SHEET_ROWS` caps rows read per sheet, and `MAX_SHEET_COLUMNS` caps
 * the width. Formulas are never evaluated — a cell's cached result is read, and a cell holding a
 * formula with no result reads as blank, which becomes a numbered complaint rather than a value.
 */

import ExcelJS from "exceljs";

import type { Locale } from "@/lib/i18n/types";
import { guessSheetFromHeaders } from "@/lib/catalogue-sheet/parse";
import type { Attributes } from "@/lib/variants";

import {
  BLANK_RULE,
  MAX_OPTION_PAIRS,
  OPTION_PAIRS_IN_TEMPLATE,
  SHEET_NAMES,
  headerLabel,
  normalizeHeader,
  productSheetColumns,
  stockSheetColumns,
  variantSheetColumns,
  type SheetColumn,
} from "./columns";

/** Rows read per sheet. `MAX_IMPORT_ROWS` is 1,000; the slack absorbs a title row and blanks. */
export const MAX_SHEET_ROWS = 1_100;
/** Three sheets at 23 columns is the widest thing we write; 64 leaves room for a merchant's own. */
export const MAX_SHEET_COLUMNS = 64;

export type SheetId = "products" | "variants" | "stock";
export type SheetGrids = Partial<Record<SheetId, string[][]>>;

/**
 * One cell, as a string, whatever exceljs decided it was.
 *
 * The `CellValue` union is nine shapes wide and a merchant's workbook produces most of them: a
 * price column autoformatted to currency arrives as a number, a pasted name as rich text, a
 * pasted URL as a hyperlink object, a date-formatted cell as a `Date`, and `=A1*2` as
 * `{ formula, result }`. `String(value)` on any of the object shapes yields `"[object Object]"`,
 * which would then be imported as a product name — so each is unwrapped explicitly and anything
 * unrecognised becomes blank, which the parser reports with a row number.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) {
    // A price or count cell that Excel decided was a date is a mistake, not a value. The ISO form
    // fails every parser in parse.ts, which is the outcome we want: a complaint naming the row.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text ?? "").join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) {
      // The cached result only. Evaluating a merchant's formulas would mean running their
      // arithmetic on our server to decide what to write into their catalogue.
      const result = (value as { result?: unknown }).result;
      if (result === null || result === undefined) return "";
      if (typeof result === "object") return "";
      return String(result).trim();
    }
    if ("error" in value) return ""; // #REF!, #DIV/0! — blank, then reported as missing
  }
  return "";
}

/** Matches a worksheet to one of our three sheets by name, in either language. */
function identifySheet(name: string): SheetId | null {
  const key = normalizeHeader(name);
  for (const id of ["products", "variants", "stock"] as const) {
    const names = SHEET_NAMES[id];
    if (key === normalizeHeader(names.en) || key === normalizeHeader(names.ar)) return id;
  }
  return null;
}

export type ReadResult = {
  sheets: SheetGrids;
  /** True when a sheet hit `MAX_SHEET_ROWS` with content still on the last row read. */
  truncated: boolean;
  /** Every worksheet name in the file, for the "we could not find a sheet" message. */
  sheetNames: string[];
};

/** Reads an `.xlsx` into grids, one per sheet we recognise. */
export async function readWorkbook(data: ArrayBuffer | Buffer): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as ArrayBuffer);

  const sheets: SheetGrids = {};
  const sheetNames: string[] = [];
  let truncated = false;

  workbook.eachSheet((worksheet) => {
    sheetNames.push(worksheet.name);
    const rowLimit = Math.min(worksheet.rowCount, MAX_SHEET_ROWS);
    const grid: string[][] = [];
    for (let r = 1; r <= rowLimit; r++) {
      const row = worksheet.getRow(r);
      const width = Math.min(row.cellCount, MAX_SHEET_COLUMNS);
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
      grid.push(cells);
    }
    // Only a cap that cut into real data is worth telling anyone about. A sheet with formatting
    // trailing to row 100,000 has a huge `rowCount` and nothing past row 400, and warning about
    // that would cry wolf on every file a merchant has ever styled.
    if (worksheet.rowCount > rowLimit && grid[grid.length - 1]?.some((c) => c !== "")) {
      truncated = true;
    }

    const id = identifySheet(worksheet.name) ?? guessSheetFromHeaders(grid);
    // First sheet of a kind wins: a workbook with two "Products" sheets is a copy somebody forgot
    // to delete, and merging them would apply edits the merchant cannot see.
    if (id && !sheets[id]) sheets[id] = grid;
  });

  return { sheets, truncated, sheetNames };
}

// --------------------------------------------------------------------------- writing

export type ExportProduct = {
  name: string;
  description: string;
  priceCents: number;
  /** Outermost first. `null` for an uncategorised product. */
  categoryPath: string[] | null;
  bestSeller: boolean;
  warnAt: number | null;
};

export type ExportVariant = {
  productName: string;
  attributes: Attributes;
  stock: number;
  priceOverrideCents: number | null;
};

export type ExportStockLine = {
  productName: string;
  attributes: Attributes;
  onHand: number;
};

export type WorkbookInput = {
  locale: Locale;
  storeName: string;
  /** Drives the category dropdown, as full paths: `"Clothing / Shirts"`. */
  categoryPaths: string[];
  /** Drives the product-name suggestion list on the Options and Stock sheets. */
  productNames: string[];
  /** Absent for the blank template; present for an export. */
  products?: ExportProduct[];
  variants?: ExportVariant[];
  stock?: ExportStockLine[];
};

const YES_NO: Record<Locale, [string, string]> = { en: ["yes", "no"], ar: ["نعم", "لا"] };

/** Spare rows below the data, so the dropdowns are there when a merchant adds a line. */
const SPARE_ROWS = 200;

const HEADER_FILL = "FFF1F5F9";
const HEADER_FONT = { bold: true, size: 11 };

function addHeader(worksheet: ExcelJS.Worksheet, columns: SheetColumn[], locale: Locale) {
  worksheet.addRow(columns.map((column) => headerLabel(column, locale)));
  const header = worksheet.getRow(1);
  header.font = HEADER_FONT;
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    // The help text as a cell note, so the answer is where the question is. The Instructions sheet
    // repeats all of it, for the merchant who prints the workbook or reads it on a phone.
    cell.note = column.help[locale];
    worksheet.getColumn(i + 1).width = column.kind === "text" ? 26 : 16;
  });
  // The one piece of spreadsheet mechanics that makes a 500-row sheet usable at all.
  worksheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: locale === "ar" }];
}

/**
 * A dropdown that suggests rather than refuses.
 *
 * `showErrorMessage: false` on every one of them, deliberately. A merchant typing a brand-new
 * category — which this importer creates — must not be stopped by Excel, and a blocked cell
 * explains itself with a dialog we did not write and cannot translate. Our own numbered complaint
 * on the preview screen is the refusal; this is only the convenience.
 */
function addDropdown(
  worksheet: ExcelJS.Worksheet,
  columnIndex: number,
  formulae: string[],
  rows: number,
) {
  for (let r = 2; r <= rows + 1; r++) {
    worksheet.getCell(r, columnIndex).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae,
      showErrorMessage: false,
    };
  }
}

/**
 * Cents to the number a spreadsheet cell holds, refusing anything that is not a figure.
 *
 * The throw is the point. Writing this export against the real demo store the first time, every
 * price cell came out as the string `"NaN"` — the caller had read `priceCents` where the column is
 * `basePriceCents` — and the workbook was produced, downloaded and *parsed back* without
 * complaint, because `NaN` fails `parsePriceToCents` exactly like a merchant's typo does. Six
 * products silently became six numbered complaints about a file our own code had written.
 *
 * An export is generated from our own database, so a missing figure there is a bug on our side and
 * must stop, not become a cell the merchant is then asked to fix.
 */
function money(cents: number): number {
  if (!Number.isFinite(cents)) {
    throw new Error(`refusing to write a non-numeric amount to a workbook: ${String(cents)}`);
  }
  return Number((cents / 100).toFixed(2));
}

/** The attribute pairs of one variant, spread across `Option N name` / `Option N value`. */
function attributeCells(attributes: Attributes, pairs: number): (string | null)[] {
  const entries = Object.entries(attributes).slice(0, pairs);
  const cells: (string | null)[] = [];
  for (let i = 0; i < pairs; i++) {
    cells.push(entries[i]?.[0] ?? null, entries[i]?.[1] ?? null);
  }
  return cells;
}

function addInstructions(workbook: ExcelJS.Workbook, input: WorkbookInput) {
  const { locale } = input;
  const sheet = workbook.addWorksheet(SHEET_NAMES.instructions[locale]);
  sheet.views = [{ rightToLeft: locale === "ar" }];
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 96;

  const heading = (text: string) => {
    const row = sheet.addRow([text]);
    row.font = { bold: true, size: 13 };
    row.height = 24;
  };
  const line = (left: string, right = "") => {
    const row = sheet.addRow([left, right]);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).font = { bold: true };
  };

  heading(input.storeName);
  sheet.addRow([]);
  line(
    locale === "ar" ? "القاعدة الأهم" : "The most important rule",
    BLANK_RULE[locale],
  );
  line(
    locale === "ar" ? "كيف تُطابق الصفوف" : "How rows are matched",
    locale === "ar"
      ? "يُعرَّف المنتج باسمه. تغيير الاسم هنا يُنشئ منتجاً جديداً ولا يعيد تسمية القديم — لذا ابدأ دائماً من تصدير، وستظهر لك شاشة المعاينة ما سيُنشأ وما سيُحدَّث قبل حدوث أي شيء."
      : "A product is identified by its name. Changing the name here creates a new product rather than renaming the old one — so always start from an export, and the preview screen shows you what will be created and what will be updated before anything happens.",
  );
  line(
    locale === "ar" ? "الصور" : "Photos",
    locale === "ar"
      ? "لا تُضاف الصور من هذا الملف. أضفها من شاشة المنتج. لن يحذف الاستيراد صور منتج موجود."
      : "Photos are not added from this file. Add them on the product screen. An import never removes an existing product's photos.",
  );
  line(
    locale === "ar" ? "المخزون" : "Stock",
    locale === "ar"
      ? "عمود «المخزون» في ورقة الخيارات يعمل فقط للخيارات الجديدة. لتغيير مخزون موجود استخدم ورقة «جرد المخزون» — فتُسجَّل الحركة ويُعرف من غيّرها."
      : "The Stock column on the Options sheet only applies to options being created. To change existing stock use the Stock count sheet, which records the movement and who made it.",
  );
  line(
    locale === "ar" ? "الحذف" : "Deleting",
    locale === "ar"
      ? "لا يحذف الاستيراد شيئاً. المنتج الموجود في متجرك وغير الموجود في هذا الملف يُترك كما هو."
      : "An import never deletes anything. A product in your store but not in this file is left exactly as it is.",
  );
  sheet.addRow([]);

  const sheetsToDocument: [SheetId, SheetColumn[]][] = [
    ["products", productSheetColumns()],
    ["variants", variantSheetColumns()],
    ["stock", stockSheetColumns()],
  ];
  for (const [id, columns] of sheetsToDocument) {
    sheet.addRow([]);
    heading(SHEET_NAMES[id][locale]);
    for (const column of columns) line(headerLabel(column, locale), column.help[locale]);
  }
}

/**
 * The workbook, blank or filled — one function for both, so the template a merchant fills in and
 * the export they edit can never be different shapes. That is also what makes the round trip
 * (write, read, parse, compare) a real assertion rather than two code paths agreeing by luck.
 */
export async function buildWorkbook(input: WorkbookInput): Promise<Buffer> {
  const { locale } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.storeName;
  workbook.created = new Date();

  addInstructions(workbook, input);

  const [yes, no] = YES_NO[locale];
  const products = input.products ?? [];
  const variants = input.variants ?? [];
  const stock = input.stock ?? [];

  // ---- Products
  const productColumns = productSheetColumns();
  const productSheet = workbook.addWorksheet(SHEET_NAMES.products[locale]);
  addHeader(productSheet, productColumns, locale);
  for (const product of products) {
    productSheet.addRow([
      product.name,
      product.description,
      money(product.priceCents),
      product.categoryPath?.join(" / ") ?? null,
      product.bestSeller ? yes : no,
      product.warnAt,
    ]);
  }

  // ---- Options
  const variantColumns = variantSheetColumns();
  const variantSheet = workbook.addWorksheet(SHEET_NAMES.variants[locale]);
  addHeader(variantSheet, variantColumns, locale);
  for (const variant of variants) {
    variantSheet.addRow([
      variant.productName,
      ...attributeCells(variant.attributes, OPTION_PAIRS_IN_TEMPLATE),
      // An export leaves this blank on purpose: it applies only to options being created, and a
      // figure here on a re-import would be ignored and reported, which looks like a bug.
      null,
      variant.priceOverrideCents === null ? null : money(variant.priceOverrideCents),
    ]);
  }

  // ---- Stock count
  const stockColumns = stockSheetColumns();
  const stockSheet = workbook.addWorksheet(SHEET_NAMES.stock[locale]);
  addHeader(stockSheet, stockColumns, locale);
  for (const line of stock) {
    stockSheet.addRow([
      line.productName,
      ...attributeCells(line.attributes, OPTION_PAIRS_IN_TEMPLATE),
      line.onHand,
      null, // Counted — the whole point is that the merchant fills this in on the shelf
    ]);
  }

  // ---- Lists (hidden), which is what `.xlsx` buys over a CSV
  const lists = workbook.addWorksheet(SHEET_NAMES.lists[locale], { state: "hidden" });
  lists.getColumn(1).width = 40;
  lists.getColumn(2).width = 40;
  lists.addRow([
    locale === "ar" ? "الفئات" : "Categories",
    locale === "ar" ? "المنتجات" : "Products",
  ]);
  const categoryPaths = [...new Set(input.categoryPaths)].sort();
  const productNames = [...new Set(input.productNames)].sort();
  const depth = Math.max(categoryPaths.length, productNames.length);
  for (let i = 0; i < depth; i++) {
    lists.addRow([categoryPaths[i] ?? null, productNames[i] ?? null]);
  }
  const listsName = SHEET_NAMES.lists[locale];
  // Quoted because a localised sheet name contains a space, which Excel will not accept bare.
  const range = (column: "A" | "B", count: number) =>
    count === 0 ? null : [`'${listsName}'!$${column}$2:$${column}$${count + 1}`];

  const categoryRange = range("A", categoryPaths.length);
  if (categoryRange) {
    addDropdown(productSheet, productColumns.findIndex((c) => c.key === "category") + 1, categoryRange, products.length + SPARE_ROWS);
  }
  addDropdown(productSheet, productColumns.findIndex((c) => c.key === "bestSeller") + 1, [`"${yes},${no}"`], products.length + SPARE_ROWS);

  const productRange = range("B", productNames.length);
  if (productRange) {
    addDropdown(variantSheet, 1, productRange, variants.length + SPARE_ROWS);
    addDropdown(stockSheet, 1, productRange, stock.length + SPARE_ROWS);
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Every sheet's column keys, so a caller can be sure of the width it is writing. */
export const SHEET_COLUMNS: Record<SheetId, () => SheetColumn[]> = {
  products: productSheetColumns,
  variants: () => variantSheetColumns(),
  stock: () => stockSheetColumns(),
};

export { MAX_OPTION_PAIRS };
