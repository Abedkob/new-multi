/**
 * What a parsed sheet actually does to a catalogue.
 *
 * Two phases, deliberately separate. `planCatalogueImport` resolves the sheet against live state
 * and decides a verdict per product — create, update, unchanged, skip — writing nothing. `apply`
 * re-plans from scratch and then executes, because the catalogue can change between the merchant
 * reading the preview and pressing the button, and reporting the plan as though it were the
 * outcome is how an import comes to claim things it did not do.
 *
 * ## The four rules this file exists to hold
 *
 * **1. An import is an upsert, never a sync.** A product in the store and absent from the sheet is
 * left alone. There is no row shape that deletes anything.
 *
 * **2. Every update payload is `existing ∪ sheet`, never `sheet` alone.** This is not a
 * preference, it is a data-loss bug that was in the approved plan until someone read
 * `updateProduct`: that function is a *replace*, not a merge, and anything absent from its payload
 * is deleted —
 *
 * ```ts
 * await tx.productImage.deleteMany({ where: { productId, id: { notIn: [...keepImages] } } });
 * ```
 *
 * The sheet has no image column, by design, so the straightforward `images: []` would have
 * destroyed every product's whole gallery on the first re-import. A variant the sheet omits would
 * likewise have been deleted *and its stock written off*. So images are carried through verbatim
 * with their ids, every existing variant is carried forward by id unless the sheet names it, and a
 * variant the sheet does not mention is reported rather than removed.
 *
 * **3. An existing variant's stock is carried, not reset.** With the ledger ON `updateProduct`
 * ignores a submitted figure (D90), but with it OFF the figure is written — so passing 0 for a
 * variant the sheet does not give a figure for would zero the shelf on exactly the stores that
 * have no ledger to find out from.
 *
 * **4. Matching is by name, which cannot be made safe — only safer.** Normalised (case-folded,
 * whitespace-collapsed), and an ambiguous match is refused rather than guessed, because
 * `Product.name` has no unique constraint and a store can already hold two of the same name.
 */

import { Prisma } from "@/generated/prisma/client";
import { flattenCategories } from "@/lib/categories";
import { matchKeyOf, type ParsedCatalogue, type ProductRow, type StockRow, type VariantRow } from "@/lib/catalogue-sheet/parse";
import { createCategory, listCategories } from "@/lib/data/categories";
import { ProductError, updateProduct, type ProductInput, type VariantInput } from "@/lib/data/products";
import { recordStocktake, StockBatchError } from "@/lib/data/stock-batches";
import { recordVariantOpening, stockLedgerEnabled, type StockActor } from "@/lib/data/stock";
import { encodeMessage } from "@/lib/i18n/types";
import { withTenant } from "@/lib/prisma";
import { slugCandidate, slugify } from "@/lib/slug";
import { MAX_STOCK_LINES } from "@/lib/stock";
import { attributeSignature, variantSetIssues, parseAttributes, type Attributes } from "@/lib/variants";

/** Products one file may touch. Sized against the batch arithmetic below, not guessed. */
export const MAX_IMPORT_PRODUCTS = 500;
/** Rows across both catalogue sheets. */
export const MAX_IMPORT_ROWS = 1_000;
/** Lines one stock-count file may carry. At `MAX_STOCK_LINES` a chunk, that is 20 documents. */
export const MAX_STOCK_IMPORT_LINES = 1_000;
/** Products written per transaction. `duplicateTenant` already batches products at this size. */
const CREATE_BATCH = 25;
/** The product form's own ceiling, so a sheet cannot smuggle past what the form refuses. */
const MAX_VARIANTS_PER_PRODUCT = 100;

export type RowVerdict = "create" | "update" | "unchanged" | "skip";

/** A refusal or a remark, both carrying the spreadsheet row they are about. */
export type RowMessage = { row: number; message: string };

export type PlannedProduct = {
  row: number;
  name: string;
  matchKey: string;
  verdict: RowVerdict;
  /** The product this row resolved to, for an update or an unchanged row. */
  productId: string | null;
  /** An i18n key. Set when the verdict is `skip`. */
  reason?: string;
  /** The category path this row will create, if any. */
  createsCategory?: string;
};

