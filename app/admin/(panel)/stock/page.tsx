import Link from "next/link";
import { Boxes, ClipboardList, History, PackagePlus, Search } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { StatTile } from "@/components/admin/stat-tile";
import { StockBadge } from "@/components/admin/stock-badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { getStockAttention, searchStockVariants } from "@/lib/data/stock-ledger";
import { getTenantById } from "@/lib/data/tenants";
import { canMoveStock } from "@/lib/stock";
import { getT } from "@/lib/i18n/locale";
import { can, requireCapability } from "@/lib/permissions";
import { parseAttributes, variantLabel } from "@/lib/variants";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The stockroom's front page: what needs looking at, and a way to find anything else.
 *
 * Two lists rather than one filtered list, because they answer different questions. "What is
 * running out" is a standing list the shop works through; "how many of the blue one are left" is a
 * lookup. Filtering the attention list by a search box would make the second question impossible to
 * ask about anything that is not already low.
 *
 * The search is a plain `method="get"` form, like Products' — so a search is a URL, survives a
 * reload and can be sent to a colleague. The debounced server-action pickers belong to the screens
 * that hold an unsaved document, where a round trip would lose it.
 */
export default async function StockPage({ searchParams }: PageProps<"/admin/stock">) {
  const { tenantId, role } = await requireCapability("stock:read");
  const t = await getT();
  // Drawn from the same table the pages enforce, so a link can never offer something the page
  // behind it would refuse.
  const mayStock = can(role, "products:stock");
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 100);

  const [{ rows: attention, counts }, found, tenant, license] = await Promise.all([
    getStockAttention(tenantId),
    q ? searchStockVariants(tenantId, q) : Promise.resolve([]),
    getTenantById(tenantId),
    getLicenseAccessSnapshot(tenantId),
  ]);

  // Receiving and counting are offered only while the module can actually record a movement. The
  // layout above admits anyone whose store has EVER had it, so a store switched off keeps its
  // history and loses the two buttons — drawn from the same predicate the forms enforce, so a
  // button can never offer something the page behind it would refuse.
  const mayMove = can(role, "stock:move") && !!tenant && canMoveStock({ ...tenant, license });
  const rows = q ? found : attention;

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("stock.page.title")}
        description={t("stock.page.description")}
        actions={
          <>
            {mayMove && (
              <>
                <Link href="/admin/stock/receive" className={buttonVariants()}>
                  <PackagePlus className="size-4" aria-hidden /> {t("stock.page.receive")}
                </Link>
                <Link
                  href="/admin/stock/count"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <ClipboardList className="size-4" aria-hidden /> {t("stock.page.count")}
                </Link>
              </>
            )}
            <Link
              href="/admin/stock/history"
              className={buttonVariants({ variant: "outline" })}
            >
              <History className="size-4" aria-hidden /> {t("stock.page.history")}
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t("stock.tile.empty")} value={String(counts.empty)} />
        <StatTile label={t("stock.tile.low")} value={String(counts.low)} />
        <StatTile label={t("stock.tile.variants")} value={String(counts.variants)} />
      </div>

      <form method="get" className="relative max-w-sm" role="search">
        <Search
          className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t("stock.page.searchPlaceholder")}
          aria-label={t("stock.page.searchAriaLabel")}
          className="ps-9"
        />
      </form>

      <SectionCard
        title={q ? t("stock.found.title") : t("stock.attention.title")}
        description={q ? undefined : t("stock.attention.description")}
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          q ? (
            <EmptyState icon={Search} title={`${t("stock.found.none")} "${q}"`}>
              <Link href="/admin/stock" className="underline underline-offset-4">
                {t("stock.found.clear")}
              </Link>
            </EmptyState>
          ) : (
            <EmptyState icon={Boxes} title={t("stock.attention.empty")}>
              {t("stock.attention.emptyBody")}
            </EmptyState>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="ps-4">{t("stock.table.product")}</TableHead>
                <TableHead>{t("stock.table.onHand")}</TableHead>
                <TableHead>{t("stock.table.threshold")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const label = variantLabel(
                  parseAttributes(row.attributes),
                  t("products.variants.noOptions"),
                );
                return (
                  <TableRow key={row.variantId}>
                    <TableCell className="ps-4">
                      <span className="font-medium">{row.productName}</span>
                      <span className="block text-xs text-muted-foreground">{label}</span>
                    </TableCell>
                    <TableCell>
                      <StockBadge stock={row.stock} lowAt={row.lowAt} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{row.lowAt}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex flex-wrap justify-end gap-3">
                        <Link
                          href={`/admin/stock/history?variant=${row.variantId}`}
                          className="text-sm underline underline-offset-4"
                        >
                          {t("stock.table.history")}
                        </Link>
                        {mayStock && (
                          <Link
                            href={`/admin/products/${row.productId}/stock`}
                            className="text-sm underline underline-offset-4"
                          >
                            {t("stock.table.change")}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {!q && counts.empty + counts.low > attention.length && (
        <p className="text-sm text-muted-foreground">
          {t("stock.attention.truncated")}
        </p>
      )}
    </div>
  );
}
