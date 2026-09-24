import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { AdminPagination } from "@/components/admin-pagination";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
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
  const section = first(query.section) === "products" ? "products" : "details";
  const q = (first(query.q) ?? "").trim().slice(0, 100);
  const requested = Number.parseInt(first(query.page) ?? "1", 10) || 1;
  const discount = await getDiscount(tenantId, id);
  if (!discount) notFound();

  const products = section === "products"
    ? await listDiscountProductsPage(tenantId, id, requested, q)
    : null;
  if (section === "products" && !products) notFound();

  const now = new Date();
  const pickerItems: DiscountProductPickerItem[] = products?.items.map((product) => {
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
  }) ?? [];

  const detailsHref = `/admin/discounts/${discount.id}/edit`;
  const productsHref = `${detailsHref}?section=products`;

  return (
    <div className="grid gap-5">
      <PageHeader
        title={(
          <span className="flex flex-wrap items-center gap-2">
            {discount.name}
            <DiscountStatusBadge discount={discount} at={now} />
          </span>
        )}
        back={{ href: "/admin/discounts", label: "Discounts" }}
        description="Manage how this discount works and which products receive it."
      >
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span><DiscountValueLabel type={discount.type} value={discount.value} /></span>
          <span><DiscountScheduleLabel startsAt={discount.startsAt} endsAt={discount.endsAt} /></span>
          <span>{discount._count.products} {discount._count.products === 1 ? "product" : "products"}</span>
        </div>
      </PageHeader>

      <nav aria-label="Discount editor sections" className="flex w-fit rounded-lg border bg-muted/30 p-1">
        <Link
          href={detailsHref}
          aria-current={section === "details" ? "page" : undefined}
          className={buttonVariants({ variant: section === "details" ? "secondary" : "ghost", size: "sm" })}
        >
          Details
        </Link>
        <Link
          href={productsHref}
          aria-current={section === "products" ? "page" : undefined}
          className={buttonVariants({ variant: section === "products" ? "secondary" : "ghost", size: "sm" })}
        >
          Products ({discount._count.products})
        </Link>
      </nav>

      {section === "details" ? (
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
      ) : products ? (
        <section aria-labelledby="discount-products" className="grid gap-4">
          <div>
            <h2 id="discount-products" className="text-xl font-semibold tracking-tight">Choose products</h2>
            <p className="mt-1 text-sm text-muted-foreground">Selections on other pages stay unchanged until you visit and save those pages.</p>
          </div>
          <form method="get" className="relative max-w-sm" role="search">
            <input type="hidden" name="section" value="products" />
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input name="q" type="search" defaultValue={q} placeholder="Search products" aria-label="Search products" className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
          </form>

          {first(query.assignmentError) === "1" && <p role="alert" className="text-sm text-destructive">The product selection could not be saved. Refresh and try again.</p>}

          {products.items.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-xl border px-6 py-12 text-center">
              <p className="font-medium">No products match this search.</p>
              <Link href={productsHref} className="text-sm underline underline-offset-4">Show all products</Link>
            </div>
          ) : (
            <DiscountProductPicker
              key={`${products.page}:${q}:${pickerItems.filter((item) => item.assigned).map((item) => item.id).join(",")}`}
              items={pickerItems}
              action={updateDiscountProductsAction.bind(null, discount.id, q, products.page)}
            />
          )}
          <AdminPagination
            basePath={detailsHref}
            page={products.page}
            pages={products.pages}
            total={products.total}
            noun="products"
            params={{ section: "products", ...(q ? { q } : {}) }}
          />
        </section>
      ) : null}
    </div>
  );
}
