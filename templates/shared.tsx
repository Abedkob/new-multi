import Image from "next/image";
import Link from "next/link";
import type { ContentMap } from "@/lib/content";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StoreMenu } from "./nav-client";
import type { StoreInfo, StorefrontData, StoreProduct } from "./types";

/** Product/hero image, or a neutral placeholder tile (theme "muted" color) when there is none. */
export function Picture({
  src,
  alt,
  className,
  imgClassName,
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
  quality = 90,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  sizes?: string;
  /** Next's image optimizer quality (0-100, default 75); every storefront photo asks for a
   * sharper 90 instead, since a slightly larger file beats visibly soft product photos. */
  quality?: number;
}) {
  return (
    <div className={cn("overflow-hidden relative", className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          quality={quality}
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
    <Link href={storeHref(store)} data-store-brand className={cn(logo && "flex items-center gap-2", className)}>
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element -- intrinsic size, not a cropped box; next/image needs fixed dimensions this doesn't have.
        <img src={logo} alt={text || store.name} className={cn("w-auto object-contain", logoClassName)} />
      )}
      {(text || !logo) && <span>{text || store.name}</span>}
    </Link>
  );
}

/**
 * Every storefront-internal href goes through here (or one of the specific helpers below), never
 * through a hand-rolled `/store/${store.slug}` template literal — store.basePath is "" once the
 * store has its own domain (see templates/types.ts), and a literal would then produce a broken
 * double-prefixed link. `path`, if given, is store-relative, e.g. "/shop" or "/products/x".
 */
export const storeHref = (store: StoreInfo, path = "") => {
  if (!path) return store.basePath || "/";
  return `${store.basePath}${path.startsWith("/") ? path : `/${path}`}`;
};

export const shopHref = (store: StoreInfo) => storeHref(store, "/shop");
export const searchHref = (store: StoreInfo) => storeHref(store, "/search");
export const cartHref = (store: StoreInfo) => storeHref(store, "/cart");

export const productHref = (store: StoreInfo, p: StoreProduct) =>
  storeHref(store, `/products/${p.slug}`);

/** Links that also work from product pages (not just same-page anchors). */
export const sectionHref = (store: StoreInfo, anchor: string) =>
  `${storeHref(store)}#${anchor}`;

/** Shared card price so every template renders automatic discounts consistently. */
export const cardPrice = (product: StoreProduct, content: ContentMap) => (
  <>
    {product.isOnSale && (
      <span className="mr-2 text-muted-foreground line-through decoration-1">
        {formatPrice(product.regularPriceCents)}
      </span>
    )}
    <span>
      {product.hasPriceRange ? `${content["product.fromLabel"]} ` : ""}
      {formatPrice(product.priceCents)}
    </span>
    {product.isOnSale && (
      <span className="ml-2 inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-[0.7rem] leading-4 font-semibold text-destructive">
        {content["product.saleBadge"]}
      </span>
    )}
  </>
);

/** The store menu (hamburger + drawer) with everything filled in from the storefront data. */
export function StoreMenuButton({
  data,
  className,
  buttonClassName,
}: {
  data: StorefrontData;
  className?: string;
  buttonClassName?: string;
}) {
  const { store, content, categoryTiles, pages } = data;
  return (
    <StoreMenu
      slug={store.slug}
      basePath={store.basePath}
      shopHref={shopHref(store)}
      categories={categoryTiles.map((c) => ({ id: c.id, label: c.label, href: c.href }))}
      pages={pages.map((p) => ({ slug: p.slug, label: p.label, href: p.href }))}
      labels={{
        menu: content["navbar.menuLabel"],
        shop: content["navbar.shopLabel"],
        categories: content["navbar.categoriesLabel"],
        searchPlaceholder: content["search.placeholder"],
        searchButton: content["search.button"],
      }}
      className={className}
      buttonClassName={buttonClassName}
    />
  );
}

/**
 * The hero photo: "Hero image (Mobile)" on phones, "Hero image (Desktop & Tablet)" from the sm
 * breakpoint up; whichever one exists is used everywhere when only one is set. `className`
 * sizes the desktop picture, `mobileClassName` (default: the same) the phone one.
 */
export function HeroPicture({
  content,
  alt,
  className,
  mobileClassName,
}: {
  content: ContentMap;
  alt: string;
  className?: string;
  mobileClassName?: string;
}) {
  const desktop = content["hero.image"];
  const mobile = content["hero.imageMobile"];
  return (
    <>
      {mobile && (
        <Picture
          src={mobile}
          alt={alt}
          sizes="100vw"
          className={cn(mobileClassName ?? className, desktop && "sm:hidden")}
        />
      )}
      {desktop && (
        <Picture src={desktop} alt={alt} sizes="100vw" className={cn(className, mobile && "hidden sm:block")} />
      )}
    </>
  );
}
