"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
  look: "dot" | "boldBadge" | "classicBadge";
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
      {look === "boldBadge" && (
        <Badge
          variant={inStock ? "default" : "outline"}
          className="h-8 rounded-none px-3 text-sm font-bold uppercase tracking-wider"
        >
          {label}
        </Badge>
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
  bold: {
    group: "gap-2",
    option: "rounded-none border-2 border-foreground px-4 py-2 text-sm font-black uppercase tracking-wider",
  },
  classic: {
    group: "gap-2",
    option: "rounded-md px-3 py-1.5 text-sm",
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
  bold: "h-14 w-full rounded-none text-base font-black uppercase tracking-widest",
  classic: "h-11 w-full rounded-md text-base font-semibold",
  tonkic: "h-14 w-full rounded-full text-base font-semibold",
  solid: "h-12 w-full rounded-xl text-sm font-medium",
  default: "",
} as const;

/**
 * Adds the selected variant to the (in-memory) cart. A product with several variants needs a
 * choice first, and the quantity can never exceed that variant's stock.
 */
export function AddToCart({ look, slug, className }: { look: keyof typeof ADD_STYLES; slug: string; className?: string }) {
  const { variant, complete, content } = useProduct();
  const cart = useCart();
  // Remember which variant the message is about, so choosing another option clears it.
  const [noted, setNoted] = useState<{ variantId: string; kind: "added" | "max" } | null>(null);
  const note = variant && noted?.variantId === variant.id ? noted.kind : null;

  const label = !complete
    ? content["product.selectOptions"]
    : !variant
      ? content["product.unavailable"]
      : variant.stock === 0
        ? content["product.outOfStock"]
        : content["product.addToCart"];
  const disabled = !variant || variant.stock === 0;

  return (
    <div className="grid gap-2" data-testid="add-to-cart">
      <button
        type="button"
        disabled={disabled}
        data-testid="add-to-cart-button"
        onClick={() => {
          if (!variant) return;
          setNoted({ variantId: variant.id, kind: cart.add(variant.id, 1, variant.stock) > 0 ? "added" : "max" });
        }}
        className={cn(buttonVariants({ size: "lg" }), ADD_STYLES[look], className)}
      >
        {label}
      </button>
      {note && (
        <p role="status" className="text-sm text-muted-foreground" data-testid="add-to-cart-note">
          {note === "added" ? content["product.added"] : content["product.maxInCart"]}{" "}
          <Link href={`/store/${slug}/cart`} className="font-medium text-foreground underline underline-offset-4">
            {content["product.viewCart"]}
          </Link>
        </p>
      )}
    </div>
  );
}
