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

  return (
    <div className="grid gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("productsReport.table.product")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.viewSessions")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.viewers")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.carts")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.whatsapp")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.orders")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.units")}</TableHead>
            <TableHead className="text-right">{t("productsReport.table.orderValue")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.productId} data-product={row.productId}>
              <TableCell>
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
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.viewSessions}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.viewerDays === null ? (
                  <span title={t("reports.unmeasured")}>—</span>
                ) : (
                  <>
                    {row.viewerDays}
                    {row.returningViewerDays !== null ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        ({row.returningViewerDays} {t("productsReport.table.returning")})
                      </span>
                    ) : null}
                  </>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.addToCartSessions}</TableCell>
              <TableCell className="text-right tabular-nums">{row.whatsappClickSessions}</TableCell>
              <TableCell className="text-right tabular-nums">{row.purchasingSessions}</TableCell>
              <TableCell className="text-right tabular-nums">{row.unitsOrdered}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPrice(row.orderValueCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t("productsReport.table.note")}</p>
    </div>
  );
}