export type CataloguePlan = {
  products: PlannedProduct[];
  /** Full paths that do not exist yet, outermost first, in the order they will be created. */
  newCategories: string[];
  /** Everything wrong with the file, each with its row. */
  issues: RowMessage[];
  /**
   * Variant rows whose stock figure will not be applied, because the option already exists.
   *
   * Offered back to the merchant as a ready-made stock sheet rather than only explained, so a
   * figure typed into the wrong column is one click from the right path instead of re-typed.
   */
  ignoredStock: { row: number; productName: string; attributes: Attributes; stock: number }[];
  /** Variants the sheet did not mention, which are being KEPT. Rule 2, said out loud. */
  keptVariants: { productName: string; label: string }[];
  counts: Record<RowVerdict, number>;
};

export type ImportOutcome = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: RowMessage[];
  categoriesCreated: string[];
  /**
   * Set only when a batch itself failed — a pool timeout, an exhausted slug retry, anything
   * unforeseen. Rows before it are committed; this row and everything after was not attempted.
   */
  stoppedAfterRow?: number;
  stopReason?: string;
};

// --------------------------------------------------------------------------- live state

type LiveVariant = {
  id: string;
  attributes: Attributes;
  stock: number;
  priceCentsOverride: number | null;
  imageUrl: string | null;
};

type LiveProduct = {
  id: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  imageUrl: string;
  isBestSeller: boolean;
  lowStockThreshold: number | null;
  categoryId: string | null;
  variants: LiveVariant[];
  images: { id: string; url: string; altText: string | null }[];
};

/**
 * One read of three small columns, doing three jobs: the name-match index, the ambiguity check,
 * and the taken-slug set the creates allocate against.
 *
 * It is also the reason creates do not go through `createProduct`. That function wraps a 5-attempt
 * retry loop around its own transaction and re-reads every slug matching its base inside each
 * attempt — and reads only *committed* rows, so two rows in one file whose names slugify
 * identically both compute the same suffix and the second collides. 500 creates through it is
 * roughly 2,500 statements across 500 transactions; allocating here and writing in batches of 25
 * is about 580 statements across 20.
 */
async function loadNameIndex(tenantId: string) {
  const rows = await withTenant(tenantId, (db) =>
    db.product.findMany({ where: { tenantId }, select: { id: true, name: true, slug: true } }),
  );
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = matchKeyOf(row.name);
    byKey.set(key, [...(byKey.get(key) ?? []), row.id]);
  }
  return { byKey, takenSlugs: new Set(rows.map((r) => r.slug)) };
}

/** The full current state of the products this sheet matched, and only those. */
async function loadLive(tenantId: string, ids: string[]): Promise<Map<string, LiveProduct>> {
  if (ids.length === 0) return new Map();
  const rows = await withTenant(tenantId, (db) =>
    db.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        description: true,
        basePriceCents: true,
        imageUrl: true,
        isBestSeller: true,
        lowStockThreshold: true,
        categoryId: true,
        variants: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, attributes: true, stock: true, priceCentsOverride: true, imageUrl: true },
        },
        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, url: true, altText: true },
        },
      },
    }),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { ...row, variants: row.variants.map((v) => ({ ...v, attributes: parseAttributes(v.attributes) })) },
    ]),
  );
}

type CategoryIndex = {
  /** Normalised full path → id. */
  byPath: Map<string, string>;
  /** Normalised full path → its parent's path, for creating a chain in order. */
  nodes: { path: string; name: string; parentPath: string | null }[];
};

const pathKey = (parts: string[]) => parts.map((p) => matchKeyOf(p)).join("/");

async function loadCategories(tenantId: string): Promise<CategoryIndex> {
  const flat = flattenCategories(await listCategories(tenantId));
  return {
    byPath: new Map(flat.map((c) => [pathKey(c.path.split(" / ")), c.id])),
    nodes: [],
  };
}

/**
 * The categories a sheet introduces, outermost first.
 *
 * Parent-first is not a nicety: `createCategory` asserts its parent exists, so `Clothing / Shirts`
 * against an empty store has to create `Clothing` and then use its id. Each ancestor of each path
 * is considered, so one cell can introduce a whole chain.
 */
function plannedCategories(
  paths: string[][],
  index: CategoryIndex,
): { path: string; name: string; parentKey: string | null }[] {
  const planned = new Map<string, { path: string; name: string; parentKey: string | null }>();
  for (const parts of paths) {
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth);
      const key = pathKey(prefix);
      if (index.byPath.has(key) || planned.has(key)) continue;
      planned.set(key, {
        path: prefix.join(" / "),
        name: prefix[depth - 1],
        parentKey: depth === 1 ? null : pathKey(parts.slice(0, depth - 1)),
      });
    }
  }
  // Insertion order already walks each path outermost-first, and a nested path's ancestors are
  // visited before it, so the map's own order is the creation order.
  return [...planned.values()];
}

