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
 */

export type ContentKind = "text" | "textarea" | "image";

export const CONTENT_SECTIONS = [
  {
    id: "announcement",
    title: "Announcement bar",
    description: "A thin strip above the navbar. Leave the text empty to show nothing.",
    optional: "announcementBar",
  },
  {
    id: "navbar",
    title: "Navbar",
    description:
      "Add a logo for the header. Without one, your store name is shown as text; add text beside " +
      "the logo if you want both. Other links reuse section headings.",
  },
  {
    id: "hero",
    title: "Hero",
    description:
      "The first thing visitors see. Slides 2 and 3 are optional — fill either in to turn the hero into a " +
      "rotating slider (only templates that support a slider use them).",
    optional: "heroText",
  },
  {
    id: "featuredCategories",
    title: "Featured categories",
    description:
      "Shows your top-level categories as tiles (managed under Categories). Hidden until you have at least one.",
  },
  {
    id: "newArrivals",
    title: "New arrivals",
    description: "Automatically shows your most recently added products.",
  },
  {
    id: "bestSellers",
    title: "Best sellers",
    description: "Shows the products you tick as \"Best seller\" in Products.",
  },
  {
    id: "promoBanner",
    title: "Promotional banner",
    description: "A call-to-action banner. Needs a heading or an image to appear.",
    optional: "promoBanner",
  },
  {
    id: "brandStory",
    title: "Brand / collection story",
    description: "Tell your story. Needs a heading or body text to appear.",
    optional: "brandStory",
  },
  {
    id: "reviews",
    title: "Reviews / social proof",
    description: "Up to three customer quotes. Only add real ones. Needs at least one quote to appear.",
    optional: "reviews",
  },
  {
    id: "footer",
    title: "Footer",
    description: "{year} and {store} in the copyright text are filled in automatically.",
  },
  {
    id: "pages",
    title: "Pages",
    description:
      "About, Contact, FAQ and Shipping pages. A page is only linked from your storefront (and reachable) once its text is filled in. Plain text; blank lines make paragraphs.",
  },
  {
    id: "catalog",
    title: "Shop, category & search pages",
    description: "Headings and messages for the shop, category and search pages.",
  },
  {
    id: "checkout",
    title: "Cart, checkout & confirmation",
    description: "Wording for the cart page, the cash-on-delivery checkout form and the thank-you page.",
  },
  {
    id: "productPage",
    title: "Product page",
    description: "Labels used on individual product pages and product cards.",
  },
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  optional?: OptionalSection;
}[];

export type ContentSectionId = (typeof CONTENT_SECTIONS)[number]["id"];

type KeyDef = {
  section: ContentSectionId;
  key: string;
  label: string;
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
  fields: { name: string; label: string; kind: ContentKind; default?: string }[],
): KeyDef[] =>
  fields.map((f) => ({
    section,
    key: `${prefix}.item${n}.${f.name}`,
    label: `${f.label} ${n}`,
    kind: f.kind,
    default: f.default ?? "",
  }));

