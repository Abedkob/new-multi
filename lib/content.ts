import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import type { OptionalSection } from "@/lib/sections";

/**
 * The canonical list of storefront copy. Every template reads these exact keys
 * (never its own), so switching templates never loses or orphans content.
 *
 * Keys are namespaced by section. `kind`:
 *   text     single line        textarea  multi-line        image  http(s) URL or /path
 * Optional sections (announcement, promo banner, brand story, reviews) render only when
 * their toggle is on AND they have content, so their defaults are empty: nothing (and
 * no fake reviews) is shown until the owner writes something.
 *
 * `title`/`description`/`label` below are admin i18n dictionary keys (see lib/i18n/dictionaries)
 * — they only ever render inside the admin content editor. `default` is real storefront copy
 * (seeded into TenantContent / shown until the owner overwrites it) and stays English, matching
 * the storefront's own out-of-scope status for this i18n pass.
 */

export type ContentKind = "text" | "textarea" | "image";

export const CONTENT_SECTIONS = [
  {
    id: "announcement",
    title: "content.section.announcement.title",
    description: "content.section.announcement.description",
    optional: "announcementBar",
  },
  {
    id: "navbar",
    title: "content.section.navbar.title",
    description: "content.section.navbar.description",
  },
  {
    id: "hero",
    title: "content.section.hero.title",
    description: "content.section.hero.description",
    optional: "heroText",
  },
  {
    id: "featuredCategories",
    title: "content.section.featuredCategories.title",
    description: "content.section.featuredCategories.description",
  },
  {
    id: "newArrivals",
    title: "content.section.newArrivals.title",
    description: "content.section.newArrivals.description",
  },
  {
    id: "bestSellers",
    title: "content.section.bestSellers.title",
    description: "content.section.bestSellers.description",
  },
  {
    id: "promoBanner",
    title: "content.section.promoBanner.title",
    description: "content.section.promoBanner.description",
    optional: "promoBanner",
  },
  {
    id: "brandStory",
    title: "content.section.brandStory.title",
    description: "content.section.brandStory.description",
    optional: "brandStory",
  },
  {
    id: "reviews",
    title: "content.section.reviews.title",
    description: "content.section.reviews.description",
    optional: "reviews",
  },
  {
    id: "faqSection",
    title: "content.section.faqSection.title",
    description: "content.section.faqSection.description",
    optional: "faqSection",
  },
  {
    id: "footer",
    title: "content.section.footer.title",
    description: "content.section.footer.description",
  },
  {
    id: "pages",
    title: "content.section.pages.title",
    description: "content.section.pages.description",
  },
  {
    id: "catalog",
    title: "content.section.catalog.title",
    description: "content.section.catalog.description",
  },
  {
    id: "checkout",
    title: "content.section.checkout.title",
    description: "content.section.checkout.description",
  },
  {
    id: "productPage",
    title: "content.section.productPage.title",
    description: "content.section.productPage.description",
  },
] as const satisfies readonly {
  id: string;
  title: DictionaryKey;
  description: DictionaryKey;
  optional?: OptionalSection;
}[];

export type ContentSectionId = (typeof CONTENT_SECTIONS)[number]["id"];

type KeyDef = {
  section: ContentSectionId;
  key: string;
  label: DictionaryKey;
  /** Set only for numbered repeats (hero slides 2-5, review/FAQ items) — content-editor.tsx
   * renders `t(label) + " " + labelSuffix`, since baking the number into a dictionary string
   * would make it a different key per slide instead of one reusable "Headline" label. */
  labelSuffix?: number;
  kind: ContentKind;
  default: string;
  /** Written into a brand-new store's TenantContent rows. */
  seed?: boolean;
};

/** Hero slide numbers beyond the main hero (slide 1, the plain hero.* keys). */
export const HERO_EXTRA_SLIDES = [2, 3, 4, 5] as const;

const item = (
  section: ContentSectionId,
  prefix: string,
  n: number,
  fields: { name: string; label: DictionaryKey; kind: ContentKind; default?: string }[],
): KeyDef[] =>
  fields.map((f) => ({
    section,
    key: `${prefix}.item${n}.${f.name}`,
    label: f.label,
    labelSuffix: n,
    kind: f.kind,
    default: f.default ?? "",
  }));

