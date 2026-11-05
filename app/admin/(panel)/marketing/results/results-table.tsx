"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

export type ResultsRow = {
  campaign: string;
  label: string;
  sessions: number;
  /** Null when some day in the range never measured it (D48) — unknown, not zero. */
  visitorDays: number | null;
  orders: number;
  orderValueCents: number;
  whatsappClickSessions: number;
  whatsappPotentialValueCents: number | null;
  conversionRate: number | null;
};

/**
 * What each campaign brought in.
 *
 * The one rule this table exists to keep is that a missing number and a zero look different.
 *
 *   - **0** is a measured fact: nobody clicked.
 *   - **"—"**, with a footnote, is "this range reaches back before the store started counting
 *     this" (D48). A day recorded before those columns existed holds null, and summing it as 0
 *     would produce a total that is too small and looks exact.
 *
 * `sessions` and `orders` have been counted since Phase 4's first day, so they are always
 * numbers. Visitors, and the WhatsApp potential value, are the two that can be unknown.
 *
 * Money and interest are in separate columns under separate headings and are never added: an
 * order value is what someone owes, a WhatsApp potential value is what the basket was worth when
 * somebody asked a question (§3.4).
 */
export function ResultsTable({ rows }: { rows: ResultsRow[] }) {
  const t = useT();

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("results.empty")}
      </p>
    );
  }

  const unmeasured = rows.some(
    (r) => r.visitorDays === null || r.whatsappPotentialValueCents === null,
  );

  return (
    <div className="grid gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("results.table.campaign")}</TableHead>
            <TableHead className="text-right">{t("results.table.visits")}</TableHead>
            <TableHead className="text-right">{t("results.table.visitorDays")}</TableHead>
            <TableHead className="text-right">{t("results.table.orders")}</TableHead>
            <TableHead className="text-right">{t("results.table.orderValue")}</TableHead>
            <TableHead className="text-right">{t("results.table.whatsappClicks")}</TableHead>
            <TableHead className="text-right">{t("results.table.whatsappInterest")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.campaign} data-campaign={row.campaign}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="font-medium">{row.label}</span>
                  <span className="text-xs text-muted-foreground">
                    <code>utm_campaign={row.campaign}</code>
                    {row.conversionRate !== null
                      ? ` · ${(row.conversionRate * 100).toFixed(1)}% ${t("results.table.conversion")}`
                      : ""}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.visitorDays ?? <span title={t("results.unmeasured")}>—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.orders}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPrice(row.orderValueCents)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.whatsappClickSessions}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.whatsappPotentialValueCents === null ? (
                  <span title={t("results.unmeasured")}>—</span>
                ) : (
                  formatPrice(row.whatsappPotentialValueCents)
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t("results.table.whatsappNote")}</p>
      {unmeasured ? <p className="text-xs text-muted-foreground">{t("results.unmeasured")}</p> : null}
    </div>
  );
}