// --------------------------------------------------------------------------- planning

const variantLabelOf = (attributes: Attributes) =>
  Object.entries(attributes).map(([k, v]) => `${k}: ${v}`).join(", ") || "—";

/**
 * Resolves a sheet against live state and decides what each row would do.
 *
 * Writes nothing, so it is also exactly what the preview screen renders — the merchant sees the
 * same verdicts the apply will re-derive. The apply does not trust these: it re-plans, because a
 * product created through the form in between would turn a `create` into a duplicate.
 */
export async function planCatalogueImport(
  tenantId: string,
  parsed: ParsedCatalogue,
): Promise<CataloguePlan> {
  const issues: RowMessage[] = parsed.issues.map((i) => ({ row: i.row ?? 0, message: i.message }));
  const ignoredStock: CataloguePlan["ignoredStock"] = [];
  const keptVariants: CataloguePlan["keptVariants"] = [];

  const rowCount = parsed.products.length + parsed.variants.length;
  if (rowCount > MAX_IMPORT_ROWS) {
    issues.push({ row: 0, message: encodeMessage("import.cap.rows", String(MAX_IMPORT_ROWS)) });
  }
  if (parsed.products.length > MAX_IMPORT_PRODUCTS) {
    issues.push({ row: 0, message: encodeMessage("import.cap.products", String(MAX_IMPORT_PRODUCTS)) });
  }

  const [{ byKey }, categories] = await Promise.all([
    loadNameIndex(tenantId),
    loadCategories(tenantId),
  ]);

  // Every match key the file mentions on either sheet, so a variants-only sheet resolves too.
  const mentioned = new Set<string>([
    ...parsed.products.map((p) => p.matchKey),
    ...parsed.variants.map((v) => v.matchKey),
  ]);
  const matchedIds = [...mentioned].flatMap((key) => {
    const ids = byKey.get(key) ?? [];
    return ids.length === 1 ? ids : [];
  });
  const live = await loadLive(tenantId, matchedIds);

  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const variant of parsed.variants) {
    variantsByProduct.set(variant.matchKey, [...(variantsByProduct.get(variant.matchKey) ?? []), variant]);
  }

  const newCategories = plannedCategories(
    parsed.products.map((p) => p.categoryPath).filter((p): p is string[] => p !== null),
    categories,
  ).map((c) => c.path);

  // A variants-only sheet still has to be planned, so rows are keyed by product, not by the
  // Products sheet. A product named only on the Options sheet gets a synthetic row carrying that
  // sheet's first row number, which is the number the merchant can find.
  const productRows = new Map<string, ProductRow | null>();
  for (const row of parsed.products) productRows.set(row.matchKey, row);
  for (const variant of parsed.variants) {
    if (!productRows.has(variant.matchKey)) productRows.set(variant.matchKey, null);
  }

  const products: PlannedProduct[] = [];
  for (const [matchKey, row] of productRows) {
    const variantRows = variantsByProduct.get(matchKey) ?? [];
    const name = row?.name ?? variantRows[0]?.productName ?? matchKey;
    const at = row?.row ?? variantRows[0]?.row ?? 0;
    const plan = (verdict: RowVerdict, extra: Partial<PlannedProduct> = {}): PlannedProduct => ({
      row: at,
      name,
      matchKey,
      verdict,
      productId: null,
      ...extra,
    });

    const ids = byKey.get(matchKey) ?? [];
    if (ids.length > 1) {
      // `Product.name` has no unique constraint — only `(tenantId, slug)` — so a store can
      // already hold two products of this name. Updating whichever came back first would edit a
      // product at random, which is worse than doing nothing and saying so.
      const reason = encodeMessage("import.issue.ambiguousName", name);
      issues.push({ row: at, message: reason });
      products.push(plan("skip", { reason }));
      continue;
    }

    if (ids.length === 0) {
      if (!row) {
        // Options for a product that is nowhere: neither in the store nor on the Products sheet.
        const reason = encodeMessage("import.issue.unknownProduct", name);
        issues.push({ row: at, message: reason });
        products.push(plan("skip", { reason }));
        continue;
      }
      if (variantRows.length > MAX_VARIANTS_PER_PRODUCT) {
        const reason = "validation.variants.tooMany";
        issues.push({ row: at, message: reason });
        products.push(plan("skip", { reason }));
        continue;
      }
      products.push(plan("create", { createsCategory: row.categoryPath?.join(" / ") }));
      continue;
    }

    const current = live.get(ids[0]);
    if (!current) {
      // The product vanished between the two reads. Rare, and a skip rather than a create: a
      // create here would resurrect something somebody just deleted.
      const reason = encodeMessage("import.issue.unknownProduct", name);
      issues.push({ row: at, message: reason });
      products.push(plan("skip", { reason }));
      continue;
    }

    const union = unionVariants(current, variantRows);
    if ("reason" in union) {
      issues.push({ row: at, message: union.reason });
      products.push(plan("skip", { reason: union.reason, productId: current.id }));
      continue;
    }
    if (union.variants.length > MAX_VARIANTS_PER_PRODUCT) {
      const reason = "validation.variants.tooMany";
      issues.push({ row: at, message: reason });
      products.push(plan("skip", { reason, productId: current.id }));
      continue;
    }

    for (const ignored of union.ignoredStock) ignoredStock.push({ ...ignored, productName: name });
    for (const label of union.keptLabels) keptVariants.push({ productName: name, label });

    const verdict = isUnchanged(current, row, union.variants, categories) ? "unchanged" : "update";
    products.push(
      plan(verdict, {
        productId: current.id,
        createsCategory:
          row?.categoryPath && !categories.byPath.has(pathKey(row.categoryPath))
            ? row.categoryPath.join(" / ")
            : undefined,
      }),
    );
  }

  const counts: Record<RowVerdict, number> = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const product of products) counts[product.verdict]++;

  return { products, newCategories, issues, ignoredStock, keptVariants, counts };
}

