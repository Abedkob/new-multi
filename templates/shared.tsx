import Image from "next/image";
import Link from "next/link";
import type { ContentMap } from "@/lib/content";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StoreInfo, StoreProduct } from "./types";

/** Product/hero image, or a neutral placeholder tile (theme "muted" color) when there is none. */
export function Picture({
  src,
  alt,
  className,
  imgClassName,
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  sizes?: string;
}) {
  return (
    <div className={cn("overflow-hidden relative", className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className={cn("object-cover", imgClassName)}
        />
      ) : (
        <div
          aria-hidden
          className="flex h-full w-full items-center justify-center text-5xl font-light text-muted-foreground/40"
        >
          {alt.trim().charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/**
 * The navbar brand mark. No logo: the store name as text (unchanged behavior). Logo, no text:
 * just the logo. Logo + text: both side by side. Always links home. `className` styles the
 * link (and, via inheritance, any text shown); `logoClassName` sizes the image (set a height,
 * e.g. "h-8" — width stays auto so the logo keeps its own aspect ratio).
 */
export function StoreBrand({
  store,
  content,
  className,
  logoClassName,
}: {
  store: StoreInfo;
  content: ContentMap;
  className?: string;
  logoClassName?: string;
}) {
  const logo = content["navbar.logo"];
  const text = content["navbar.logoText"];
  return (
    <Link href={`/store/${store.slug}`} className={cn(logo && "flex items-center gap-2", className)}>
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element -- intrinsic size, not a cropped box; next/image needs fixed dimensions this doesn't have.
        <img src={logo} alt={text || store.name} className={cn("w-auto object-contain", logoClassName)} />
      )}
      {(text || !logo) && <span>{text || store.name}</span>}
    </Link>
  );
}

export const productHref = (store: StoreInfo, p: StoreProduct) =>
  `/store/${store.slug}/products/${p.slug}`;

/** Links that also work from product pages (not just same-page anchors). */
export const sectionHref = (store: StoreInfo, anchor: string) =>
  `/store/${store.slug}#${anchor}`;

/** Card price: "From $x" when a product's variants have different prices. */
export const cardPrice = (product: StoreProduct, content: ContentMap) =>
  `${product.hasPriceRange ? `${content["product.fromLabel"]} ` : ""}${formatPrice(product.priceCents)}`;
