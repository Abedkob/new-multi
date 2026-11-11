"use server";

import { revalidatePath } from "next/cache";

import { stockPayloadSchema } from "@/lib/catalogue-sheet/payload";
import { parseStockSheet, type StockRow } from "@/lib/catalogue-sheet/parse";
import { readUpload } from "@/lib/catalogue-sheet/upload";
import {
  applyStockCountImport,
  planStockCountImport,
  type StockImportOutcome,
  type StockImportPlan,
} from "@/lib/data/catalogue-import";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getTenantById } from "@/lib/data/tenants";
import { encodeMessage } from "@/lib/i18n/types";
import { requireCapability } from "@/lib/permissions";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { canMoveStock } from "@/lib/stock";

export type StockPreviewResult =
  | { error: string }
  | { rows: StockRow[]; plan: StockImportPlan; truncated: boolean };

export type StockApplyResult = { error: string } | { outcome: StockImportOutcome };

/**
 * The module gate, enforced in the action and not only by the layout.
 *
 * A server action is its own HTTP endpoint: somebody who kept this screen open after a platform
 * operator switched the module off, or who posts straight to the action, meets the same refusal
 * that `recordStocktake` would give them — just earlier, and in words.
 *
 * It takes a tenantId rather than fetching the session, because **each action calls
 * `requireCapability` itself**. Wrapping both in one helper read better and failed
 * `verify:permissions`, correctly: that rule exists so a reader of one function can see its guard,
 * and "the guard is in a helper somewhere" is exactly how a guard goes missing. The capability is
 * now visible in every function that needs it, and this helper answers the narrower question.
 */
async function movable(tenantId: string): Promise<boolean> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return false;
  const license = await getLicenseAccessSnapshot(tenantId);
  return canMoveStock({ ...tenant, license });
}

/** Resolves a counted sheet against the shelves, writing nothing. */
export async function previewStockCountAction(formData: FormData): Promise<StockPreviewResult> {
  const { tenantId } = await requireCapability("stock:move");
  if (!(await movable(tenantId))) return { error: "stock.error.FEATURE_OFF" };

  const limit = await rateLimit(`catalogue-import:${tenantId}`, RATE_LIMITS.catalogueImport);
  if (!limit.ok) return { error: "import.error.tooMany" };

  const read = await readUpload(formData.get("file"));
  if ("error" in read) return read;
  if (!read.sheets.stock) {
    return { error: encodeMessage("import.error.noStockSheet", read.sheetNames.slice(0, 5).join(", ")) };
  }

  const parsed = parseStockSheet(read.sheets.stock);
  const plan = await planStockCountImport(tenantId, parsed.rows);
  return {
    rows: parsed.rows,
    // The parser's own complaints and the planner's are the same kind of thing to the merchant —
    // a numbered line they must fix — so they are shown as one list.
    plan: { ...plan, issues: [...parsed.issues.map((i) => ({ row: i.row ?? 0, message: i.message })), ...plan.issues] },
    truncated: read.truncated,
  };
}

/**
 * Records the count as stocktakes of at most 50 lines each.
 *
 * `importId` comes from the client and is minted once per previewed file, so a double-tapped Apply
 * is answered by the existing `(tenantId, submissionId)` unique index rather than counting the
 * shelf twice. That is the one piece of state the browser legitimately owns here.
 */
export async function applyStockCountAction(payload: unknown): Promise<StockApplyResult> {
  const { tenantId, userId, name } = await requireCapability("stock:move");
  if (!(await movable(tenantId))) return { error: "stock.error.FEATURE_OFF" };

  const limit = await rateLimit(`catalogue-import:${tenantId}`, RATE_LIMITS.catalogueImport);
  if (!limit.ok) return { error: "import.error.tooMany" };

  const parsed = stockPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "import.error.badPayload" };

  const outcome = await applyStockCountImport(tenantId, parsed.data.rows, {
    importId: parsed.data.importId,
    reference: parsed.data.reference || "Import",
    actor: { userId, name },
  });

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/history");
  return { outcome };
}
