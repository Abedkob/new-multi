"use client";

import Link from "next/link";
import type { ContentMap } from "@/lib/content";
import { fillVars } from "@/lib/content";
import { useCart } from "@/lib/cart/cart";
import { useCartDetails } from "@/lib/cart/use-cart-details";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Picture } from "./shared";
import type { Template } from "./types";

/** Cart review page: line items, quantity controls (capped at stock), remove, subtotal. */
export function CartView({
  slug,
  basePath,
  content,
  deliveryFeeCents,
  deliveryNote,
  style,
}: {
  /** Used only for the cart-details server action, which is always addressed by the real
   * tenant slug regardless of custom-domain routing. */
  slug: string;
  /** "" once the store has its own domain, else "/store/[slug]" — see templates/types.ts. */
  basePath: string;
  content: ContentMap;
  deliveryFeeCents: number;
  deliveryNote: string;
  style: Template["pageStyle"];
}) {
  const cart = useCart();
  const { items, subtotal, loading, removedNotice, hasLines } = useCartDetails(slug);
  const base = basePath;

  return (
    <div className={style.container} data-testid="cart-page">
      <h1 className={style.title}>{content["cart.heading"]}</h1>

      {removedNotice && (
        <p role="status" className="mt-4 text-sm text-destructive" data-testid="cart-removed-notice">
          {content["cart.removedNotice"]}
        </p>
      )}

      {!hasLines ? (
        <div className="mt-8 grid justify-items-start gap-4">
          <p className="text-muted-foreground" data-testid="cart-empty">
            {content["cart.empty"]}
          </p>
          <Link href={`${base}/shop`} className={buttonVariants({ variant: "outline" })}>
            {content["cart.continue"]}
          </Link>
        </div>
      ) : items.length === 0 && loading ? (
        <p className="mt-8 text-muted-foreground">&hellip;</p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <ul className="divide-y divide-border border-y border-border" data-testid="cart-lines">
            {items.map((item) => {
              const atMax = item.quantity >= item.stock;
              return (
                <li
                  key={item.variantId}
                  data-testid="cart-line"
                  data-variant-id={item.variantId}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 py-5 sm:grid-cols-[5rem_minmax(0,1fr)_auto]"
                >
                  <Link href={`${base}/products/${item.productSlug}`} className="row-span-2">
                    <Picture src={item.imageUrl} alt={item.productName} className="size-[4.5rem] rounded-md sm:size-20" imgClassName="object-contain" />
                  </Link>
                  <div className="min-w-0">
                    <Link
                      href={`${base}/products/${item.productSlug}`}
                      className="font-medium hover:underline"
                    >
                      {item.productName}
                    </Link>
                    {item.label && <p className="text-sm text-muted-foreground">{item.label}</p>}
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {item.discountCents > 0 && (
                        <span className="text-muted-foreground line-through">
                          {formatPrice(item.regularPriceCents)}
                        </span>
                      )}
                      <span className={item.discountCents > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
                        {formatPrice(item.priceCents)}
                      </span>
                      {item.discountCents > 0 && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                          {content["product.saleBadge"]}
                        </span>
                      )}
                    </p>
                    {atMax && (
                      <p className="mt-1 text-xs text-destructive" data-testid="cart-low-stock">
                        {fillVars(content["cart.lowStock"], { stock: item.stock })}
                      </p>
                    )}
                  </div>

                  <p className="text-right font-medium tabular-nums" data-testid="line-total">
                    {formatPrice(item.priceCents * item.quantity)}
                  </p>

                  <div className="col-span-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => cart.setQuantity(item.variantId, item.quantity - 1, item.stock)}
                      className="size-9 rounded-md border border-border text-lg leading-none hover:bg-muted"
                    >
                      &minus;
                    </button>
                    <span data-testid="line-qty" className="w-8 text-center tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      disabled={atMax}
                      onClick={() => cart.setQuantity(item.variantId, item.quantity + 1, item.stock)}
                      className={cn(
                        "size-9 rounded-md border border-border text-lg leading-none hover:bg-muted",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                      )}
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => cart.remove(item.variantId)}
                    className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {content["cart.remove"]}
                  </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <aside className={cn(style.panel, "h-fit")}>
            <div className="flex items-baseline justify-between text-lg">
              <span>{content["cart.subtotal"]}</span>
              <span className="font-semibold tabular-nums" data-testid="cart-subtotal">
                {formatPrice(subtotal)}
              </span>
            </div>
            <div className="mt-2 flex justify-between gap-3 text-sm text-muted-foreground">
              <span>Delivery</span>
              <span className="tabular-nums" data-testid="cart-delivery-fee">
                {deliveryFeeCents === 0 ? "Free" : formatPrice(deliveryFeeCents)}
              </span>
            </div>
            {deliveryNote && <p className="mt-2 text-sm text-muted-foreground">{deliveryNote}</p>}
            <p className="mt-2 text-sm text-muted-foreground">{content["checkout.cod"]}</p>
            <div className="mt-6 grid gap-3">
              <Link
                href={`${base}/checkout`}
                data-testid="go-to-checkout"
                className={cn(buttonVariants({ size: "lg" }), "w-full")}
              >
                {content["cart.checkout"]}
              </Link>
              <Link href={`${base}/shop`} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                {content["cart.continue"]}
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
