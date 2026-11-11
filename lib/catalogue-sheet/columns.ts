/**
 * What a catalogue sheet's columns are — defined once, read by all three directions.
 *
 * The template writer, the exporter and the importer all build from this list, so a column cannot
 * exist in one and not another. That is the whole reason this file is separate: the first version
 * of any import feature grows a second list of headers in the exporter, and the two drift within a
 * month. `pnpm verify:sheet` asserts the round trip (write a template, read it back, get these
 * keys) precisely so the three can never disagree.
 *
 * **Headers are bilingual and matched either way.** A merchant whose dashboard is Arabic downloads
 * an Arabic template, types into it, and uploads it; the reader matches a header against both
 * languages and the stable key. Nothing in this file is user-visible text that only exists in
 * English, because the people this feature is for do not all read English.
 */

import type { Locale } from "@/lib/i18n/types";

export type ColumnKind =
  /** Free text. */
  | "text"
  /** Money, through `parsePriceToCents` — "85", "85.00", "$1,299.50". */
  | "money"
  /** A whole number, 0 or more. */
  | "whole"
  /** yes / no, in either language, plus the obvious aliases. */
  | "boolean"
  /** A category path: "Clothing / Shirts". */
  | "categoryPath";

export type SheetColumn = {
  /** The stable identity. Never shown; what the parsed row is keyed on. */
  key: string;
  /** The header written into the template, and matched (normalised) on read. */
  header: Record<Locale, string>;
  kind: ColumnKind;
  required?: boolean;
  /**
   * Written to the template as a column comment AND listed on the Instructions sheet.
   *
   * Every one of these has to answer "what does blank mean", because blank is the answer a
   * merchant gives most often and the one a spreadsheet makes invisible.
   */
  help: Record<Locale, string>;
};

/** `variantInputSchema` allows ten attribute pairs per variant; the template ships three. */
export const MAX_OPTION_PAIRS = 10;
export const OPTION_PAIRS_IN_TEMPLATE = 3;

export const PRODUCT_COLUMNS: readonly SheetColumn[] = [
  {
    key: "name",
    header: { en: "Product", ar: "المنتج" },
    kind: "text",
    required: true,
    help: {
      en: "Required. This is also how a re-import finds the product again, so changing it here creates a new product rather than renaming the old one.",
      ar: "مطلوب. هذا أيضاً ما يُستخدم للعثور على المنتج عند إعادة الاستيراد، لذا تغييره هنا يُنشئ منتجاً جديداً بدلاً من إعادة تسمية القديم.",
    },
  },
  {
    key: "description",
    header: { en: "Description", ar: "الوصف" },
    kind: "text",
    help: {
      en: "Optional. Leave blank to keep what the product already has.",
      ar: "اختياري. اتركه فارغاً للحفاظ على ما هو موجود في المنتج.",
    },
  },
  {
    key: "price",
    header: { en: "Price", ar: "السعر" },
    kind: "money",
    required: true,
    help: {
      en: 'Required. "85" or "85.00" both work. Currency symbols and thousands commas are ignored.',
      ar: 'مطلوب. "85" أو "85.00" كلاهما يعمل. تُتجاهل رموز العملة وفواصل الآلاف.',
    },
  },
  {
    key: "category",
    header: { en: "Category", ar: "الفئة" },
    kind: "categoryPath",
    help: {
      en: 'Optional. Use the full path with a slash for a sub-category: "Clothing / Shirts". A category that does not exist yet is created.',
      ar: 'اختياري. استخدم المسار الكامل بشرطة مائلة للفئة الفرعية: "ملابس / قمصان". تُنشأ الفئة غير الموجودة.',
    },
  },
  {
    key: "bestSeller",
    header: { en: "Best seller", ar: "الأكثر مبيعاً" },
    kind: "boolean",
    help: {
      en: "yes or no. Blank leaves it as it is — and no for a new product. This is the manual flag for the storefront section, not sales data.",
      ar: "نعم أو لا. الفراغ يتركه كما هو — و«لا» للمنتج الجديد. هذه علامة يدوية لقسم المتجر، وليست بيانات مبيعات.",
    },
  },
  {
    key: "warnAt",
    header: { en: "Warn me at", ar: "نبّهني عند" },
    kind: "whole",
    help: {
      en: "Optional. Blank leaves it as it is — the shop default for a new product. 0 means warn me only when it runs out.",
      ar: "اختياري. الفراغ يتركه كما هو — الحد الافتراضي للمتجر للمنتج الجديد. 0 يعني نبّهني عند نفاده فقط.",
    },
  },
];

