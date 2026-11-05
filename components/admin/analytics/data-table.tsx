"use client";

import type { ReactNode } from "react";

export type DataColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Numbers sit at the end of their cell; the first column is the row's name. */
  numeric?: boolean;
};

/**
 * One dense report table, rendered as a table on a desktop and as ranked cards on a phone
 * (§5.9, P5-31).
 *
 * The two layouts are generated from **one** column definition on purpose. The obvious way to
 * build this is a `hidden md:block` table beside a hand-written card list, and that is how a
 * phone ends up with five of the eight columns — nobody notices, because nobody reviewing on a
 * laptop sees the phone. Here a column that exists exists in both, or in neither.
 *
 * Accessibility (P5-29):
 *
 *   - It is a real `<table>` with a `<caption>` and `<th scope>` on both axes, so the figures
 *     are navigable rather than a grid of divs that reads as one long sentence.
 *   - Anything purely visual a caller puts in a cell (a bar, a shade) is theirs to mark
 *     `aria-hidden`; the number is always the content.
 *   - The wrapper scrolls horizontally and is focusable, because a scroll region that cannot be
 *     reached by keyboard is a column a keyboard user cannot read.
 *
 * The cards are an ordered list: the rows arrive sorted (busiest first), and on a phone that
 * order IS the ranking, so `<ol>` says what `<div>`s would only look like.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowAttrs,
  caption,
  note,
}: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Data attributes a verification script or a test can hook onto. */
  rowAttrs?: (row: T) => Record<string, string>;
  caption: string;
  note?: string;
}) {
  const [first, ...rest] = columns;

  return (
    <div className="grid gap-2">
      {/* Desktop: the table. */}
      <div
        className="hidden overflow-x-auto md:block"
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        <table className="w-full text-sm">
          <caption className="pb-2 text-start text-sm text-muted-foreground">{caption}</caption>
          <thead>
            <tr className="text-muted-foreground">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`py-1 font-medium ${column.numeric ? "text-end" : "text-start"}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t" {...(rowAttrs?.(row) ?? {})}>
                <th scope="row" className="py-2 text-start font-normal align-top">
                  {first.cell(row)}
                </th>
                {rest.map((column) => (
                  <td
                    key={column.key}
                    className={`py-2 align-top tabular-nums ${column.numeric ? "text-end" : "text-start"}`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: the same columns, as ranked cards. */}
      <ol className="grid gap-2 md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="grid gap-2 rounded-lg border p-3"
            {...(rowAttrs?.(row) ?? {})}
          >
            <div className="text-sm font-medium">{first.cell(row)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {rest.map((column) => (
                <div key={column.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-muted-foreground">{column.header}</dt>
                  <dd className="tabular-nums">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
