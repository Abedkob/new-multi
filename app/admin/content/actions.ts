"use server";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONTENT_KEYS } from "@/lib/content";
import { saveContent } from "@/lib/data/content";
import { setSectionVisible } from "@/lib/data/sections";
import { optionalSectionSchema } from "@/lib/sections";
import { requireOwner } from "@/lib/session";
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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export type UploadImageResult = { url?: string; error?: string };

/**
 * Stores an uploaded image on local disk under public/uploads/<tenantId>/, for content image
 * fields (logo, hero, etc). Local disk only for now: fine on a single server, but a fresh
 * deploy or a second instance won't have the file. Swap for real object storage (S3, R2...)
 * before that matters.
 */
export async function uploadImageAction(formData: FormData): Promise<UploadImageResult> {
  const { tenantId } = await requireOwner();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Image must be 5MB or smaller." };
  const ext = UPLOAD_EXTENSIONS[file.type];
  if (!ext) return { error: "Use a PNG, JPG, WEBP, GIF or SVG image." };

  const dir = path.join(process.cwd(), "public", "uploads", tenantId);
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  return { url: `/uploads/${tenantId}/${filename}` };
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