export const VARIANT_FIXED_COLUMNS: readonly SheetColumn[] = [
  {
    key: "productName",
    header: { en: "Product", ar: "المنتج" },
    kind: "text",
    required: true,
    help: {
      en: "Required on every row — it says which product this option belongs to. Repeat it for each option; never leave it blank to mean 'the one above', because sorting the sheet would break that.",
      ar: "مطلوب في كل صف — يحدد المنتج الذي ينتمي إليه هذا الخيار. كرّره لكل خيار؛ لا تتركه فارغاً بمعنى «الذي فوقه»، لأن ترتيب الورقة سيُفسد ذلك.",
    },
  },
];

export const VARIANT_TAIL_COLUMNS: readonly SheetColumn[] = [
  {
    key: "stock",
    header: { en: "Stock (new options only)", ar: "المخزون (الخيارات الجديدة فقط)" },
    kind: "whole",
    help: {
      en: "Only used when this option is being created. For an option that already exists the figure here is ignored and reported — stock moves through a stock count, so it always leaves a record of who changed it.",
      ar: "يُستخدم فقط عند إنشاء هذا الخيار. أما الخيار الموجود أصلاً فيُتجاهل الرقم هنا ويُبلَّغ عنه — يتغيّر المخزون عبر جرد، ليبقى دائماً سجل بمن غيّره.",
    },
  },
  {
    key: "priceOverride",
    header: { en: "This option's price", ar: "سعر هذا الخيار" },
    kind: "money",
    help: {
      en: "Optional. Blank means this option costs the product's price.",
      ar: "اختياري. الفراغ يعني أن هذا الخيار بسعر المنتج.",
    },
  },
];

export const STOCK_FIXED_COLUMNS: readonly SheetColumn[] = VARIANT_FIXED_COLUMNS;

export const STOCK_TAIL_COLUMNS: readonly SheetColumn[] = [
  {
    key: "onHand",
    header: { en: "On the shelf now", ar: "على الرف الآن" },
    kind: "whole",
    help: {
      en: "What the system currently believes, filled in by the export. Read-only: whatever you type here is ignored. It is here so you can see what you are checking against.",
      ar: "ما يعتقده النظام حالياً، يُملأ عند التصدير. للقراءة فقط: يُتجاهل أي شيء تكتبه هنا. وُضع لتتمكن من رؤية ما تقارن به.",
    },
  },
  {
    key: "counted",
    header: { en: "Counted", ar: "المعدود" },
    kind: "whole",
    required: true,
    help: {
      en: "Required. What you actually found on the shelf. 0 is a real count and means the shelf is empty. A line you leave blank is skipped, not counted as zero.",
      ar: "مطلوب. ما وجدته فعلاً على الرف. 0 جردٌ حقيقي ويعني أن الرف فارغ. يُتجاهل السطر الذي تتركه فارغاً، ولا يُحسب صفراً.",
    },
  },
];

/**
 * `Option 1 name` / `Option 1 value`, repeated.
 *
 * Fixed pairs of columns rather than one "Size: M, Colour: Blue" cell, for three reasons a
 * spreadsheet makes obvious: a column can be sorted, filtered and filled down; `variantSetIssues`
 * requires every variant of one product to use the same attribute NAMES, which a column layout
 * shows at a glance and a packed cell hides; and a merchant with one option per product never sees
 * the second pair at all.
 */
export function optionPairColumns(count: number): SheetColumn[] {
  const pairs: SheetColumn[] = [];
  for (let i = 1; i <= count; i++) {
    pairs.push(
      {
        key: `option${i}Name`,
        header: { en: `Option ${i} name`, ar: `اسم الخيار ${i}` },
        kind: "text",
        help: {
          en: i === 1
            ? 'What kind of option this is — "Size", "Colour". Leave both this and its value blank for a product sold in only one version.'
            : "Only for a product whose options have more than one part, such as Size AND Colour.",
          ar: i === 1
            ? 'نوع الخيار — «المقاس»، «اللون». اترك هذا وقيمته فارغين للمنتج الذي يُباع بنسخة واحدة فقط.'
            : "فقط للمنتج الذي تتكوّن خياراته من أكثر من جزء، مثل المقاس واللون معاً.",
        },
      },
      {
        key: `option${i}Value`,
        header: { en: `Option ${i} value`, ar: `قيمة الخيار ${i}` },
        kind: "text",
        help: {
          en: i === 1 ? 'The value itself — "M", "Blue".' : "The value for that second part.",
          ar: i === 1 ? 'القيمة نفسها — «M»، «أزرق».' : "قيمة ذلك الجزء الثاني.",
        },
      },
    );
  }
  return pairs;
}

