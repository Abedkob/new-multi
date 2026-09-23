"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useTrack } from "@/lib/analytics";
import { useCart } from "@/lib/cart/cart";
import type { ContentMap } from "@/lib/content";
import { formatPrice } from "@/lib/format";
import { attributeOptions } from "@/lib/variants";
import { cn } from "@/lib/utils";
import { Picture } from "./shared";
import type { StoreProduct, StoreVariant } from "./types";

/**
 * The interactive bits of a product page. Templates stay server components and drop these
 * small client leaves into their own layout; they all share the selected variant through
 * ProductProvider, so choosing "size 40 / white" updates image, price and stock together.
 *
 * Stock is per variant: "Out of stock" describes the selected variant, never the product.
 */

type Selection = Record<string, string>;

type ProductState = {
  product: StoreProduct;
  content: ContentMap;
  options: { key: string; values: string[] }[];
  selection: Selection;
  select: (key: string, value: string) => void;
  /** The variant matching the current selection, when all options are chosen and it exists. */
  variant: StoreVariant | null;
  /** True once every option is chosen (or there is nothing to choose). */
  complete: boolean;
  /** A gallery thumbnail the shopper picked, overriding the variant/product image until they
   *  change the variant. */
  activeImage: string | null;
  setActiveImage: (url: string) => void;
};

const Ctx = createContext<ProductState | null>(null);

export function useProduct() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Product components must be rendered inside <ProductProvider>");
  return ctx;
}

export function ProductProvider({
  product,
  content,
  children,
}: {
  product: StoreProduct;
  content: ContentMap;
  children: React.ReactNode;
}) {
  const options = useMemo(() => attributeOptions(product.variants), [product.variants]);
  // A product with one variant has nothing to choose: it is selected from the start.
  const [selection, setSelection] = useState<Selection>(() =>
    product.variants.length === 1 ? { ...product.variants[0].attributes } : {},
  );
  const [activeImage, setActiveImage] = useState<string | null>(null);

  const complete = options.every((o) => selection[o.key] !== undefined);
  const variant =
    complete && product.variants.length > 0
      ? (product.variants.find((v) => options.every((o) => v.attributes[o.key] === selection[o.key])) ??
        null)
      : null;

  const value: ProductState = {
    product,
    content,
    options,
    selection,
    // Switching variants drops any gallery pick so the hero goes back to reflecting the
    // selected variant's own photo.
    select: (key, val) => {
      setActiveImage(null);
      setSelection((s) => ({ ...s, [key]: val }));
    },
    variant,
    complete,
    activeImage,
    setActiveImage,
  };

  // One view_item / ViewContent per product shown (keyed on the id, so moving to another product
  // page counts again). A no-op in the admin previews, which have no analytics provider.
  const track = useTrack();
  const { id, name, priceCents } = product;
  useEffect(() => {
    track.viewItem({ id, name, priceCents, quantity: 1 });
  }, [track, id, name, priceCents]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ProductImage({
  className,
  imgClassName,
}: {
  className?: string;
  imgClassName?: string;
}) {
  const { product, variant, activeImage } = useProduct();
  const [zoom, setZoom] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setPos({ x, y });
  };

  const src = activeImage || variant?.imageUrl || product.imageUrl;

  return (
    <div 
      className={cn("relative overflow-hidden group cursor-crosshair", className)}
      onMouseEnter={() => setZoom(true)}
      onMouseLeave={() => setZoom(false)}
      onMouseMove={handleMouseMove}
    >
      <Picture
        src={src}
        alt={product.name}
        className={cn("w-full h-full", zoom ? "opacity-0" : "opacity-100 transition-opacity")}
        imgClassName={imgClassName}
      />
      {zoom && src && (
        <div 
          className="absolute inset-0 bg-no-repeat pointer-events-none"
          style={{
            backgroundImage: `url(${src})`,
            backgroundPosition: `${pos.x}% ${pos.y}%`,
            backgroundSize: '200%', // Adjust zoom level
          }}
        />
      )}
    </div>
  );
}

/**
 * Thumbnail strip for the product's extra gallery photos, plus the base product photo. Renders
 * nothing when there's nothing to switch between. Picking a thumbnail overrides the hero image
 * in <ProductImage> until the shopper changes variant.
 */
export function ProductGallery({ className }: { className?: string }) {
  const { product, variant, activeImage, setActiveImage } = useProduct();
  const seen = new Set<string>();
  const gallery = [product.imageUrl, ...product.images.map((i) => i.url)].filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  if (gallery.length < 2) return null;
  const current = activeImage || variant?.imageUrl || product.imageUrl;

  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-testid="product-gallery">
      {gallery.map((url) => (
        <button
          key={url}
          type="button"
          aria-label={`Show this photo of ${product.name}`}
          aria-pressed={url === current}
          onClick={() => setActiveImage(url)}
          className={cn(
            "size-16 shrink-0 overflow-hidden rounded-md border-2 transition",
            url === current ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
          )}
        >
          <Picture src={url} alt={product.name} className="size-full" />
        </button>
      ))}
    </div>
  );
}

