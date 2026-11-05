"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/lib/i18n/context";

export type SearchTableRow = {
  phrase: string;
  redacted: boolean;
  searches: number;
  searchSessions: number;
  noResultSearches: number;
  resultClickSessions: number;
  noResultRate: number | null;
};

/**
 * Searches, in two lists that must never become one.
 *
 * **What to stock** comes from `demand`, which has the redacted bucket removed. **Everything
 * searched** includes it, counted, labelled as withheld, and with its phrase never printed —
 * because there is no phrase to print: Phase 4 stored the bucket, not the text.
 *
 * The redacted row is rendered as a sentence rather than as a phrase cell, so no amount of CSS
 * or copy-paste turns it into something that looks like a search term a merchant should act on.
 */
export function SearchesView({
  rows,
  demand,
  totalSearches,
}: {
  rows: SearchTableRow[];
  demand: { phrase: string; noResultSearches: number; searches: number }[];
  totalSearches: number;
}) {
  const t = useT();

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("searches.empty")}
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">{t("searches.demand.heading")}</h2>
        {demand.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("searches.demand.none")}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {demand.map((row) => (
              <li key={row.phrase} data-demand={row.phrase} className="flex justify-between gap-4 border-b py-1">
                <span className="font-medium">{row.phrase}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row.noResultSearches} {t("searches.demand.noResults")} / {row.searches}{" "}
                  {t("searches.demand.searches")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("searches.demand.note")}</p>
      </section>

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">{t("searches.all.heading")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("searches.table.phrase")}</TableHead>
              <TableHead className="text-right">{t("searches.table.searches")}</TableHead>
              <TableHead className="text-right">{t("searches.table.sessions")}</TableHead>
              <TableHead className="text-right">{t("searches.table.noResults")}</TableHead>
              <TableHead className="text-right">{t("searches.table.clicked")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.phrase}-${row.redacted}`} data-redacted={row.redacted}>
                <TableCell>
                  {row.redacted ? (
                    <span className="text-muted-foreground">{t("searches.redacted")}</span>
                  ) : (
                    <span className="font-medium">{row.phrase}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.searches}</TableCell>
                <TableCell className="text-right tabular-nums">{row.searchSessions}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.noResultSearches}
                  {row.noResultRate !== null && row.noResultSearches > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      ({(row.noResultRate * 100).toFixed(0)}%)
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.resultClickSessions}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          {t("searches.total").replace("{0}", String(totalSearches))}
        </p>
      </section>
    </div>
  );
}
