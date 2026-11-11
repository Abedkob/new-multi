/**
 * CSV, read and written by hand — RFC 4180 plus the things real spreadsheets actually do.
 *
 * Pure and dependency-free, in the style of `lib/domain-format.ts`, so every quirk below is a
 * table of inputs in `pnpm verify:sheet` with no file, no database and no browser. A CSV reader is
 * forty lines and a hundred edge cases; the edge cases are the whole value, and they are listed
 * here rather than discovered by a merchant whose product description contained a comma.
 *
 * What this handles, and why each one is here:
 *
 * - **A BOM**, which Excel writes on every "CSV UTF-8" save. Left in place it becomes part of the
 *   first header cell, so `Product` stops matching and the whole file reads as unknown columns.
 * - **CRLF, LF and lone CR**, because the three platforms disagree and a file travels.
 * - **Quoted fields** with embedded delimiters, embedded newlines and doubled quotes.
 * - **`;` and tab delimiters.** Excel writes the *system list separator*, which is `;` across most
 *   of Europe and the Middle East — a merchant there saves as CSV and gets semicolons without ever
 *   choosing them. Sniffed from the first line rather than configured, because a merchant cannot
 *   be asked what their Windows regional settings are.
 * - **Formula injection on write.** A cell beginning `=`, `+`, `-`, `@` or a control character is
 *   executed by Excel when the file is opened. A product name is attacker-controllable in the
 *   sense that matters here: a shop's own catalogue is exported, mailed to an accountant, and
 *   opened. Prefixed with a tab, which Excel strips on display, so the value still reads correctly.
 */

const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/**
 * Guesses the delimiter from the first line, counting only separators OUTSIDE quotes — a header
 * like `"Product, size";Price` has one real separator and one decoy, and counting raw characters
 * gets it backwards.
 *
 * Ties go to the comma: it is both the standard and what our own template writes.
 */
export function sniffDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "\n" || ch === "\r") break; // first line only
    const current = counts.get(ch as Delimiter);
    if (current !== undefined) counts.set(ch as Delimiter, current + 1);
  }
  let best: Delimiter = ",";
  for (const d of DELIMITERS) {
    if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  }
  return best;
}

/**
 * Reads a CSV document into a grid of trimmed-as-written cells.
 *
 * Cells are returned verbatim (no trimming) — trimming is the parser's job, where a column's kind
 * decides what whitespace means. Rows are ragged: a short row is not padded, because padding would
 * make "the merchant deleted this column" indistinguishable from "the merchant left it blank".
 */
export function parseCsv(input: string, delimiter?: Delimiter): string[][] {
  const text = input.replace(/^﻿/, "");
  const sep = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      // A quote mid-field (`ab"cd`) is a literal, not an opening quote. Excel never writes that,
      // but a hand-edited file does, and refusing the row would be worse than reading it.
      if (!fieldStarted) {
        quoted = true;
        fieldStarted = true;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === sep) {
      endField();
      continue;
    }

    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }

    fieldStarted = true;
    field += ch;
  }

  // A trailing newline must not invent a final blank row; anything else in flight must be kept.
  if (field !== "" || row.length > 0 || quoted) endRow();

  return rows;
}

/** `=`, `+`, `-`, `@`, tab, CR — the characters Excel and LibreOffice treat as a formula start. */
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: string, sep: Delimiter): string {
  const guarded = FORMULA_START.test(value) ? `\t${value}` : value;
  const needsQuotes =
    guarded.includes(sep) ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r") ||
    guarded !== guarded.trim();
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Writes a grid as CSV.
 *
 * CRLF line endings and a BOM, both for Excel: without the BOM it reads a UTF-8 file in the system
 * codepage, which turns every Arabic product name into mojibake — and this platform's merchants
 * write Arabic product names.
 */
export function writeCsv(
  rows: readonly (readonly string[])[],
  opts: { delimiter?: Delimiter; bom?: boolean } = {},
): string {
  const sep = opts.delimiter ?? ",";
  const body = rows.map((row) => row.map((cell) => escapeCell(cell ?? "", sep)).join(sep)).join("\r\n");
  return `${opts.bom === false ? "" : "﻿"}${body}${rows.length ? "\r\n" : ""}`;
}