export const CONTENT_KEYS = [
  // 1. Announcement bar
  { section: "announcement", key: "announcement.text", label: "Announcement text", kind: "text", default: "" },

  // 2. Navbar
  { section: "navbar", key: "navbar.logo", label: "Logo image (optional)", kind: "image", default: "" },
  { section: "navbar", key: "navbar.logoText", label: "Text beside logo (optional)", kind: "text", default: "" },
  { section: "navbar", key: "navbar.shopLabel", label: "Shop link text", kind: "text", default: "Shop" },
  { section: "navbar", key: "navbar.cartLabel", label: "Cart link text", kind: "text", default: "Cart" },
  { section: "navbar", key: "navbar.menuLabel", label: "Phone menu: button label", kind: "text", default: "Menu" },
  { section: "navbar", key: "navbar.categoriesLabel", label: "Phone menu: categories heading", kind: "text", default: "Categories" },

  // 3. Hero
  { section: "hero", key: "hero.headline", label: "Headline", kind: "text", default: "Welcome to our store", seed: true },
  { section: "hero", key: "hero.subtext", label: "Subtext", kind: "textarea", default: "Discover our latest products.", seed: true },
  { section: "hero", key: "hero.ctaLabel", label: "Button text", kind: "text", default: "Shop now" },
  { section: "hero", key: "hero.image", label: "Hero image (Desktop & Tablet)", kind: "image", default: "" },
  { section: "hero", key: "hero.imageMobile", label: "Hero image (Mobile)", kind: "image", default: "" },
  // Extra slides: optional, blank by default. A template with a hero slider (Tonkic, Mirage)
  // shows each as another slide once given a headline or image; Muse uses slides 2-3 as the
  // images (and slide 2's text) of its bento hero's other two blocks; others ignore them.
  ...HERO_EXTRA_SLIDES.flatMap((n) =>
    item("hero", "hero", n, [
      { name: "headline", label: "Headline", kind: "text" },
      { name: "subtext", label: "Subtext", kind: "textarea" },
      { name: "ctaLabel", label: "Button text", kind: "text" },
      { name: "image", label: "Image (Desktop & Tablet)", kind: "image" },
      { name: "imageMobile", label: "Image (Mobile)", kind: "image" },
    ]),
  ),

  // 4. Featured categories
  // Tiles are your real top-level categories (manage them under Categories).
  { section: "featuredCategories", key: "featuredCategories.heading", label: "Heading", kind: "text", default: "Shop by category" },
  { section: "featuredCategories", key: "featuredCategories.tileCta", label: "Text under each category (some templates)", kind: "text", default: "Explore" },

  // 5. New arrivals
  { section: "newArrivals", key: "newArrivals.heading", label: "Heading", kind: "text", default: "New arrivals" },
  { section: "newArrivals", key: "newArrivals.empty", label: "Message when there are no products", kind: "text", default: "No products yet. Check back soon." },

  // 6. Best sellers
  { section: "bestSellers", key: "bestSellers.heading", label: "Heading", kind: "text", default: "Best sellers" },
  { section: "bestSellers", key: "bestSellers.empty", label: "Message when nothing is flagged", kind: "text", default: "Our best sellers will appear here soon." },

  // 7. Promotional banner
  { section: "promoBanner", key: "promoBanner.heading", label: "Heading", kind: "text", default: "" },
  { section: "promoBanner", key: "promoBanner.subtext", label: "Subtext", kind: "textarea", default: "" },
  { section: "promoBanner", key: "promoBanner.ctaLabel", label: "Button text", kind: "text", default: "Shop now" },
  { section: "promoBanner", key: "promoBanner.image", label: "Image URL (optional)", kind: "image", default: "" },

  // 8. Brand / collection story
  { section: "brandStory", key: "brandStory.heading", label: "Heading", kind: "text", default: "" },
  { section: "brandStory", key: "brandStory.body", label: "Story", kind: "textarea", default: "" },
  { section: "brandStory", key: "brandStory.image", label: "Image URL (optional)", kind: "image", default: "" },

  // 9. Reviews / social proof
  { section: "reviews", key: "reviews.heading", label: "Heading", kind: "text", default: "What customers say" },
  ...[1, 2, 3].flatMap((n) =>
    item("reviews", "reviews", n, [
      { name: "quote", label: "Quote", kind: "textarea" },
      { name: "author", label: "Author", kind: "text" },
    ]),
  ),

  // 10. Footer
  { section: "footer", key: "footer.about", label: "About text", kind: "textarea", default: "We are a small store. Tell your customers about yourself here.", seed: true },
  { section: "footer", key: "footer.linksHeading", label: "Links heading", kind: "text", default: "Quick links" },
  { section: "footer", key: "footer.copyright", label: "Copyright line", kind: "text", default: "© {year} {store}. All rights reserved." },

  // Pages (each is only linked and reachable when its text is non-empty)
  { section: "pages", key: "about.title", label: "About page title", kind: "text", default: "About us" },
  { section: "pages", key: "about.image", label: "About page image (optional)", kind: "image", default: "" },
  { section: "pages", key: "about.body", label: "About page text", kind: "textarea", default: "" },
  { section: "pages", key: "contact.title", label: "Contact page title", kind: "text", default: "Contact" },
  { section: "pages", key: "contact.body", label: "Contact page text", kind: "textarea", default: "" },
  { section: "pages", key: "faq.title", label: "FAQ page title", kind: "text", default: "FAQ" },
  { section: "pages", key: "faq.body", label: "FAQ page text", kind: "textarea", default: "" },
  { section: "pages", key: "shipping.title", label: "Shipping page title", kind: "text", default: "Shipping & returns" },
  { section: "pages", key: "shipping.body", label: "Shipping page text", kind: "textarea", default: "" },

  // Shop, category & search pages
  { section: "catalog", key: "shop.heading", label: "Shop page heading", kind: "text", default: "Shop" },
  { section: "catalog", key: "shop.empty", label: "Shop page: no products", kind: "text", default: "No products yet. Check back soon." },
  { section: "catalog", key: "category.empty", label: "Category page: no products", kind: "text", default: "No products in this category yet." },
  { section: "catalog", key: "category.subcategories", label: "Subcategories heading", kind: "text", default: "Subcategories" },
  { section: "catalog", key: "catalog.allProducts", label: "\"All products\" link text", kind: "text", default: "All products" },
  { section: "catalog", key: "catalog.count", label: "Result count ({count} is replaced)", kind: "text", default: "{count} products" },
  { section: "catalog", key: "catalog.previous", label: "Previous page link", kind: "text", default: "Previous" },
  { section: "catalog", key: "catalog.next", label: "Next page link", kind: "text", default: "Next" },
  { section: "catalog", key: "catalog.pageOf", label: "Page indicator ({page}, {pages})", kind: "text", default: "Page {page} of {pages}" },
  { section: "catalog", key: "catalog.filters", label: "Filters button", kind: "text", default: "Filters" },
  { section: "catalog", key: "catalog.sort", label: "Sort label", kind: "text", default: "Sort by" },
  { section: "catalog", key: "catalog.sortNewest", label: "Sort option: newest", kind: "text", default: "Newest" },
  { section: "catalog", key: "catalog.sortPriceAsc", label: "Sort option: price low to high", kind: "text", default: "Price: low to high" },
  { section: "catalog", key: "catalog.sortPriceDesc", label: "Sort option: price high to low", kind: "text", default: "Price: high to low" },
  { section: "catalog", key: "catalog.sortSale", label: "Sort option: discounted products first", kind: "text", default: "On sale first" },
  { section: "catalog", key: "catalog.sortName", label: "Sort option: name", kind: "text", default: "Name: A to Z" },
  { section: "catalog", key: "catalog.price", label: "Price filter heading", kind: "text", default: "Price" },
  { section: "catalog", key: "catalog.min", label: "Minimum price placeholder", kind: "text", default: "Min" },
  { section: "catalog", key: "catalog.max", label: "Maximum price placeholder", kind: "text", default: "Max" },
  { section: "catalog", key: "catalog.apply", label: "Apply price button", kind: "text", default: "Apply" },
  { section: "catalog", key: "catalog.inStock", label: "In-stock filter", kind: "text", default: "In stock only" },
  { section: "catalog", key: "catalog.clear", label: "Clear filters link", kind: "text", default: "Clear filters" },
  { section: "catalog", key: "catalog.noMatch", label: "No products match the filters", kind: "text", default: "No products match these filters." },
  { section: "catalog", key: "search.heading", label: "Search page heading", kind: "text", default: "Search" },
  { section: "catalog", key: "search.placeholder", label: "Search box placeholder", kind: "text", default: "Search products" },
  { section: "catalog", key: "search.button", label: "Search button text", kind: "text", default: "Search" },
  { section: "catalog", key: "search.empty", label: "No results ({q} is replaced)", kind: "text", default: "No products match \"{q}\"." },

  // Cart, checkout & confirmation
  { section: "checkout", key: "cart.heading", label: "Cart heading", kind: "text", default: "Your cart" },
  { section: "checkout", key: "cart.empty", label: "Empty cart message", kind: "text", default: "Your cart is empty." },
  { section: "checkout", key: "cart.continue", label: "Continue shopping link", kind: "text", default: "Continue shopping" },
  { section: "checkout", key: "cart.subtotal", label: "Subtotal label", kind: "text", default: "Subtotal" },
  { section: "checkout", key: "cart.remove", label: "Remove-item button", kind: "text", default: "Remove" },
  { section: "checkout", key: "cart.lowStock", label: "Low-stock note ({stock} is replaced)", kind: "text", default: "Only {stock} available" },
  { section: "checkout", key: "cart.removedNotice", label: "Notice when items were removed", kind: "text", default: "Some items were removed because they are no longer available." },
  { section: "checkout", key: "cart.priceChanged", label: "Notice when a price increased", kind: "text", default: "One or more prices increased. Review your updated total and place the order again." },
  { section: "checkout", key: "cart.checkout", label: "Checkout button", kind: "text", default: "Checkout" },
  { section: "checkout", key: "checkout.heading", label: "Checkout heading", kind: "text", default: "Checkout" },
  { section: "checkout", key: "checkout.cod", label: "Cash-on-delivery note", kind: "text", default: "Cash on delivery: you pay the courier when your order arrives." },
  { section: "checkout", key: "checkout.name", label: "Full name label", kind: "text", default: "Full name" },
  { section: "checkout", key: "checkout.phone", label: "Phone number label", kind: "text", default: "Phone number" },
  { section: "checkout", key: "checkout.address", label: "Address label", kind: "text", default: "Address" },
  { section: "checkout", key: "checkout.location", label: "Delivery location label", kind: "text", default: "Delivery location" },
  { section: "checkout", key: "checkout.locationHint", label: "Delivery location hint", kind: "text", default: "A Google Maps link, or a description of where to deliver." },
  { section: "checkout", key: "checkout.useLocation", label: "Use-my-location button", kind: "text", default: "Use my current location" },
  { section: "checkout", key: "checkout.locating", label: "Text while finding the location", kind: "text", default: "Finding your location..." },
  { section: "checkout", key: "checkout.locationFound", label: "Text once the location is added", kind: "text", default: "Your location was added." },
  { section: "checkout", key: "checkout.viewOnMap", label: "View-on-map link", kind: "text", default: "View on map" },
  { section: "checkout", key: "checkout.locationDenied", label: "Message when location access is blocked", kind: "text", default: "Location access is blocked. Allow it in your browser settings, or paste a Google Maps link below." },
  { section: "checkout", key: "checkout.locationUnavailable", label: "Message when the location can't be found", kind: "text", default: "We couldn't get your location. Paste a Google Maps link or describe where to deliver." },
  { section: "checkout", key: "checkout.notes", label: "Order notes label", kind: "text", default: "Order notes (optional)" },
  { section: "checkout", key: "checkout.summary", label: "Order summary heading", kind: "text", default: "Order summary" },
  { section: "checkout", key: "checkout.submit", label: "Place-order button", kind: "text", default: "Place order" },
  { section: "checkout", key: "checkout.placing", label: "Button text while placing", kind: "text", default: "Placing your order..." },
  { section: "checkout", key: "confirmation.heading", label: "Thank-you heading", kind: "text", default: "Thank you!" },
  { section: "checkout", key: "confirmation.body", label: "Thank-you message", kind: "textarea", default: "We have received your order and will call you to confirm it." },
  { section: "checkout", key: "confirmation.summary", label: "Confirmation summary heading", kind: "text", default: "Your order" },
  { section: "checkout", key: "confirmation.total", label: "Total label", kind: "text", default: "Total" },
  { section: "checkout", key: "confirmation.payment", label: "Payment reminder", kind: "text", default: "Pay in cash when your order arrives." },
  { section: "checkout", key: "confirmation.continue", label: "Continue shopping link", kind: "text", default: "Continue shopping" },

  // Product page + product cards
  { section: "productPage", key: "product.inStock", label: "In-stock label", kind: "text", default: "In stock" },
  { section: "productPage", key: "product.outOfStock", label: "Out-of-stock label", kind: "text", default: "Out of stock" },
  { section: "productPage", key: "product.back", label: "Back-to-store link", kind: "text", default: "Back to all products" },
  { section: "productPage", key: "product.descriptionHeading", label: "Description heading", kind: "text", default: "Description" },
  { section: "productPage", key: "product.relatedHeading", label: "Related products heading", kind: "text", default: "You may also like" },
  { section: "productPage", key: "product.quantity", label: "Quantity label", kind: "text", default: "Quantity" },
  { section: "productPage", key: "product.addToCart", label: "Add-to-cart button", kind: "text", default: "Add to cart" },
  { section: "productPage", key: "product.added", label: "Message after adding to cart", kind: "text", default: "Added to your cart" },
  { section: "productPage", key: "product.viewCart", label: "View-cart link", kind: "text", default: "View cart" },
  { section: "productPage", key: "product.maxInCart", label: "Message when all stock is in the cart", kind: "text", default: "All available stock is already in your cart" },
  { section: "productPage", key: "product.fromLabel", label: "\"From\" prefix for price ranges", kind: "text", default: "From" },
  { section: "productPage", key: "product.saleBadge", label: "Sale-price badge", kind: "text", default: "Sale" },
  { section: "productPage", key: "product.selectOptions", label: "Prompt before options are chosen", kind: "text", default: "Select options" },
  { section: "productPage", key: "product.unavailable", label: "Unavailable combination message", kind: "text", default: "This combination isn't available" },
  { section: "productPage", key: "product.viewLabel", label: "View-product link text", kind: "text", default: "View product" },
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
