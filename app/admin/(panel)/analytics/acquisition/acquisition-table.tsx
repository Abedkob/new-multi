"use client";

import { DataTable, type DataColumn } from "@/components/admin/analytics/data-table";
import { formatPrice } from "@/lib/format";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { useT } from "@/lib/i18n/context";

/** The six kinds lib/analytics/attribution.ts can produce, named for a merchant. */
const KIND_LABEL: Record<string, DictionaryKey> = {
  campaign: "acquisition.kind.campaign",
  paid: "acquisition.kind.paid",
  social: "acquisition.kind.social",
  search: "acquisition.kind.search",
  referral: "acquisition.kind.referral",
  direct: "acquisition.kind.direct",
};

export type AcquisitionTableRow = {
  key: string;
  sourceKind: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  visitorDays: number | null;
  orders: number;
  orderValueCents: number;
  whatsappClickSessions: number;
  conversionRate: number | null;
};

/**
 * One row per source, with the campaign that came with it.
 *
 * A source with no name is "direct" — someone typed the address or opened a bookmark — and it is
 * labelled as that rather than left blank, because a blank row reads as a bug. Visitors can be
 * unknown for part of a range (D48); that renders "—" with an explanation and never 0.
 */
export function AcquisitionTable({
  rows,
  basis,
}: {
  rows: AcquisitionTableRow[];
  basis: "last" | "first";
}) {
  const t = useT();

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("acquisition.empty")}
      </p>
    );
  }

  const unmeasured = rows.some((r) => r.visitorDays === null);

  const columns: DataColumn<AcquisitionTableRow>[] = [
    {
      key: "source",
      header: t("acquisition.table.source"),
      cell: (row) => (
        <div className="grid gap-0.5">
          <span className="font-medium">
            {row.source ||
              (KIND_LABEL[row.sourceKind] ? t(KIND_LABEL[row.sourceKind]) : row.sourceKind)}
          </span>
          <span className="text-xs text-muted-foreground">
            {[row.medium, row.campaign].filter(Boolean).join(" · ")}
            {row.conversionRate !== null
              ? ` · ${(row.conversionRate * 100).toFixed(1)}% ${t("acquisition.table.conversion")}`
              : ""}
          </span>
        </div>
      ),
    },
    {
      key: "sessions",
      header: t("acquisition.table.sessions"),
      numeric: true,
      cell: (r) => r.sessions,
    },
    {
      key: "visitorDays",
      header: t("acquisition.table.visitorDays"),
      numeric: true,
      cell: (r) => r.visitorDays ?? <span title={t("reports.unmeasured")}>—</span>,
    },
    {
      key: "orders",
      header: t(basis === "last" ? "acquisition.table.ordersLast" : "acquisition.table.ordersFirst"),
      numeric: true,
      cell: (r) => r.orders,
    },
    {
      key: "orderValue",
      header: t("acquisition.table.orderValue"),
      numeric: true,
      cell: (r) => formatPrice(r.orderValueCents),
    },
    {
      key: "whatsapp",
      header: t("acquisition.table.whatsapp"),
      numeric: true,
      cell: (r) => r.whatsappClickSessions,
    },
  ];

  return (
    <div className="grid gap-2">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        rowAttrs={(row) => ({ "data-source": row.source || row.sourceKind })}
        caption={t("acquisition.page.description")}
        note={t("acquisition.table.note")}
      />
      {unmeasured ? <p className="text-xs text-muted-foreground">{t("reports.unmeasured")}</p> : null}
    </div>
  );
}
