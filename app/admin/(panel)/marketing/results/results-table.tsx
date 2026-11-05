"use client";

import { DataTable, type DataColumn } from "@/components/admin/analytics/data-table";
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
  const unknown = <span title={t("results.unmeasured")}>—</span>;

  const columns: DataColumn<ResultsRow>[] = [
    {
      key: "campaign",
      header: t("results.table.campaign"),
      cell: (row) => (
        <div className="grid gap-0.5">
          <span className="font-medium">{row.label}</span>
          <span className="text-xs text-muted-foreground">
            <code>utm_campaign={row.campaign}</code>
            {row.conversionRate !== null
              ? ` · ${(row.conversionRate * 100).toFixed(1)}% ${t("results.table.conversion")}`
              : ""}
          </span>
        </div>
      ),
    },
    { key: "visits", header: t("results.table.visits"), numeric: true, cell: (r) => r.sessions },
    {
      key: "visitorDays",
      header: t("results.table.visitorDays"),
      numeric: true,
      cell: (r) => r.visitorDays ?? unknown,
    },
    { key: "orders", header: t("results.table.orders"), numeric: true, cell: (r) => r.orders },
    {
      key: "orderValue",
      header: t("results.table.orderValue"),
      numeric: true,
      cell: (r) => formatPrice(r.orderValueCents),
    },
    {
      key: "whatsapp",
      header: t("results.table.whatsappClicks"),
      numeric: true,
      cell: (r) => r.whatsappClickSessions,
    },
    {
      key: "whatsappValue",
      header: t("results.table.whatsappInterest"),
      numeric: true,
      cell: (r) =>
        r.whatsappPotentialValueCents === null ? unknown : formatPrice(r.whatsappPotentialValueCents),
    },
  ];

  return (
    <div className="grid gap-2">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.campaign}
        rowAttrs={(row) => ({ "data-campaign": row.campaign })}
        caption={t("results.page.description")}
        note={t("results.table.whatsappNote")}
      />
      {unmeasured ? <p className="text-xs text-muted-foreground">{t("results.unmeasured")}</p> : null}
    </div>
  );
}
