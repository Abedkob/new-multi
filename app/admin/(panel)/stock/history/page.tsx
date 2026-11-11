import Link from "next/link";
import { History } from "lucide-react";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { StatusFilter, type StatusFilterTab } from "@/components/admin/status-filter";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStockBatch, listStockMovementsPage } from "@/lib/data/stock-ledger";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { STOCK_MOVEMENT_REASONS, maySeeStockCost, stockActorKey } from "@/lib/stock";
import { parseAttributes, variantLabel } from "@/lib/variants";
import { cn } from "@/lib/utils";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Every change to every stock figure, newest first.
 *
 * This screen is the answer to the question the whole module exists for — "why is this number what
 * it is?" — so three things about it are not cosmetic:
 *
 *  - **a reason is always a sentence, never the enum.** `SALE` and `ORDER_CANCELLED` mean nothing
 *    to a shopkeeper, and a screen that leaks them reads as a developer tool.
 *  - **a row about a deleted variant still reads.** It falls back to the name and attributes
 *    snapshotted on the movement, and says so — that row is the only surviving record of the stock
 *    that variant held (D90).
 *  - **unit cost is absent for staff, not hidden.** `maySeeStockCost` decides whether the column
 *    exists at all, and the figure is left out of the query itself (D92).
 */
