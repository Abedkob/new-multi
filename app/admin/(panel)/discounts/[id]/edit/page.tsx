import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { AdminPagination } from "@/components/admin-pagination";
import { PageHeader } from "@/components/admin/page-header";
import { getDiscount, listDiscountProductsPage } from "@/lib/data/discounts";
import { applyDiscount, discountSchedulesOverlap } from "@/lib/pricing";
import { requireOwner } from "@/lib/session";
import { updateDiscountAction, updateDiscountProductsAction } from "../../actions";
import { DiscountForm } from "../../discount-form";
import { DiscountProductPicker, type DiscountProductPickerItem } from "../../discount-product-picker";
import { DiscountScheduleLabel, DiscountStatusBadge, DiscountValueLabel } from "../../discount-summary";

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
  const now = new Date();
  const pickerItems: DiscountProductPickerItem[] = products.items.map((product) => {
    const assigned = product.discounts.some((item) => item.discountId === discount.id);
    const regularPrices = product.variants.length
      ? product.variants.map((variant) => variant.priceCentsOverride ?? product.basePriceCents)
      : [product.basePriceCents];
    const regularPriceCents = Math.min(...regularPrices);
    const overlappingNames = product.discounts
      .filter((item) =>
        item.discountId !== discount.id &&
        item.discount.isEnabled &&
        item.discount.archivedAt === null &&
        discountSchedulesOverlap(discount, item.discount),
      )
      .map((item) => item.discount.name);
    return {
      id: product.id,
      name: product.name,
      imageUrl: product.imageUrl,
      regularPriceCents,
      discountedPriceCents: applyDiscount(regularPriceCents, discount),
      assigned,
      overlappingNames,
    };
  });

  return (
    <div className="grid gap-8">
      <div>
        <PageHeader
          title={(
            <span className="flex flex-wrap items-center gap-2">
              {discount.name}
              <DiscountStatusBadge discount={discount} at={now} />
            </span>
          )}
          back={{ href: "/admin/discounts", label: "Discounts" }}
          description="Changes affect storefront prices as soon as you save. Existing orders keep their original totals."
        >
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span><DiscountValueLabel type={discount.type} value={discount.value} /></span>
            <span><DiscountScheduleLabel startsAt={discount.startsAt} endsAt={discount.endsAt} /></span>
            <span>{discount._count.products} {discount._count.products === 1 ? "product" : "products"}</span>
          </div>
        </PageHeader>
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

        {products.items.length === 0 ? (
          <div className="grid justify-items-center gap-2 rounded-xl border px-6 py-12 text-center">
            <p className="font-medium">No products match this search.</p>
            <Link href={`/admin/discounts/${discount.id}/edit`} className="text-sm underline underline-offset-4">Show all products</Link>
          </div>
        ) : (
          <DiscountProductPicker
            key={`${products.page}:${q}:${pickerItems.filter((item) => item.assigned).map((item) => item.id).join(",")}`}
            items={pickerItems}
            action={updateDiscountProductsAction.bind(null, discount.id, q, products.page)}
          />
        )}
        <AdminPagination basePath={`/admin/discounts/${discount.id}/edit`} page={products.page} pages={products.pages} total={products.total} noun="products" params={q ? { q } : {}} />
      </section>
    </div>
  );
}
