/**
 * Turning an uploaded file into grids, with the bounds that make that safe.
 *
 * Server-only (it reaches `workbook.ts`, which reaches the spreadsheet library). The two import
 * actions share it so the size cap, the format sniff and the refusal messages cannot drift apart.
 *
 * **The size is checked on `file.size`, before `arrayBuffer()`.** Reading first and measuring
 * afterwards is the whole vulnerability: a zip archive is the classic shape for a decompression
 * bomb, and `arrayBuffer()` on a 400 MB upload has already happened by the time any check runs.
 * Two more bounds live in `readWorkbook` (rows and columns per sheet), because a *small* archive
 * can still expand to a sheet with a million rows.
 */

import { parseCsv } from "@/lib/catalogue-sheet/csv";
import { guessSheetFromHeaders } from "@/lib/catalogue-sheet/parse";
import { readWorkbook, type SheetGrids } from "@/lib/catalogue-sheet/workbook";

/**
 * 2 MB.
 *
 * Not `MAX_UPLOAD_BYTES` (5 MB, the image limit): a 2 MB spreadsheet is far more rows than
 * `MAX_IMPORT_ROWS` allows anyway, so the lower figure refuses an over-large file before it is
 * read instead of after it is parsed. `bodySizeLimit` is 6mb, so this is not the binding
 * constraint either way — it is the one that produces a sentence a merchant can act on.
 */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export type UploadRead =
  | { error: string }
  | { sheets: SheetGrids; truncated: boolean; sheetNames: string[] };

const CSV_EXTENSIONS = [".csv", ".txt", ".tsv"];
const XLSX_EXTENSIONS = [".xlsx", ".xlsm"];

/**
 * Reads an upload. Errors are i18n keys, because the person reading them is a merchant.
 *
 * The format is decided by extension, not by the browser's `type`: a `Content-Type` on a
 * multipart part is whatever the client said, and Excel files arrive variously as
 * `application/vnd.openxmlformats-…`, `application/octet-stream` or nothing at all depending on
 * the operating system. Getting it wrong is cheap in one direction (a mis-sniffed CSV produces one
 * refusal) and expensive in the other (the library is handed arbitrary bytes), so an `.xls` — the
 * old binary format, which `readWorkbook` cannot read — is refused by name with the fix to make.
 */
export async function readUpload(file: unknown): Promise<UploadRead> {
  if (!(file instanceof File) || file.size === 0) return { error: "import.upload.noFile" };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { error: "import.upload.tooBig" };
  }

  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) return { error: "import.upload.oldExcel" };

  try {
    if (CSV_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      // A CSV is one unnamed sheet, so which of the three it is has to be guessed from its
      // headers. This is also the reason the guess lives in the pure layer.
      const grid = parseCsv(await file.text());
      const id = guessSheetFromHeaders(grid);
      if (!id) return { error: "import.upload.unknownCsv" };
      return { sheets: { [id]: grid }, truncated: false, sheetNames: [file.name] };
    }
    if (XLSX_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      return await readWorkbook(await file.arrayBuffer());
    }
  } catch {
    // A corrupt archive, a file renamed to .xlsx, a password-protected workbook. All the same
    // thing to a merchant — "we could not open this" — and none of them is worth a stack trace in
    // front of them.
    return { error: "import.upload.unreadable" };
  }
  return { error: "import.upload.wrongType" };
}