/** The three sheets, at the width the template ships. */
export const productSheetColumns = (): SheetColumn[] => [...PRODUCT_COLUMNS];

export const variantSheetColumns = (pairs = OPTION_PAIRS_IN_TEMPLATE): SheetColumn[] => [
  ...VARIANT_FIXED_COLUMNS,
  ...optionPairColumns(pairs),
  ...VARIANT_TAIL_COLUMNS,
];

export const stockSheetColumns = (pairs = OPTION_PAIRS_IN_TEMPLATE): SheetColumn[] => [
  ...STOCK_FIXED_COLUMNS,
  ...optionPairColumns(pairs),
  ...STOCK_TAIL_COLUMNS,
];

/**
 * The rule that governs every optional cell, stated once at the top of the Instructions sheet.
 *
 * **Blank means leave it alone**, everywhere, on every sheet — never "set this to empty" and never
 * "set this to zero". One rule a merchant can hold in their head, and the safe direction: a cell
 * nobody filled in can then never destroy something that was already there. The cost, written down
 * rather than hidden: a value cannot be *cleared* through the sheet, so emptying a description or
 * returning a low-stock threshold to the shop default is done on the product screen.
 *
 * The two exceptions are both deliberate and both named on the sheet: `Counted` on the stock sheet,
 * where blank skips the line and `0` is a real count of an empty shelf; and the required columns,
 * where blank is an error rather than a choice.
 */
export const BLANK_RULE = {
  en: "A cell you leave blank is left alone — the product keeps whatever it already has. Blank never means empty and never means zero. The one exception is 'Counted' on the stock sheet, where 0 is a real count and a blank line is skipped.",
  ar: "الخلية التي تتركها فارغة تُترك كما هي — يحتفظ المنتج بما لديه أصلاً. الفراغ لا يعني الإفراغ ولا يعني صفراً. الاستثناء الوحيد هو «المعدود» في ورقة الجرد، حيث 0 جردٌ حقيقي والسطر الفارغ يُتجاهل.",
} as const satisfies Record<Locale, string>;

/** The sheet names, which the reader matches case-insensitively and the writer emits. */
export const SHEET_NAMES = {
  products: { en: "Products", ar: "المنتجات" },
  variants: { en: "Options", ar: "الخيارات" },
  stock: { en: "Stock count", ar: "جرد المخزون" },
  instructions: { en: "Instructions", ar: "التعليمات" },
  lists: { en: "Lists", ar: "القوائم" },
} as const satisfies Record<string, Record<Locale, string>>;

/**
 * How a header cell is compared.
 *
 * Case-folded, whitespace-collapsed, and stripped of the punctuation a spreadsheet adds on its
 * own — Excel will happily hand back `Price ` with a trailing space, and a merchant will type
 * `price` in lower case. Arabic diacritics and the tatweel are removed for the same reason: a
 * header typed by hand will not match one written by a generator byte for byte.
 */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ْـ]/g, "")
    .toLowerCase()
    .replace(/[()'".،,:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every spelling of a column's header that the reader will accept. */
export function headerAliases(column: SheetColumn): string[] {
  return [
    normalizeHeader(column.header.en),
    normalizeHeader(column.header.ar),
    normalizeHeader(column.key),
  ];
}

/**
 * Maps a sheet's header row to column keys. Unknown columns are ignored rather than refused — a
 * merchant who adds a "Supplier" note column of their own should not have their file rejected for
 * it, and the export deliberately carries a read-only column (`onHand`) that the importer ignores.
 */
export function mapHeaderRow(
  header: readonly string[],
  columns: readonly SheetColumn[],
): Map<string, number> {
  const byAlias = new Map<string, string>();
  for (const column of columns) {
    for (const alias of headerAliases(column)) byAlias.set(alias, column.key);
  }
  const found = new Map<string, number>();
  header.forEach((cell, index) => {
    const key = byAlias.get(normalizeHeader(cell ?? ""));
    // First occurrence wins: a duplicated header is a copy-paste accident, and silently taking the
    // last one would mean the column a merchant filled in is not the column that was read.
    if (key && !found.has(key)) found.set(key, index);
  });
  return found;
}