export default async function StockHistoryPage({
  searchParams,
}: PageProps<"/admin/stock/history">) {
  const { tenantId, role } = await requireCapability("stock:read");
  const t = await getT();
  const withCost = maySeeStockCost(role);

  const sp = await searchParams;
  const requested = Number.parseInt(first(sp.page) ?? "1", 10) || 1;
  const requestedPageSize = Number.parseInt(first(sp.perPage) ?? "25", 10) || 25;
  const reason = STOCK_MOVEMENT_REASONS.find((r) => r === first(sp.reason));
  const variantId = first(sp.variant)?.slice(0, 40);
  const batchId = first(sp.batch)?.slice(0, 40);

  const [listing, batch] = await Promise.all([
    listStockMovementsPage(
      tenantId,
      requested,
      { reason, variantId, batchId },
      requestedPageSize,
      withCost,
    ),
    batchId ? getStockBatch(tenantId, batchId) : Promise.resolve(null),
  ]);
  const { items, total, page, pages, pageSize, counts } = listing;

  // The scope travels with every tab and every page link, or clicking a reason would silently
  // widen a one-variant history to the whole store.
  const scope: Record<string, string> = {
    ...(variantId ? { variant: variantId } : {}),
    ...(batchId ? { batch: batchId } : {}),
  };
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ ...scope, ...extra });
    const qs = params.toString();
    return qs ? `/admin/stock/history?${qs}` : "/admin/stock/history";
  };

  const countOf = (value: (typeof STOCK_MOVEMENT_REASONS)[number]) =>
    counts.find((row) => row.reason === value)?._count._all ?? 0;
  const all = STOCK_MOVEMENT_REASONS.reduce((n, r) => n + countOf(r), 0);
  // Only the reasons this store has actually recorded. A shop with no till should not be offered a
  // "Sold at the counter" tab reading (0) — nine empty pills would bury the two that matter.
  const present = STOCK_MOVEMENT_REASONS.filter((r) => countOf(r) > 0);
  const tabs: StatusFilterTab[] = [
    { key: "ALL", label: t("stock.reasonFilter.all"), count: all, href: query({}) },
    ...present.map((r) => ({
      key: r,
      label: t(`stock.reason.${r}` as const),
      count: countOf(r),
      href: query({ reason: r }),
    })),
  ];

  const scopeNotice = batchId
    ? batch
      ? `${t(`stock.batch.${batch.kind}` as const)}${batch.reference ? ` · ${batch.reference}` : ""} · ${batch.actorNameSnapshot}`
      : t("stock.scope.unknownBatch")
    : variantId
      ? items[0]
        ? `${items[0].productNameSnapshot} · ${variantLabel(parseAttributes(items[0].variantAttributesSnapshot), t("products.variants.noOptions"))}`
        : t("stock.scope.unknownVariant")
      : null;

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("stock.history.title")}
        back={{ href: "/admin/stock", label: t("nav.stock") }}
        description={t("stock.history.description")}
      />

      {scopeNotice && (
        <SectionCard
          className="border-dashed"
          title={scopeNotice}
          description={t("stock.scope.description")}
          actions={
            <Link
              href="/admin/stock/history"
              className="text-sm underline underline-offset-4"
            >
              {t("stock.scope.clear")}
            </Link>
          }
        />
      )}

      <StatusFilter
        tabs={tabs}
        current={reason ?? "ALL"}
        ariaLabel={t("stock.history.filterAriaLabel")}
      />

      {items.length === 0 ? (
        <SectionCard bodyClassName="p-0">
          <EmptyState icon={History} title={t("stock.history.empty")}>
            {t("stock.history.emptyBody")}
          </EmptyState>
        </SectionCard>
      ) : (
        <>
          <SectionCard bodyClassName="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="ps-4">{t("stock.table.when")}</TableHead>
                  <TableHead>{t("stock.table.product")}</TableHead>
                  <TableHead>{t("stock.table.reason")}</TableHead>
                  <TableHead className="text-end">{t("stock.table.delta")}</TableHead>
                  <TableHead className="text-end">{t("stock.table.left")}</TableHead>
                  {withCost && <TableHead className="text-end">{t("stock.table.unitCost")}</TableHead>}
                  <TableHead>{t("stock.table.who")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => {
                  const label = variantLabel(
                    parseAttributes(row.variantAttributesSnapshot),
                    t("products.variants.noOptions"),
                  );
                  const productId = row.variant?.productId;
                  const actorKey = stockActorKey(row.actorNameSnapshot);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="ps-4 whitespace-nowrap text-muted-foreground">
                        {row.createdAt.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {productId ? (
                          <Link
                            href={`/admin/products/${productId}/stock`}
                            className="font-medium underline underline-offset-4"
                          >
                            {row.productNameSnapshot}
                          </Link>
                        ) : (
                          <span className="font-medium">{row.productNameSnapshot}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {label}
                          {!row.variantId && (
                            <Badge variant="outline" className="ms-2">
                              {t("stock.table.removed")}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span>{t(`stock.reason.${row.reason}` as const)}</span>
                        {row.note && (
                          <span className="block text-xs text-muted-foreground">{row.note}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end tabular-nums",
                          row.delta > 0
                            ? "text-emerald-600"
                            : row.delta < 0
                              ? "text-amber-700"
                              : "text-muted-foreground",
                        )}
                      >
                        {row.delta > 0 ? `+${row.delta}` : row.delta === 0 ? "—" : row.delta}
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">
                        {row.balanceAfter}
                      </TableCell>
                      {withCost && (
                        <TableCell className="text-end tabular-nums text-muted-foreground">
                          {row.unitCostCents === null || row.unitCostCents === undefined
                            ? "—"
                            : formatPrice(row.unitCostCents)}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground">
                        {/* A system actor's stored label is translated; a person's name never is. */}
                        {actorKey ? t(actorKey) : row.actorNameSnapshot}
                        {row.batchId && (
                          <Link
                            href={`/admin/stock/history?batch=${row.batchId}`}
                            className="ms-2 text-xs underline underline-offset-4"
                          >
                            {t("stock.table.document")}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SectionCard>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <AdminPageSizeControl
              page={page}
              pageSize={pageSize}
              total={total}
              noun={t("stock.history.noun")}
            />
            <AdminPagination
              basePath="/admin/stock/history"
              page={page}
              pages={pages}
              total={total}
              noun={t("stock.history.noun")}
              params={{ ...scope, ...(reason ? { reason } : {}) }}
            />
          </div>
        </>
      )}
    </div>
  );
}