/**
 * `existing ∪ sheet` for one product's variants — rule 2, and the whole reason this function has a
 * name of its own.
 *
 * - A sheet row matching an existing variant by its attribute signature updates that variant **in
 *   place**, keeping its id, so carts and past orders keep pointing at it.
 * - An existing variant the sheet does not mention is **carried forward verbatim**. Leaving it out
 *   would delete it and write off its stock.
 * - An existing variant's `stock` is carried, never reset. With the ledger off `updateProduct`
 *   writes the figure it is given, so a 0 here would empty the shelf.
 * - A sheet row with no match is a new variant, and its `stock` is the one place a sheet may set
 *   stock at all (D90: a brand-new variant's figure is the only one this path can honestly take).
 */
function unionVariants(
  current: LiveProduct,
  rows: VariantRow[],
):
  | { reason: string }
  | {
      variants: VariantInput[];
      ignoredStock: { row: number; attributes: Attributes; stock: number }[];
      keptLabels: string[];
    } {
  const bySignature = new Map(current.variants.map((v) => [attributeSignature(v.attributes), v]));
  const named = new Set<string>();
  const ignoredStock: { row: number; attributes: Attributes; stock: number }[] = [];
  const out: VariantInput[] = [];

  // A product currently sold in one version, whose sheet now gives it options, cannot be expressed
  // as a union: the lone attribute-less variant plus an attributed one fails `variantSetIssues`,
  // and the only way through would be to DELETE that variant and write off its stock — which this
  // feature promises never to do. Refused with a reason that names where it can be done instead.
  const onlyDefault =
    current.variants.length === 1 && Object.keys(current.variants[0].attributes).length === 0;
  if (onlyDefault && rows.some((row) => Object.keys(row.attributes).length > 0)) {
    return { reason: "import.issue.firstOptionOnProductScreen" };
  }

  for (const row of rows) {
    const signature = attributeSignature(row.attributes);
    const existing = bySignature.get(signature);
    if (existing) {
      named.add(existing.id);
      if (row.stock !== null && row.stock !== existing.stock) {
        // D90: this path holds `products:write` and has never named `products:stock`. The figure
        // is reported rather than silently dropped, and offered back as a stock sheet.
        ignoredStock.push({ row: row.row, attributes: row.attributes, stock: row.stock });
      }
      out.push({
        id: existing.id,
        attributes: row.attributes,
        stock: existing.stock,
        priceCentsOverride: row.priceOverrideCents ?? existing.priceCentsOverride,
        imageUrl: existing.imageUrl,
      });
    } else {
      out.push({
        attributes: row.attributes,
        stock: row.stock ?? 0,
        priceCentsOverride: row.priceOverrideCents,
        imageUrl: null,
      });
    }
  }

  const keptLabels: string[] = [];
  for (const variant of current.variants) {
    if (named.has(variant.id)) continue;
    keptLabels.push(variantLabelOf(variant.attributes));
    out.push({
      id: variant.id,
      attributes: variant.attributes,
      stock: variant.stock,
      priceCentsOverride: variant.priceCentsOverride,
      imageUrl: variant.imageUrl,
    });
  }

  // The union has to satisfy the same rule the form does, and it can fail where neither half did:
  // a product with `Size` variants whose sheet names `Colour` produces a set that disagrees about
  // its attribute names. Caught here so it is a numbered refusal on the preview, not a thrown
  // error halfway through the apply.
  const setIssues = variantSetIssues(out);
  if (setIssues.length > 0) return { reason: setIssues[0].message };

  return { variants: out, ignoredStock, keptLabels };
}

