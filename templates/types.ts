import type { ComponentType } from "react";
import type { ContentMap } from "@/lib/content";
import type { HomeSectionId, SectionVisibility } from "@/lib/sections";

export type StoreInfo = {
  name: string;
  slug: string;
  /**
   * Prefix every storefront-internal link needs: "/store/{slug}" for a path-based store, or ""
   * once it has its own domain (the domain's root already IS the store, so links stay relative
   * — see lib/store-url.ts's getStoreBasePath, which is where this value comes from).
   */
  basePath: string;
};

export type StoreVariant = {
  id: string;
  attributes: Record<string, string>;
  /** "size: 40, color: white", or "Default" for a product without real variation. */
  label: string;
  stock: number;
  /** Effective price: the variant's override, else the product's base price. */
  priceCents: number;
  /** Effective image: the variant's override, else the product's image ("" if none). */
  imageUrl: string;
};

export type StoreProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** The product's own image (variants may override it). */
  imageUrl: string;
  /** Extra gallery photos, in display order (may be empty). */
  images: { url: string; altText: string }[];
  /** Lowest variant price; shown with a "From" prefix when `hasPriceRange`. */
  priceCents: number;
  hasPriceRange: boolean;
  /** True when any variant has stock. Stock itself is per variant, never per product. */
  inStock: boolean;
  isBestSeller: boolean;
  categoryId: string | null;
  variants: StoreVariant[];
};

export type CategoryTile = {
  id: string;
  label: string;
  slug: string;
  /** The category's own cover image, else the newest product photo in it or below it ("" if neither). */
  image: string;
  href: string;
};

/** A content page (About, Contact, FAQ, Shipping) that has text, so it may be linked. */
export type PageLink = {
  slug: "about" | "contact" | "faq" | "shipping";
  label: string;
  href: string;
};

export type ReviewItem = { quote: string; author: string };

/**
 * Everything a template needs, prepared once by lib/storefront-data.ts. Templates only
 * read this: they never query, and never hardcode copy or colors.
 */
export type StorefrontData = {
  store: StoreInfo;
  content: ContentMap;
  visibility: SectionVisibility;
  newArrivals: StoreProduct[];
  bestSellers: StoreProduct[];
  /** Top-level categories, for the featured tiles and navigation. */
  categoryTiles: CategoryTile[];
  /** Only pages whose text is non-empty, so a blank page is never linked. */
  pages: PageLink[];
  reviews: ReviewItem[];
};

export type SectionComponent = ComponentType<{ data: StorefrontData }>;

/**
 * Every template implements the same ten sections. The renderer (templates/render.tsx)
 * decides which appear and in what order, so a template only decides how each one looks.
 */
export type Template = {
  Announcement: SectionComponent;
  Navbar: SectionComponent;
  Hero: SectionComponent;
  FeaturedCategories: SectionComponent;
  NewArrivals: SectionComponent;
  BestSellers: SectionComponent;
  PromoBanner: SectionComponent;
  BrandStory: SectionComponent;
  Reviews: SectionComponent;
  Footer: SectionComponent;
  /** Order of the 7 home sections (between navbar and footer). Defaults to lib/sections.ts's
   * HOME_SECTION_ORDER (hero, featuredCategories, newArrivals, bestSellers, promoBanner,
   * brandStory, reviews) when omitted. Set this only when the template's layout genuinely calls
   * for a different flow, e.g. new arrivals right after the hero. Visibility rules (an empty
   * optional section still disappears) are unaffected — this only changes relative order. */
  homeSectionOrder?: readonly HomeSectionId[];
  /** A grid of product cards, used by the shop, category and search pages. */
  ProductGrid: ComponentType<{ data: StorefrontData; products: StoreProduct[] }>;
  /** Where the catalog sort + filters go: above the grid (default) or in a column on its left
   * (from the lg breakpoint; phones always get the collapsible bar above). */
  filterLayout?: "top" | "sidebar";
  /** Classes the shared utility pages (catalog, cart, checkout, content) use, so they match the template. */
  pageStyle: {
    container: string;
    title: string;
    subtitle: string;
    chip: string;
    panel: string;
    /** The shop/category/search pages' container when it should differ from `container`
     * (e.g. wider, to fit the filter sidebar beside the grid). */
    catalogContainer?: string;
  };
  ProductPage: ComponentType<{
    data: StorefrontData;
    product: StoreProduct;
    /** Other products from the same store (up to 4). */
    related: StoreProduct[];
  }>;
};
