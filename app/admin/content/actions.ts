"use server";

import { CONTENT_KEYS } from "@/lib/content";
import { saveContent } from "@/lib/data/content";
import { setSectionVisible } from "@/lib/data/sections";
import { optionalSectionSchema } from "@/lib/sections";
import { requireOwner } from "@/lib/session";
import { RATE_LIMITS, rateLimit, retryAfterText } from "@/lib/rate-limit";
import { importImageFromUrl, isOwnImageUrl, storeImage } from "@/lib/storage";
import { contentSchema, type FormState } from "@/lib/validation";

export type ContentFormState = FormState & {
  // The values that were stored (or, on a validation error, the ones submitted), so the
  // editor can show exactly what the server has.
  values?: Record<string, string>;
};

/**
 * Saves every content field. Only known keys are read from `values` and every key is
 * editable whether or not its section is switched on. The tenant comes from the session.
 */
export async function saveContentAction(
  values: Record<string, string>,
  visibility?: Record<string, boolean>
): Promise<ContentFormState> {
  const { tenantId } = await requireOwner();

  const entries = CONTENT_KEYS.map((c) => ({
    key: c.key as string,
    value: typeof values?.[c.key] === "string" ? values[c.key] : "",
  }));
  const submitted = Object.fromEntries(entries.map((e) => [e.key, e.value]));

  const parsed = contentSchema.safeParse({ entries });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const [, index] = issue.path;
      const key = typeof index === "number" ? entries[index]?.key : undefined;
      if (key) (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      error: "Some fields need attention.",
      fieldErrors,
      values: submitted,
    };
  }

  await saveContent(tenantId, parsed.data.entries);
  
  if (visibility) {
    for (const [key, val] of Object.entries(visibility)) {
      const parsedSection = optionalSectionSchema.safeParse(key);
      if (parsedSection.success && typeof val === "boolean") {
        await setSectionVisible(tenantId, parsedSection.data, val);
      }
    }
  }

  return {
    ok: true,
    values: Object.fromEntries(parsed.data.entries.map((e) => [e.key, e.value])),
  };
}

export type UploadImageResult = { url?: string; error?: string };

/**
 * Stores an uploaded image (R2, or local disk in development — see lib/storage.ts) for any
 * owner image field: content (logo, hero...), products, variants and categories.
 */
export async function uploadImageAction(formData: FormData): Promise<UploadImageResult> {
  const { tenantId } = await requireOwner();

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose an image file." };
  return storeImage(tenantId, file);
}

/**
 * Copies the image behind a pasted link into our storage (see importImageFromUrl). A link that's
 * already ours comes back unchanged without counting against the rate limit.
 */
export async function importImageUrlAction(link: string): Promise<UploadImageResult> {
  const { tenantId } = await requireOwner();
  if (typeof link !== "string" || !link.trim() || link.length > 2000) {
    return { error: "That doesn't look like a link." };
  }
  if (isOwnImageUrl(link.trim())) return { url: link.trim() };

  const limit = await rateLimit(`image-import:${tenantId}`, RATE_LIMITS.imageImport);
  if (!limit.ok) {
    return { error: `Too many imports. Try again in ${retryAfterText(limit.retryAfterMs)}.` };
  }
  return importImageFromUrl(tenantId, link);
}

/**
 * Store owners can switch the four optional sections on and off. Content is never
 * touched here, so switching a section back on restores what was already written.
 */
export async function setSectionVisibilityAction(
  section: string,
  visible: boolean,
): Promise<FormState> {
  const { tenantId } = await requireOwner();

  const parsedSection = optionalSectionSchema.safeParse(section);
  if (!parsedSection.success || typeof visible !== "boolean") {
    return { error: "Unknown section." };
  }

  await setSectionVisible(tenantId, parsedSection.data, visible);
  return { ok: true };
}