/**
 * Whether this row would change anything at all.
 *
 * Worth the comparison rather than just issuing the update: the normal workflow is export, edit a
 * few cells, re-import, and without this every untouched row costs its own transaction —
 * 500 of them instead of the handful that really changed. It also makes a double-apply visibly a
 * no-op instead of 500 identical writes.
 */
function isUnchanged(
  current: LiveProduct,
  row: ProductRow | null,
  variants: VariantInput[],
  categories: CategoryIndex,
): boolean {
  if (row) {
    if (row.name !== current.name) return false;
    if (row.description !== null && row.description !== (current.description ?? "")) return false;
    if (row.priceCents !== current.basePriceCents) return false;
    if (row.bestSeller !== null && row.bestSeller !== current.isBestSeller) return false;
    if (row.warnAt !== null && row.warnAt !== current.lowStockThreshold) return false;
    if (row.categoryPath !== null) {
      const id = categories.byPath.get(pathKey(row.categoryPath));
      // A category that does not exist yet is a change by definition — it is about to be created.
      if (id === undefined || id !== current.categoryId) return false;
    }
  }
  if (variants.length !== current.variants.length) return false;
  const byId = new Map(current.variants.map((v) => [v.id, v]));
  for (const variant of variants) {
    if (!variant.id) return false;
    const existing = byId.get(variant.id);
    if (!existing) return false;
    if (attributeSignature(variant.attributes) !== attributeSignature(existing.attributes)) return false;
    if (variant.priceCentsOverride !== existing.priceCentsOverride) return false;
  }
  return true;
}

// --------------------------------------------------------------------------- applying

/** The payload for a create, including the single default variant a product cannot do without. */
function createPayload(
  row: ProductRow,
  rows: VariantRow[],
  categoryId: string | null,
): ProductInput {
  const variants: VariantInput[] = rows.map((variant) => ({
    attributes: variant.attributes,
    stock: variant.stock ?? 0,
    priceCentsOverride: variant.priceOverrideCents,
    imageUrl: null,
  }));
  if (variants.length === 0) {
    // Every product has at least one variant; a product sold in one version has a default one with
    // no attributes. A products-only sheet is a legitimate way to add a catalogue.
    variants.push({ attributes: {}, stock: 0, priceCentsOverride: null, imageUrl: null });
  }
  return {
    name: row.name,
    description: row.description ?? "",
    basePriceCents: row.priceCents,
    imageUrl: "",
    images: [],
    isBestSeller: row.bestSeller ?? false,
    categoryId,
    lowStockThreshold: row.warnAt,
    variants,
  };
}

/**
 * The payload for an update: the live product, with the sheet's cells laid over it.
 *
 * `images` and `imageUrl` come from the snapshot **with their ids**, which is rule 2. A blank cell
 * leaves its field as it is, which is the one rule the whole sheet is built on.
 */
function updatePayload(
  current: LiveProduct,
  row: ProductRow | null,
  variants: VariantInput[],
  categoryId: string | null | undefined,
): ProductInput {
  return {
    name: row?.name ?? current.name,
    description: row?.description ?? current.description ?? "",
    basePriceCents: row?.priceCents ?? current.basePriceCents,
    imageUrl: current.imageUrl,
    images: current.images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.altText ?? undefined,
    })),
    isBestSeller: row?.bestSeller ?? current.isBestSeller,
    categoryId: categoryId === undefined ? current.categoryId : categoryId,
    lowStockThreshold: row?.warnAt ?? current.lowStockThreshold,
    variants,
  };
}

