/**
 * The rows the Apply step posts back, validated as though they came from a stranger.
 *
 * They did not — they came from our own preview, which parsed a file this owner uploaded. But the
 * Apply action is its own HTTP endpoint and the payload travels through a browser, so it is
 * attacker-controlled in the only sense that matters: whatever a client sends is what arrives.
 *
 * **The match key is recomputed, never trusted.** That single line is the point of this file.
 * Matching is by name, so a payload claiming `name: "Cheap Mug"` with
 * `matchKey: "expensive rug"` would update a product the merchant never named — a trivially
 * forged cross-product write, inside their own store, past every capability check. Recomputing it
 * from the name makes the key a function of the data rather than a field.
 *
 * The *verdicts* are not posted at all, for the same reason: `applyCatalogueImport` re-plans from
 * live state and derives them again. `pnpm verify:import` feeds the action a payload whose numbers
 * disagree with the file to prove it.
 */

import { z } from "zod";

import { matchKeyOf } from "@/lib/catalogue-sheet/parse";
import { MAX_IMPORT_PRODUCTS, MAX_IMPORT_ROWS, MAX_STOCK_IMPORT_LINES } from "@/lib/data/catalogue-import";
import { MAX_STOCK } from "@/lib/variants";

/** Mirrors the spreadsheet's own row numbers; only ever shown back to the merchant. */
const rowNumber = z.number().int().min(0).max(1_048_576);
const wholeStock = z.number().int().min(0).max(MAX_STOCK);
const cents = z.number().int().min(0).max(100_000_000);

/** An attribute set, with `variantInputSchema`'s own limits. */
const attributes = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80))
  .refine((value) => Object.keys(value).length <= 10, { message: "validation.attributes.tooMany" });

const productRow = z
  .object({
    row: rowNumber,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(5_000).nullable(),
    priceCents: cents,
    categoryPath: z.array(z.string().trim().min(1).max(80)).min(1).max(4).nullable(),
    bestSeller: z.boolean().nullable(),
    warnAt: wholeStock.nullable(),
  })
  .transform((row) => ({ ...row, matchKey: matchKeyOf(row.name) }));

const variantRow = z
  .object({
    row: rowNumber,
    productName: z.string().trim().min(1).max(120),
    attributes,
    stock: wholeStock.nullable(),
    priceOverrideCents: cents.nullable(),
  })
  .transform((row) => ({ ...row, matchKey: matchKeyOf(row.productName) }));

const stockRow = z
  .object({
    row: rowNumber,
    productName: z.string().trim().min(1).max(120),
    attributes,
    counted: wholeStock,
  })
  .transform((row) => ({ ...row, matchKey: matchKeyOf(row.productName) }));

export const cataloguePayloadSchema = z
  .object({
    products: z.array(productRow).max(MAX_IMPORT_PRODUCTS),
    variants: z.array(variantRow).max(MAX_IMPORT_ROWS),
  })
  .refine((value) => value.products.length + value.variants.length <= MAX_IMPORT_ROWS, {
    message: "import.cap.rows",
  })
  .transform((value) => ({ ...value, issues: [], rejectedProducts: [] }));

export const stockPayloadSchema = z.object({
  rows: z.array(stockRow).min(1).max(MAX_STOCK_IMPORT_LINES),
  /**
   * The id that makes a re-submission idempotent. Minted by the client once per previewed file, so
   * a double-tapped Apply or a retry after an ambiguous network failure meets the existing
   * `(tenantId, submissionId)` unique index and is answered rather than applied twice.
   */
  importId: z.string().uuid(),
  reference: z.string().trim().max(160),
});

export type CataloguePayload = z.input<typeof cataloguePayloadSchema>;
export type StockPayload = z.input<typeof stockPayloadSchema>;
