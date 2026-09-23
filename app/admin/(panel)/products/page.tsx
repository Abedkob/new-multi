import Link from "next/link";
import { Package, Plus, Search } from "lucide-react";
import { AdminPagination } from "@/components/admin-pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { StockBadge } from "@/components/admin/stock-badge";
import { Thumb } from "@/components/admin/thumb";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProductsPage } from "@/lib/data/products";
import { formatPrice } from "@/lib/format";
import { requireOwner } from "@/lib/session";
import { effectivePrice } from "@/lib/variants";
import { deleteProductAction } from "./actions";
import { DeleteButton } from "./delete-button";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const { tenantId } = await requireOwner();
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const requested = Number.parseInt(first(sp.page) ?? "1", 10) || 1;
  const { items: products, total, page, pages } = await listProductsPage(tenantId, requested, q);

  const addButton = (
    <Link href="/admin/products/new" className={buttonVariants()}>
      <Plus className="size-4" aria-hidden /> New product
    </Link>
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Products"
        description="Everything you sell. Click a product to change its photos, price or stock."
        actions={addButton}
      />

      {(total > 0 || q) && (
        <form method="get" className="relative max-w-sm" role="search">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search products by name"
            aria-label="Search products"
            className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </form>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        {products.length === 0 ? (
          q ? (
            <EmptyState icon={Search} title={`No products match "${q}"`}>
              <Link href="/admin/products" className="underline underline-offset-4">
                Show all products
              </Link>
            </EmptyState>
          ) : (
            <EmptyState icon={Package} title="No products yet." action={addButton}>
              Add your first product: a name, a price and a photo is all you need. You can add
              sizes or colours later.
            </EmptyState>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="pl-4">Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const prices = p.variants.map((v) => effectivePrice(p.basePriceCents, v.priceCentsOverride));
                const min = Math.min(...(prices.length ? prices : [p.basePriceCents]));
                const max = Math.max(...(prices.length ? prices : [p.basePriceCents]));
                const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
                const soldOut = p.variants.filter((v) => v.stock <= 0).length;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4">
                      <Link href={`/admin/products/${p.id}/edit`} className="flex items-center gap-3">
                        <Thumb src={p.imageUrl} />
                        <span className="min-w-0">
                          <span className="block font-medium hover:underline">
                            {p.name}
                            {p.isBestSeller && (
                              <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 ring-inset dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900">
                                Best seller
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {p.variants.length > 1 ? `${p.variants.length} options` : "No options"}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.category?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPrice(min)}
                      {max !== min && <span className="text-muted-foreground"> - {formatPrice(max)}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="grid justify-items-start gap-1">
                        <StockBadge stock={totalStock} />
                        {totalStock > 0 && soldOut > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {soldOut} {soldOut === 1 ? "option" : "options"} sold out
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/admin/products/${p.id}/edit`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          Edit
                        </Link>
                        <form action={deleteProductAction.bind(null, p.id)}>
                          <DeleteButton name={p.name} />
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <AdminPagination
        basePath="/admin/products"
        page={page}
        pages={pages}
        total={total}
        noun="products"
        params={q ? { q } : {}}
      />
    </div>
  );
}