/**
 * Executes a sheet. Re-plans first, so what is reported is what was really done.
 *
 * Failure has two kinds and they are kept apart. A **row** problem was found in the plan, is
 * reported with its line number, and is never attempted. A **batch** problem — a pool timeout, an
 * exhausted slug retry, anything unforeseen — stops the run: batches already committed stay
 * committed, and this row and everything after it are reported as not attempted. Continuing past
 * an infrastructure failure would produce a ragged result with no resume point.
 */
export async function applyCatalogueImport(
  tenantId: string,
  parsed: ParsedCatalogue,
  actor: StockActor,
): Promise<ImportOutcome> {
  const plan = await planCatalogueImport(tenantId, parsed);
  const outcome: ImportOutcome = {
    created: 0,
    updated: 0,
    unchanged: plan.counts.unchanged,
    skipped: plan.products
      .filter((p) => p.verdict === "skip")
      .map((p) => ({ row: p.row, message: p.reason ?? "import.issue.unknownProduct" })),
    categoriesCreated: [],
  };
  if (plan.counts.create + plan.counts.update === 0) return outcome;

  const categories = await loadCategories(tenantId);
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const variant of parsed.variants) {
    variantsByProduct.set(variant.matchKey, [...(variantsByProduct.get(variant.matchKey) ?? []), variant]);
  }
  const productRows = new Map(parsed.products.map((row) => [row.matchKey, row]));

  // Categories first, parent-first, because `createCategory` asserts its parent exists.
  //
  // One transaction each rather than one for all of them: `createCategory` owns slug allocation
  // and its own retry, a sheet rarely introduces more than a handful, and reimplementing that here
  // to save a few transactions is how a second category writer appears.
  const toCreate = plannedCategories(
    parsed.products.map((p) => p.categoryPath).filter((p): p is string[] => p !== null),
    categories,
  );
  for (const node of toCreate) {
    const parentId = node.parentKey === null ? null : categories.byPath.get(node.parentKey) ?? null;
    const created = await createCategory(tenantId, { name: node.name, parentId });
    categories.byPath.set(pathKey(node.path.split(" / ")), created.id);
    outcome.categoriesCreated.push(node.path);
  }

  const categoryIdFor = (row: ProductRow | null): string | null | undefined => {
    if (!row || row.categoryPath === null) return undefined; // blank: leave it alone
    return categories.byPath.get(pathKey(row.categoryPath)) ?? null;
  };

  // ---- creates, in batches
  const creates = plan.products.filter((p) => p.verdict === "create");
  const { takenSlugs } = await loadNameIndex(tenantId);
  for (let i = 0; i < creates.length; i += CREATE_BATCH) {
    const batch = creates.slice(i, i + CREATE_BATCH);
    try {
      const made = await writeCreateBatch(tenantId, batch, {
        productRows,
        variantsByProduct,
        categoryIdFor,
        takenSlugs,
        actor,
      });
      outcome.created += made;
    } catch (error) {
      outcome.stoppedAfterRow = batch[0].row;
      outcome.stopReason = stopReasonOf(error);
      return outcome;
    }
  }

  // ---- updates, one transaction each
  //
  // Through `updateProduct` on purpose. It owns the variant add/remove/keep diff and the three
  // ledger writes that hang off it (D90), and reimplementing that is how the ledger gets a hole in
  // it. 40 updated products is 40 transactions, and that is the right trade here — updates are the
  // smaller half and correctness beats the statement count.
  for (const planned of plan.products) {
    if (planned.verdict !== "update" || !planned.productId) continue;
    const current = (await loadLive(tenantId, [planned.productId])).get(planned.productId);
    if (!current) {
      outcome.skipped.push({ row: planned.row, message: encodeMessage("import.issue.unknownProduct", planned.name) });
      continue;
    }
    const row = productRows.get(planned.matchKey) ?? null;
    const union = unionVariants(current, variantsByProduct.get(planned.matchKey) ?? []);
    if ("reason" in union) {
      outcome.skipped.push({ row: planned.row, message: union.reason });
      continue;
    }
    try {
      const ok = await updateProduct(
        tenantId,
        current.id,
        updatePayload(current, row, union.variants, categoryIdFor(row)),
        actor,
      );
      if (ok) outcome.updated++;
      else outcome.skipped.push({ row: planned.row, message: encodeMessage("import.issue.unknownProduct", planned.name) });
    } catch (error) {
      if (error instanceof ProductError) {
        outcome.skipped.push({ row: planned.row, message: error.code });
        continue;
      }
      outcome.stoppedAfterRow = planned.row;
      outcome.stopReason = stopReasonOf(error);
      return outcome;
    }
  }

  return outcome;
}