/** The selected variant's price, else "From ..." (when prices differ) or the single price. */
export function ProductPrice({ className }: { className?: string }) {
  const { product, variant, content } = useProduct();
  const text = variant
    ? formatPrice(variant.priceCents)
    : `${product.hasPriceRange ? `${content["product.fromLabel"]} ` : ""}${formatPrice(product.priceCents)}`;
  return (
    <span data-testid="product-price" className={className}>
      {text}
    </span>
  );
}

/** Stock label for the selected variant (or a prompt to choose one). */
export function useStockStatus() {
  const { variant, complete, content } = useProduct();
  if (!complete) return { inStock: null, label: content["product.selectOptions"] };
  if (!variant) return { inStock: false, label: content["product.unavailable"] };
  return variant.stock > 0
    ? { inStock: true, label: content["product.inStock"] }
    : { inStock: false, label: content["product.outOfStock"] };
}

export function StockStatus({
  look,
  className,
}: {
  /** Server components can't pass functions to client ones, so templates pick a built-in look. */
  look: "dot" | "classicBadge";
  className?: string;
}) {
  const { inStock, label } = useStockStatus();
  return (
    <span data-testid="stock-status" className={className}>
      {look === "dot" && (
        <span className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", inStock ? "bg-primary" : "bg-muted-foreground/40")}
          />
          {label}
        </span>
      )}
      {look === "classicBadge" && (
        <Badge variant={inStock ? "secondary" : "outline"}>{label}</Badge>
      )}
    </span>
  );
}

const STYLES = {
  minimal: {
    group: "gap-2",
    option: "rounded-full px-4 py-1.5 text-xs tracking-wide",
  },
  classic: {
    group: "gap-2",
    option: "rounded-md px-3 py-1.5 text-sm",
  },
  atelier: {
    group: "gap-2",
    option: "min-w-12 px-4 py-2.5 text-xs uppercase tracking-[0.15em]",
  },
} as const;

/**
 * One row of buttons per attribute name (size, color, ...), built from the union of names and
 * values across the product's variants. Values that lead to no variant, or a sold-out one,
 * are struck through but stay selectable so the shopper sees exactly why.
 */
