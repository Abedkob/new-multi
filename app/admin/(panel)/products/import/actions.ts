"use server";

import { revalidatePath } from "next/cache";

import { cataloguePayloadSchema } from "@/lib/catalogue-sheet/payload";
import { parseCatalogueSheets, type ParsedCatalogue } from "@/lib/catalogue-sheet/parse";
import { readUpload } from "@/lib/catalogue-sheet/upload";
import {
  applyCatalogueImport,
  planCatalogueImport,
  type CataloguePlan,
  type ImportOutcome,
} from "@/lib/data/catalogue-import";
import { requireCapability } from "@/lib/permissions";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { encodeMessage } from "@/lib/i18n/types";

export type CataloguePreviewResult =
  | { error: string }
  | {
      /** The rows the Apply step posts back. Nothing is stored server-side between the two. */
      rows: { products: ParsedCatalogue["products"]; variants: ParsedCatalogue["variants"] };
      plan: CataloguePlan;
      truncated: boolean;
    };

export type CatalogueApplyResult = { error: string } | { outcome: ImportOutcome };

/**
 * Parses an uploaded sheet and says what it would do. Writes nothing.
 *
 * Rate-limited per tenant: parsing a spreadsheet is the most expensive thing a signed-in owner can
 * ask this server to do, and the preview is the half they can repeat freely. Twenty in ten minutes
 * is far beyond any real editing session.
 */
export async function previewCatalogueAction(formData: FormData): Promise<CataloguePreviewResult> {
  const { tenantId } = await requireCapability("products:write");

  const limit = await rateLimit(`catalogue-import:${tenantId}`, RATE_LIMITS.catalogueImport);
  if (!limit.ok) return { error: "import.error.tooMany" };

  const read = await readUpload(formData.get("file"));
  if ("error" in read) return read;
  if (!read.sheets.products && !read.sheets.variants) {
    // The file opened, but none of its sheets is one of ours. Naming what was in it is the
    // difference between a merchant fixing the file and a merchant giving up.
    return { error: encodeMessage("import.error.noCatalogueSheet", read.sheetNames.slice(0, 5).join(", ")) };
  }

  const parsed = parseCatalogueSheets({
    products: read.sheets.products,
    variants: read.sheets.variants,
  });
  const plan = await planCatalogueImport(tenantId, parsed);
  return {
    rows: { products: parsed.products, variants: parsed.variants },
    plan,
    truncated: read.truncated,
  };
}

/**
 * Applies the rows the merchant previewed.
 *
 * The rows are posted, not the file: re-parsing a re-uploaded file could silently differ if they
 * edited it in between, and the rows they looked at are the rows that should land. The *verdicts*
 * are not posted — `applyCatalogueImport` re-plans from live state, because the catalogue can
 * change between the two steps and a `create` decided a minute ago may now be a duplicate.
 */
export async function applyCatalogueAction(payload: unknown): Promise<CatalogueApplyResult> {
  const { tenantId, userId, name } = await requireCapability("products:write");

  const limit = await rateLimit(`catalogue-import:${tenantId}`, RATE_LIMITS.catalogueImport);
  if (!limit.ok) return { error: "import.error.tooMany" };

  const parsed = cataloguePayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "import.error.badPayload" };
  if (parsed.data.products.length + parsed.data.variants.length === 0) {
    return { error: "import.upload.noRows" };
  }

  const outcome = await applyCatalogueImport(tenantId, parsed.data, { userId, name });

  revalidatePath("/admin/products");
  revalidatePath("/admin/categories");
  return { outcome };
}