export const CONTENT_KEYS = [
  // 1. Announcement bar
  { section: "announcement", key: "announcement.text", label: "content.field.announcement.text", kind: "text", default: "" },

  // 2. Navbar
  { section: "navbar", key: "navbar.logo", label: "content.field.navbar.logo", kind: "image", default: "" },
  { section: "navbar", key: "navbar.logoText", label: "content.field.navbar.logoText", kind: "text", default: "" },
  { section: "navbar", key: "navbar.shopLabel", label: "content.field.navbar.shopLabel", kind: "text", default: "Shop" },
  { section: "navbar", key: "navbar.cartLabel", label: "content.field.navbar.cartLabel", kind: "text", default: "Cart" },
  { section: "navbar", key: "navbar.menuLabel", label: "content.field.navbar.menuLabel", kind: "text", default: "Menu" },
  { section: "navbar", key: "navbar.categoriesLabel", label: "content.field.navbar.categoriesLabel", kind: "text", default: "Categories" },

  // 3. Hero
  { section: "hero", key: "hero.headline", label: "content.field.hero.headline", kind: "text", default: "Welcome to our store", seed: true },
  { section: "hero", key: "hero.subtext", label: "content.field.hero.subtext", kind: "textarea", default: "Discover our latest products.", seed: true },
  { section: "hero", key: "hero.ctaLabel", label: "content.field.hero.ctaLabel", kind: "text", default: "Shop now" },
  { section: "hero", key: "hero.image", label: "content.field.hero.image", kind: "image", default: "" },
  { section: "hero", key: "hero.imageMobile", label: "content.field.hero.imageMobile", kind: "image", default: "" },
  // Extra slides: optional, blank by default. A template with a hero slider (Tonkic, Mirage)
  // shows each as another slide once given a headline or image; Muse uses slides 2-3 as the
  // images (and slide 2's text) of its bento hero's other two blocks; others ignore them.
  ...HERO_EXTRA_SLIDES.flatMap((n) =>
    item("hero", "hero", n, [
      { name: "headline", label: "content.field.hero.headline", kind: "text" },
      { name: "subtext", label: "content.field.hero.subtext", kind: "textarea" },
      { name: "ctaLabel", label: "content.field.hero.ctaLabel", kind: "text" },
      { name: "image", label: "content.field.hero.slideImage", kind: "image" },
      { name: "imageMobile", label: "content.field.hero.slideImageMobile", kind: "image" },
    ]),
  ),

  // 4. Featured categories
  // Tiles are your real top-level categories (manage them under Categories).
  { section: "featuredCategories", key: "featuredCategories.heading", label: "content.field.heading", kind: "text", default: "Shop by category" },
  { section: "featuredCategories", key: "featuredCategories.tileCta", label: "content.field.featuredCategories.tileCta", kind: "text", default: "Explore" },

  // 5. New arrivals
  { section: "newArrivals", key: "newArrivals.heading", label: "content.field.heading", kind: "text", default: "New arrivals" },
  { section: "newArrivals", key: "newArrivals.empty", label: "content.field.emptyMessage", kind: "text", default: "No products yet. Check back soon." },

  // 6. Best sellers
  { section: "bestSellers", key: "bestSellers.heading", label: "content.field.heading", kind: "text", default: "Best sellers" },
  { section: "bestSellers", key: "bestSellers.empty", label: "content.field.bestSellers.empty", kind: "text", default: "Our best sellers will appear here soon." },

  // 7. Promotional banner
  { section: "promoBanner", key: "promoBanner.heading", label: "content.field.heading", kind: "text", default: "" },
  { section: "promoBanner", key: "promoBanner.subtext", label: "content.field.subtext", kind: "textarea", default: "" },
  { section: "promoBanner", key: "promoBanner.ctaLabel", label: "content.field.buttonText", kind: "text", default: "Shop now" },
  { section: "promoBanner", key: "promoBanner.image", label: "content.field.optionalImageUrl", kind: "image", default: "" },

  // 8. Brand / collection story
  { section: "brandStory", key: "brandStory.heading", label: "content.field.heading", kind: "text", default: "" },
  { section: "brandStory", key: "brandStory.body", label: "content.field.brandStory.body", kind: "textarea", default: "" },
  { section: "brandStory", key: "brandStory.image", label: "content.field.optionalImageUrl", kind: "image", default: "" },

  // 9. Reviews / social proof
  { section: "reviews", key: "reviews.heading", label: "content.field.heading", kind: "text", default: "What customers say" },
  ...[1, 2, 3].flatMap((n) =>
    item("reviews", "reviews", n, [
      { name: "quote", label: "content.field.reviews.quote", kind: "textarea" },
      { name: "author", label: "content.field.reviews.author", kind: "text" },
    ]),
  ),

  // 9b. FAQ
  { section: "faqSection", key: "faqSection.heading", label: "content.field.heading", kind: "text", default: "Frequently asked questions" },
  ...[1, 2, 3, 4, 5, 6].flatMap((n) =>
    item("faqSection", "faqSection", n, [
      { name: "question", label: "content.field.faq.question", kind: "text" },
      { name: "answer", label: "content.field.faq.answer", kind: "textarea" },
    ]),
  ),

  // 10. Footer
  { section: "footer", key: "footer.about", label: "content.field.footer.about", kind: "textarea", default: "We are a small store. Tell your customers about yourself here.", seed: true },
  { section: "footer", key: "footer.linksHeading", label: "content.field.footer.linksHeading", kind: "text", default: "Quick links" },
  { section: "footer", key: "footer.copyright", label: "content.field.footer.copyright", kind: "text", default: "© {year} {store}. All rights reserved." },

  // Pages (each is only linked and reachable when its text is non-empty)
  { section: "pages", key: "about.title", label: "content.field.pages.aboutTitle", kind: "text", default: "About us" },
  { section: "pages", key: "about.image", label: "content.field.pages.aboutImage", kind: "image", default: "" },
  { section: "pages", key: "about.body", label: "content.field.pages.aboutBody", kind: "textarea", default: "" },
  { section: "pages", key: "contact.title", label: "content.field.pages.contactTitle", kind: "text", default: "Contact" },
  { section: "pages", key: "contact.body", label: "content.field.pages.contactBody", kind: "textarea", default: "" },
  { section: "pages", key: "faq.title", label: "content.field.pages.faqTitle", kind: "text", default: "FAQ" },
  { section: "pages", key: "faq.body", label: "content.field.pages.faqBody", kind: "textarea", default: "" },
  { section: "pages", key: "shipping.title", label: "content.field.pages.shippingTitle", kind: "text", default: "Shipping & returns" },
  { section: "pages", key: "shipping.body", label: "content.field.pages.shippingBody", kind: "textarea", default: "" },

  // Shop, category & search pages
  { section: "catalog", key: "shop.heading", label: "content.field.catalog.shopHeading", kind: "text", default: "Shop" },
  { section: "catalog", key: "shop.empty", label: "content.field.catalog.shopEmpty", kind: "text", default: "No products yet. Check back soon." },
  { section: "catalog", key: "category.empty", label: "content.field.catalog.categoryEmpty", kind: "text", default: "No products in this category yet." },
  { section: "catalog", key: "category.subcategories", label: "content.field.catalog.subcategoriesHeading", kind: "text", default: "Subcategories" },
  { section: "catalog", key: "catalog.allProducts", label: "content.field.catalog.allProducts", kind: "text", default: "All products" },
  { section: "catalog", key: "catalog.count", label: "content.field.catalog.count", kind: "text", default: "{count} products" },
  { section: "catalog", key: "catalog.previous", label: "content.field.catalog.previous", kind: "text", default: "Previous" },
  { section: "catalog", key: "catalog.next", label: "content.field.catalog.next", kind: "text", default: "Next" },
  { section: "catalog", key: "catalog.pageOf", label: "content.field.catalog.pageOf", kind: "text", default: "Page {page} of {pages}" },
  { section: "catalog", key: "catalog.filters", label: "content.field.catalog.filters", kind: "text", default: "Filters" },
  { section: "catalog", key: "catalog.sort", label: "content.field.catalog.sort", kind: "text", default: "Sort by" },
  { section: "catalog", key: "catalog.sortNewest", label: "content.field.catalog.sortNewest", kind: "text", default: "Newest" },
  { section: "catalog", key: "catalog.sortPriceAsc", label: "content.field.catalog.sortPriceAsc", kind: "text", default: "Price: low to high" },
  { section: "catalog", key: "catalog.sortPriceDesc", label: "content.field.catalog.sortPriceDesc", kind: "text", default: "Price: high to low" },
  { section: "catalog", key: "catalog.sortSale", label: "content.field.catalog.sortSale", kind: "text", default: "On sale first" },
  { section: "catalog", key: "catalog.sortName", label: "content.field.catalog.sortName", kind: "text", default: "Name: A to Z" },
  { section: "catalog", key: "catalog.price", label: "content.field.catalog.price", kind: "text", default: "Price" },
  { section: "catalog", key: "catalog.min", label: "content.field.catalog.min", kind: "text", default: "Min" },
  { section: "catalog", key: "catalog.max", label: "content.field.catalog.max", kind: "text", default: "Max" },
  { section: "catalog", key: "catalog.apply", label: "content.field.catalog.apply", kind: "text", default: "Apply" },
  { section: "catalog", key: "catalog.inStock", label: "content.field.catalog.inStock", kind: "text", default: "In stock only" },
  { section: "catalog", key: "catalog.clear", label: "content.field.catalog.clear", kind: "text", default: "Clear filters" },
  { section: "catalog", key: "catalog.noMatch", label: "content.field.catalog.noMatch", kind: "text", default: "No products match these filters." },
  { section: "catalog", key: "search.heading", label: "content.field.catalog.searchHeading", kind: "text", default: "Search" },
  { section: "catalog", key: "search.placeholder", label: "content.field.catalog.searchPlaceholder", kind: "text", default: "Search products" },
  { section: "catalog", key: "search.button", label: "content.field.catalog.searchButton", kind: "text", default: "Search" },
  { section: "catalog", key: "search.empty", label: "content.field.catalog.searchEmpty", kind: "text", default: "No products match \"{q}\"." },

  // Cart, checkout & confirmation
  { section: "checkout", key: "cart.heading", label: "content.field.checkout.cartHeading", kind: "text", default: "Your cart" },
  { section: "checkout", key: "cart.empty", label: "content.field.checkout.cartEmpty", kind: "text", default: "Your cart is empty." },
  { section: "checkout", key: "cart.continue", label: "content.field.checkout.continueShopping", kind: "text", default: "Continue shopping" },
  { section: "checkout", key: "cart.subtotal", label: "content.field.checkout.subtotal", kind: "text", default: "Subtotal" },
  { section: "checkout", key: "cart.remove", label: "content.field.checkout.remove", kind: "text", default: "Remove" },
  { section: "checkout", key: "cart.lowStock", label: "content.field.checkout.lowStock", kind: "text", default: "Only {stock} available" },
  { section: "checkout", key: "cart.removedNotice", label: "content.field.checkout.removedNotice", kind: "text", default: "Some items were removed because they are no longer available." },
  { section: "checkout", key: "cart.priceChanged", label: "content.field.checkout.priceChanged", kind: "text", default: "One or more prices increased. Review your updated total and place the order again." },
  { section: "checkout", key: "cart.checkout", label: "content.field.checkout.checkoutButton", kind: "text", default: "Checkout" },
  { section: "checkout", key: "checkout.heading", label: "content.field.checkout.checkoutHeading", kind: "text", default: "Checkout" },
  { section: "checkout", key: "checkout.cod", label: "content.field.checkout.codNote", kind: "text", default: "Cash on delivery: you pay the courier when your order arrives." },
  { section: "checkout", key: "checkout.name", label: "content.field.checkout.nameLabel", kind: "text", default: "Full name" },
  { section: "checkout", key: "checkout.phone", label: "content.field.checkout.phoneLabel", kind: "text", default: "Phone number" },
  { section: "checkout", key: "checkout.address", label: "content.field.checkout.addressLabel", kind: "text", default: "Address" },
  { section: "checkout", key: "checkout.location", label: "content.field.checkout.locationLabel", kind: "text", default: "Delivery location" },
  { section: "checkout", key: "checkout.locationHint", label: "content.field.checkout.locationHint", kind: "text", default: "A Google Maps link, or a description of where to deliver." },
  { section: "checkout", key: "checkout.useLocation", label: "content.field.checkout.useLocation", kind: "text", default: "Use my current location" },
  { section: "checkout", key: "checkout.locating", label: "content.field.checkout.locating", kind: "text", default: "Finding your location..." },
  { section: "checkout", key: "checkout.locationFound", label: "content.field.checkout.locationFound", kind: "text", default: "Your location was added." },
  { section: "checkout", key: "checkout.viewOnMap", label: "content.field.checkout.viewOnMap", kind: "text", default: "View on map" },
  { section: "checkout", key: "checkout.locationDenied", label: "content.field.checkout.locationDenied", kind: "text", default: "Location access is blocked. Allow it in your browser settings, or paste a Google Maps link below." },
  { section: "checkout", key: "checkout.locationUnavailable", label: "content.field.checkout.locationUnavailable", kind: "text", default: "We couldn't get your location. Paste a Google Maps link or describe where to deliver." },
  { section: "checkout", key: "checkout.notes", label: "content.field.checkout.notesLabel", kind: "text", default: "Order notes (optional)" },
  { section: "checkout", key: "checkout.summary", label: "content.field.checkout.summaryHeading", kind: "text", default: "Order summary" },
  { section: "checkout", key: "checkout.submit", label: "content.field.checkout.submitButton", kind: "text", default: "Place order" },
  { section: "checkout", key: "checkout.placing", label: "content.field.checkout.placingButton", kind: "text", default: "Placing your order..." },
  { section: "checkout", key: "confirmation.heading", label: "content.field.checkout.confirmationHeading", kind: "text", default: "Thank you!" },
  { section: "checkout", key: "confirmation.body", label: "content.field.checkout.confirmationBody", kind: "textarea", default: "We have received your order and will call you to confirm it." },
  { section: "checkout", key: "confirmation.summary", label: "content.field.checkout.confirmationSummary", kind: "text", default: "Your order" },
  { section: "checkout", key: "confirmation.total", label: "content.field.checkout.totalLabel", kind: "text", default: "Total" },
  { section: "checkout", key: "confirmation.payment", label: "content.field.checkout.paymentReminder", kind: "text", default: "Pay in cash when your order arrives." },
  { section: "checkout", key: "confirmation.continue", label: "content.field.checkout.continueShopping", kind: "text", default: "Continue shopping" },

  // Product page + product cards
  { section: "productPage", key: "product.inStock", label: "content.field.product.inStock", kind: "text", default: "In stock" },
  { section: "productPage", key: "product.outOfStock", label: "content.field.product.outOfStock", kind: "text", default: "Out of stock" },
  { section: "productPage", key: "product.back", label: "content.field.product.back", kind: "text", default: "Back to all products" },
  { section: "productPage", key: "product.descriptionHeading", label: "content.field.product.descriptionHeading", kind: "text", default: "Description" },
  { section: "productPage", key: "product.relatedHeading", label: "content.field.product.relatedHeading", kind: "text", default: "You may also like" },
  { section: "productPage", key: "product.quantity", label: "content.field.product.quantity", kind: "text", default: "Quantity" },
  { section: "productPage", key: "product.addToCart", label: "content.field.product.addToCart", kind: "text", default: "Add to cart" },
  { section: "productPage", key: "product.added", label: "content.field.product.added", kind: "text", default: "Added to your cart" },
  { section: "productPage", key: "product.viewCart", label: "content.field.product.viewCart", kind: "text", default: "View cart" },
  { section: "productPage", key: "product.maxInCart", label: "content.field.product.maxInCart", kind: "text", default: "All available stock is already in your cart" },
  { section: "productPage", key: "product.fromLabel", label: "content.field.product.fromLabel", kind: "text", default: "From" },
  { section: "productPage", key: "product.saleBadge", label: "content.field.product.saleBadge", kind: "text", default: "Sale" },
  { section: "productPage", key: "product.selectOptions", label: "content.field.product.selectOptions", kind: "text", default: "Select options" },
  { section: "productPage", key: "product.unavailable", label: "content.field.product.unavailable", kind: "text", default: "This combination isn't available" },
  { section: "productPage", key: "product.viewLabel", label: "content.field.product.viewLabel", kind: "text", default: "View product" },
] as const satisfies readonly KeyDef[];

export type ContentKey = (typeof CONTENT_KEYS)[number]["key"];
export const CONTENT_KEY_NAMES: string[] = CONTENT_KEYS.map((c) => c.key);
export const IMAGE_CONTENT_KEYS: string[] = CONTENT_KEYS.filter(
  (c) => c.kind === "image",
).map((c) => c.key);

export type ContentMap = Record<ContentKey, string>;

/** Merge stored rows over the defaults so templates always get a string for every key. */
export function resolveContent(rows: { key: string; value: string }[]) {
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as ContentMap;
  for (const c of CONTENT_KEYS) out[c.key] = stored.get(c.key) ?? c.default;
  return out;
}

export const SEED_CONTENT = CONTENT_KEYS.filter(
  (c) => "seed" in c && c.seed,
).map((c) => ({ key: c.key as string, value: c.default as string }));

/** Fills {year} and {store} in copy such as the copyright line. */
export function fillTokens(text: string, store: { name: string }) {
  return text
    .replaceAll("{year}", String(new Date().getFullYear()))
    .replaceAll("{store}", store.name);
}

/** Fills {name} placeholders in copy, e.g. fillVars("Page {page} of {pages}", { page: 2, pages: 5 }). */
export function fillVars(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