export function VariantPicker({
  look,
  labelClassName,
}: {
  look: keyof typeof STYLES;
  labelClassName?: string;
}) {
  const { product, options, selection, select } = useProduct();
  // If there are no variants at all, or if the only variant has no attributes (like the default "Default" variant)
  if (product.variants.length === 0 || options.length === 0) return null;

  if (product.variants.length === 1) {
    const variant = product.variants[0];
    return (
      <div className="mt-2" data-testid="variant-specs">
        <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
          {Object.entries(variant.attributes).map(([key, val]) => (
            <li key={key}>
              <strong className="font-medium text-foreground capitalize">{key}:</strong> {val}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const styles = STYLES[look];

  const isAvailable = (key: string, value: string) =>
    product.variants.some(
      (v) =>
        v.stock > 0 &&
        v.attributes[key] === value &&
        options.every((o) => o.key === key || selection[o.key] === undefined || v.attributes[o.key] === selection[o.key]),
    );

  return (
    <div className="flex flex-col gap-3" data-testid="variant-picker">
      {options.map((o) => (
        <fieldset key={o.key} className="flex flex-col gap-1.5">
          <legend className={cn("text-sm font-medium capitalize", labelClassName)}>
            {o.key}
            {selection[o.key] && (
              <span className="ml-2 font-normal text-muted-foreground">{selection[o.key]}</span>
            )}
          </legend>
          <div className={cn("flex flex-wrap", styles.group)}>
            {o.values.map((val) => {
              const chosen = selection[o.key] === val;
              const available = isAvailable(o.key, val);
              return (
                <button
                  key={val}
                  type="button"
                  aria-pressed={chosen}
                  data-option={`${o.key}:${val}`}
                  data-available={available}
                  onClick={() => select(o.key, val)}
                  className={cn(
                    "border transition",
                    styles.option,
                    chosen
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:border-foreground",
                    !available && !chosen && "line-through opacity-50",
                  )}
                >
                  {val}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const ADD_STYLES = {
  minimal: "h-11 w-full rounded-full text-sm tracking-wide",
  classic: "h-11 w-full rounded-md text-base font-semibold",
  tonkic: "h-14 w-full rounded-full text-base font-semibold",
  solid: "h-12 w-full rounded-xl text-sm font-medium",
  atelier: "h-14 w-full rounded-none text-[11px] font-medium uppercase tracking-[0.25em]",
  default: "",
} as const;

// The quantity stepper matches each look's button height and corner shape.
const QTY_STYLES = {
  minimal: "h-11 rounded-full",
  classic: "h-11 rounded-md",
  tonkic: "h-14 rounded-full",
  solid: "h-12 rounded-xl",
  atelier: "h-14 rounded-none",
  default: "h-10 rounded-md",
} as const;

/**
 * Adds the selected variant to the (in-memory) cart, with a quantity stepper beside it. A
 * product with several variants needs a choice first, and the quantity can never exceed what's
 * left of that variant's stock after what's already in the cart.
 */
export function AddToCart({ look, basePath, className }: { look: keyof typeof ADD_STYLES; basePath: string; className?: string }) {
  const { product, variant, complete, content } = useProduct();
  const cart = useCart();
  const track = useTrack();
  // Remember which variant the message is about, so choosing another option clears it.
  const [noted, setNoted] = useState<{ variantId: string; kind: "added" | "max" } | null>(null);
  const note = variant && noted?.variantId === variant.id ? noted.kind : null;
  // The chosen quantity belongs to one variant too: switching options starts again at 1.
  const [qty, setQty] = useState<{ variantId: string | null; n: number }>({ variantId: null, n: 1 });

  // How many more of this variant can go in the cart (at least 1 while it's in stock, so the
  // stepper stays usable and the add itself reports "all stock is in your cart").
  const room = variant ? Math.max(1, variant.stock - cart.quantityOf(variant.id)) : 1;
  const n = Math.min(qty.variantId === variant?.id ? qty.n : 1, room);
  const setN = (next: number) =>
    setQty({ variantId: variant?.id ?? null, n: Math.min(room, Math.max(1, Math.floor(next) || 1)) });

  const label = !complete
    ? content["product.selectOptions"]
    : !variant
      ? content["product.unavailable"]
      : variant.stock === 0
        ? content["product.outOfStock"]
        : content["product.addToCart"];
  const disabled = !variant || variant.stock === 0;

  return (
    <div className="grid min-w-0 gap-2" data-testid="add-to-cart">
      <div className="flex items-stretch gap-3">
        <div
          role="group"
          aria-label={content["product.quantity"]}
          data-testid="quantity"
          className={cn(
            "flex shrink-0 items-center border border-border bg-background text-foreground",
            QTY_STYLES[look],
            disabled && "opacity-50",
          )}
        >
          <button
            type="button"
            aria-label={`${content["product.quantity"]} −1`}
            disabled={disabled || n <= 1}
            onClick={() => setN(n - 1)}
            data-testid="quantity-decrease"
            className="grid h-full w-10 place-items-center text-lg disabled:opacity-40"
          >
            &minus;
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={content["product.quantity"]}
            value={n}
            disabled={disabled}
            onChange={(e) => setN(Number(e.target.value.replace(/\D/g, "")))}
            data-testid="quantity-input"
            className="h-full w-10 bg-transparent text-center text-sm tabular-nums outline-none"
          />
          <button
            type="button"
            aria-label={`${content["product.quantity"]} +1`}
            disabled={disabled || n >= room}
            onClick={() => setN(n + 1)}
            data-testid="quantity-increase"
            className="grid h-full w-10 place-items-center text-lg disabled:opacity-40"
          >
            +
          </button>
        </div>
        <button
          type="button"
          disabled={disabled}
          data-testid="add-to-cart-button"
          onClick={() => {
            if (!variant) return;
            const added = cart.add(variant.id, n, variant.stock);
            setNoted({ variantId: variant.id, kind: added > 0 ? "added" : "max" });
            setQty({ variantId: variant.id, n: 1 });
            if (added > 0) {
              track.addToCart({
                id: variant.id,
                name: product.name,
                ...(product.variants.length > 1 ? { variant: variant.label } : {}),
                priceCents: variant.priceCents,
                quantity: added,
              });
            }
          }}
          className={cn(buttonVariants({ size: "lg" }), ADD_STYLES[look], "min-w-0 flex-1", className)}
        >
          {label}
        </button>
      </div>
      {note && (
        <p role="status" className="text-sm text-muted-foreground" data-testid="add-to-cart-note">
          {note === "added" ? content["product.added"] : content["product.maxInCart"]}{" "}
          <Link href={`${basePath}/cart`} className="font-medium text-foreground underline underline-offset-4">
            {content["product.viewCart"]}
          </Link>
        </p>
      )}
    </div>
  );
}
