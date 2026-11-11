/**
 * The response shape a workbook download needs.
 *
 * In its own file rather than beside the route handler, because Next validates `route.ts`'s
 * exports against a fixed set — a handler, and a small number of config constants. An extra
 * `export function` there fails the build with a type error about the route not matching the
 * required shape, so a helper two route handlers share has to live outside both.
 */

import { slugify } from "@/lib/slug";

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A download's filename, as a header value.
 *
 * Through `slugify`, never the store's own name — a tenant name is owner-controlled text, and a
 * quote or a newline in a `Content-Disposition` header is a header-injection primitive. `slugify`
 * reduces anything to `[a-z0-9-]` and falls back to `item`, so no input survives it as
 * punctuation.
 */
export function attachmentHeader(kind: string, storeName: string): string {
  return `attachment; filename="${kind}-${slugify(storeName)}.xlsx"`;
}

/** An `.xlsx` as a download. `no-store` because every one of these carries one store's data. */
export function workbookResponse(bytes: Buffer, kind: string, storeName: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": attachmentHeader(kind, storeName),
      "Cache-Control": "no-store",
    },
  });
}
