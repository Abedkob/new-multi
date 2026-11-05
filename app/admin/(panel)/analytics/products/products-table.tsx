"use client";

import { DataTable, type DataColumn } from "@/components/admin/analytics/data-table";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

export type ProductReportRow = {
  productId: string;
  /** Null means no day in the range recorded a name — print "Deleted product" (P5-07, D44). */
  productName: string | null;
  viewSessions: number;
  viewerDays: number | null;
  returningViewerDays: number | null;
  addToCartSessions: number;
  whatsappClickSessions: number;
  purchasingSessions: number;
  unitsOrdered: number;
  orderValueCents: number;
  conversionRate: number | null;
};

export function ProductsTable({ rows }: { rows: ProductReportRow[] }) {
  const t = useT();

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("productsReport.empty")}
      </p>
    );
  }

  const columns: DataColumn<ProductReportRow>[] = [
    {
      key: "product",
      header: t("productsReport.table.product"),
      cell: (row) => (
        <div className="grid gap-0.5">
          {/* The snapshot name, which a deleted product still has. Never an empty cell. */}
          <span className="font-medium">{row.productName ?? t("productsReport.unnamed")}</span>
          {row.productName === null ? (
            <span className="text-xs text-muted-foreground">{t("productsReport.deleted")}</span>
          ) : null}
          {row.conversionRate !== null ? (
            <span className="text-xs text-muted-foreground">
              {(row.conversionRate * 100).toFixed(1)}% {t("productsReport.table.conversion")}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "viewSessions",
      header: t("productsReport.table.viewSessions"),
      numeric: true,
      cell: (r) => r.viewSessions,
    },
    {
      key: "viewers",
      header: t("productsReport.table.viewers"),
      numeric: true,
      cell: (r) =>
        r.viewerDays === null ? (
          <span title={t("reports.unmeasured")}>—</span>
        ) : (
          <>
            {r.viewerDays}
            {r.returningViewerDays !== null ? (
              <span className="text-xs text-muted-foreground">
                {" "}
                ({r.returningViewerDays} {t("productsReport.table.returning")})
              </span>
            ) : null}
          </>
        ),
    },
    {
      key: "carts",
      header: t("productsReport.table.carts"),
      numeric: true,
      cell: (r) => r.addToCartSessions,
    },
    {
      key: "whatsapp",
      header: t("productsReport.table.whatsapp"),
      numeric: true,
      cell: (r) => r.whatsappClickSessions,
    },
    {
      key: "orders",
      header: t("productsReport.table.orders"),
      numeric: true,
      cell: (r) => r.purchasingSessions,
    },
    {
      key: "units",
      header: t("productsReport.table.units"),
      numeric: true,
      cell: (r) => r.unitsOrdered,
    },
    {
      key: "orderValue",
      header: t("productsReport.table.orderValue"),
      numeric: true,
      cell: (r) => formatPrice(r.orderValueCents),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.productId}
      rowAttrs={(row) => ({ "data-product": row.productId })}
      caption={t("productsReport.page.description")}
      note={t("productsReport.table.note")}
    />
  );
}
