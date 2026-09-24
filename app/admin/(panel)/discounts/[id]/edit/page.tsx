import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { AdminPagination } from "@/components/admin-pagination";
import { PageHeader } from "@/components/admin/page-header";
import { Thumb } from "@/components/admin/thumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDiscount, listDiscountProductsPage } from "@/lib/data/discounts";
import { formatPrice } from "@/lib/format";
import { applyDiscount, discountSchedulesOverlap } from "@/lib/pricing";
import { requireOwner } from "@/lib/session";
import { updateDiscountAction, updateDiscountProductsAction } from "../../actions";
import { DiscountForm } from "../../discount-form";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function EditDiscountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOwner();
  const { id } = await params;
  const query = await searchParams;
  const q = (first(query.q) ?? "").trim().slice(0, 100);
  const requested = Number.parseInt(first(query.page) ?? "1", 10) || 1;
  const [discount, products] = await Promise.all([
    getDiscount(tenantId, id),
    listDiscountProductsPage(tenantId, id, requested, q),
  ]);
  if (!discount || !products) notFound();

  return (
    <div className="grid gap-8">
      <div>
        <PageHeader
          title="Edit discount"
          back={{ href: "/admin/discounts", label: "Discounts" }}
          description="Changes affect storefront prices as soon as you save. Existing orders keep their original totals."
        />
        <DiscountForm
          action={updateDiscountAction.bind(null, discount.id)}
          submitLabel="Save changes"
          defaults={{
            name: discount.name,
            type: discount.type,
            value: discount.type === "PERCENTAGE" ? String(discount.value) : (discount.value / 100).toFixed(2),
            isEnabled: discount.isEnabled,
            startsAt: discount.startsAt?.toISOString() ?? "",
            endsAt: discount.endsAt?.toISOString() ?? "",
          }}
        />
      </div>

      <section aria-labelledby="discount-products" className="grid gap-4">
        <div>
          <h2 id="discount-products" className="text-xl font-semibold tracking-tight">Products</h2>
          <p className="mt-1 text-sm text-muted-foreground">Select products on this page, then save the selection. Choices on other pages stay unchanged.</p>
        </div>
        <form method="get" className="relative max-w-sm" role="search">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" type="search" defaultValue={q} placeholder="Search products" aria-label="Search products" className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </form>

        {first(query.assignmentError) === "1" && <p role="alert" className="text-sm text-destructive">The product selection could not be saved. Refresh and try again.</p>}

        <form action={updateDiscountProductsAction.bind(null, discount.id, q, products.page)} className="grid gap-4">
          <Card className="gap-0 overflow-hidden py-0">
            {products.items.length === 0 ? (
              <div className="grid justify-items-center gap-2 px-6 py-12 text-center">
                <p className="font-medium">No products match this search.</p>
                <Link href={`/admin/discounts/${discount.id}/edit`} className="text-sm underline underline-offset-4">Show all products</Link>
              </div>
            ) : (
              <div className="divide-y">
                {products.items.map((product) => {
                  const assigned = product.discounts.some((item) => item.discountId === discount.id);
                  const regularPrices = product.variants.length
                    ? product.variants.map((variant) => variant.priceCentsOverride ?? product.basePriceCents)
                    : [product.basePriceCents];
                  const regular = Math.min(...regularPrices);
                  const discounted = applyDiscount(regular, discount);
                  const overlapping = product.discounts.filter((item) =>
                    item.discountId !== discount.id &&
                    item.discount.isEnabled &&
                    item.discount.archivedAt === null &&
                    discountSchedulesOverlap(discount, item.discount),
                  );
                  return (
                    <label key={product.id} className="grid cursor-pointer grid-cols-[auto_2.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 hover:bg-muted/40 sm:grid-cols-[auto_2.5rem_minmax(0,1fr)_auto]">
                      <input type="hidden" name="visibleProductIds" value={product.id} />
                      <input type="checkbox" name="selectedProductIds" value={product.id} defaultChecked={assigned} className="size-4 accent-primary" />
                      <Thumb src={product.imageUrl} className="size-10" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{product.name}</span>
                        {overlapping.length > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">Also overlaps {overlapping.map((item) => item.discount.name).join(", ")}; shoppers receive the lowest price.</span>}
                      </span>
                      <span className="col-start-3 flex items-baseline gap-2 text-sm tabular-nums sm:col-start-auto">
                        <span className="text-muted-foreground line-through">{formatPrice(regular)}</span>
                        <span className="font-semibold">{formatPrice(discounted)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Card>
          {products.items.length > 0 && <div><Button type="submit">Save product selection</Button></div>}
        </form>
        <AdminPagination basePath={`/admin/discounts/${discount.id}/edit`} page={products.page} pages={products.pages} total={products.total} noun="products" params={q ? { q } : {}} />
      </section>
    </div>
  );
}