function stopReasonOf(error: unknown): string {
  if (error instanceof ProductError) return error.code;
  return "import.error.stopped";
}

/**
 * One transaction, up to 25 products, each a single nested `create`.
 *
 * Slugs are allocated in memory against the taken set, adding each allocation back as it goes, so
 * two rows in one file whose names slugify identically become `linen-shirt` and `linen-shirt-2`
 * instead of colliding — the case `createProduct`'s committed-rows-only read cannot handle.
 */
async function writeCreateBatch(
  tenantId: string,
  batch: PlannedProduct[],
  ctx: {
    productRows: Map<string, ProductRow>;
    variantsByProduct: Map<string, VariantRow[]>;
    categoryIdFor: (row: ProductRow | null) => string | null | undefined;
    takenSlugs: Set<string>;
    actor: StockActor;
  },
): Promise<number> {
  const payloads: { slug: string; input: ProductInput }[] = [];
  for (const planned of batch) {
    const row = ctx.productRows.get(planned.matchKey);
    if (!row) continue;
    const base = slugify(row.name);
    let n = 1;
    while (ctx.takenSlugs.has(slugCandidate(base, n))) n++;
    const slug = slugCandidate(base, n);
    ctx.takenSlugs.add(slug);
    payloads.push({
      slug,
      input: createPayload(row, ctx.variantsByProduct.get(planned.matchKey) ?? [], ctx.categoryIdFor(row) ?? null),
    });
  }
  if (payloads.length === 0) return 0;

  return withTenant(tenantId, async (tx) => {
    const ledgerOn = await stockLedgerEnabled(tx, tenantId);
    const opening: string[] = [];
    for (const { slug, input } of payloads) {
      const created = await tx.product.create({
        data: {
          tenantId,
          slug,
          name: input.name,
          description: input.description,
          basePriceCents: input.basePriceCents,
          imageUrl: input.imageUrl,
          isBestSeller: input.isBestSeller,
          lowStockThreshold: input.lowStockThreshold ?? null,
          categoryId: input.categoryId,
          variants: {
            create: input.variants.map((variant, index) => ({
              attributes: variant.attributes,
              stock: variant.stock,
              priceCentsOverride: variant.priceCentsOverride,
              imageUrl: variant.imageUrl,
              sortOrder: index,
            })),
          },
        },
        select: { variants: { select: { id: true, stock: true } } },
      });
      // A product created with twenty on the shelf is twenty units the ledger has to account for,
      // exactly as `createProduct` records. Variants created empty are skipped: an OPENING of zero
      // states nothing, and the first real movement writes its own.
      if (ledgerOn) opening.push(...created.variants.filter((v) => v.stock > 0).map((v) => v.id));
    }
    if (opening.length > 0) {
      await recordVariantOpening(tx, tenantId, opening, { reason: "OPENING", actor: ctx.actor });
    }
    return payloads.length;
  });
}

// --------------------------------------------------------------------------- the stock sheet

export type StockImportPlan = {
  lines: { row: number; variantId: string; counted: number; label: string; onHand: number }[];
  issues: RowMessage[];
  /** How many `recordStocktake` documents this will become. */
  chunks: number;
};

export type StockImportOutcome = {
  counted: number;
  moved: number;
  batchIds: string[];
  skipped: RowMessage[];
  stoppedAfterRow?: number;
  stopReason?: string;
};

/** Resolves each counted line to a variant of this store, refusing what it cannot place. */
export async function planStockCountImport(
  tenantId: string,
  rows: StockRow[],
): Promise<StockImportPlan> {
  const issues: RowMessage[] = [];
  if (rows.length > MAX_STOCK_IMPORT_LINES) {
    issues.push({ row: 0, message: encodeMessage("import.cap.stockLines", String(MAX_STOCK_IMPORT_LINES)) });
  }

  const { byKey } = await loadNameIndex(tenantId);
  const ids = [...new Set(rows.map((r) => r.matchKey))].flatMap((key) => {
    const found = byKey.get(key) ?? [];
    return found.length === 1 ? found : [];
  });
  const live = await loadLive(tenantId, ids);
  const bySignature = new Map<string, LiveVariant & { productName: string }>();
  for (const product of live.values()) {
    for (const variant of product.variants) {
      bySignature.set(
        `${matchKeyOf(product.name)}\u0000${attributeSignature(variant.attributes)}`,
        { ...variant, productName: product.name },
      );
    }
  }

  const lines: StockImportPlan["lines"] = [];
  for (const row of rows.slice(0, MAX_STOCK_IMPORT_LINES)) {
    const found = byKey.get(row.matchKey) ?? [];
    if (found.length > 1) {
      issues.push({ row: row.row, message: encodeMessage("import.issue.ambiguousName", row.productName) });
      continue;
    }
    const variant = bySignature.get(`${row.matchKey}\u0000${attributeSignature(row.attributes)}`);
    if (!variant) {
      // Either the product is not in this store or that option is not on it. Both are "we cannot
      // place this line", and guessing which shelf was meant is the one thing a stocktake must
      // never do.
      issues.push({
        row: row.row,
        message: encodeMessage("import.issue.unknownOption", row.productName, variantLabelOf(row.attributes)),
      });
      continue;
    }
    lines.push({
      row: row.row,
      variantId: variant.id,
      counted: row.counted,
      label: `${variant.productName} — ${variantLabelOf(variant.attributes)}`,
      onHand: variant.stock,
    });
  }

  return { lines, issues, chunks: Math.ceil(lines.length / MAX_STOCK_LINES) };
}

/**
 * Applies a counted sheet as stocktakes of at most `MAX_STOCK_LINES` lines each.
 *
 * **Chunked rather than one big document, and the cap is not raised.** `MAX_STOCK_LINES`' own
 * docstring already prescribes this — *"A shop counting four hundred lines does it as several
 * stocktakes, which is also how it would walk the shelves"* — and three mechanical reasons agree:
 *
 * - `setStockToMany` holds a `FOR UPDATE` row lock per line for the whole transaction, and those
 *   are the rows checkout and the till wait on. A 500-line document blocks sales on 500 variants
 *   at once; 50 does not.
 * - Chunk ids derived as `` `${importId}#${i}` `` meet the existing `(tenantId, submissionId)`
 *   unique index, so re-running after a failure at chunk 8 answers 1–7 as `idempotent: true` with
 *   no writes at all. One big document gives the opposite.
 * - `readShelves` is all-or-nothing per document, so one removed variant refuses 50 lines, not 500.
 *
 * Every chunk carries the same reference, numbered, which is what that free-text field is for.
 */
export async function applyStockCountImport(
  tenantId: string,
  rows: StockRow[],
  opts: { importId: string; reference: string; note?: string; actor: StockActor },
): Promise<StockImportOutcome> {
  const plan = await planStockCountImport(tenantId, rows);
  const outcome: StockImportOutcome = {
    counted: 0,
    moved: 0,
    batchIds: [],
    skipped: plan.issues.filter((issue) => issue.row > 0),
  };
  if (plan.lines.length === 0) return outcome;

  const chunks: StockImportPlan["lines"][] = [];
  for (let i = 0; i < plan.lines.length; i += MAX_STOCK_LINES) {
    chunks.push(plan.lines.slice(i, i + MAX_STOCK_LINES));
  }

  for (const [index, chunk] of chunks.entries()) {
    try {
      const recorded = await recordStocktake(tenantId, {
        submissionId: `${opts.importId}#${index}`,
        reference: `${opts.reference} (${index + 1}/${chunks.length})`.slice(0, 200),
        note: opts.note,
        actor: opts.actor,
        lines: chunk.map((line) => ({ variantId: line.variantId, counted: line.counted })),
      });
      outcome.batchIds.push(recorded.id);
      outcome.counted += chunk.length;
      // A replay moved nothing: the first write already did. Counting it again would report twice
      // what happened.
      outcome.moved += recorded.applied.filter((applied) => applied.delta !== 0).length;
    } catch (error) {
      outcome.stoppedAfterRow = chunk[0].row;
      outcome.stopReason =
        error instanceof StockBatchError
          ? `stock.error.${error.code}`
          : error instanceof Prisma.PrismaClientKnownRequestError
            ? "import.error.stopped"
            : "import.error.stopped";
      return outcome;
    }
  }

  return outcome;
}
