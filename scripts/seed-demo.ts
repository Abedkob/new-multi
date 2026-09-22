/**
 * Creates (or refreshes) a demo store with placeholder content for EVERY content key, a
 * nested category tree, products with variants (different attribute sets per product) and
 * all four optional sections switched on, for evaluating the templates (pnpm demo:seed).
 *
 * The owner account is only created the first time, with a random one-time password
 * printed to this terminal. Nothing is hardcoded. The reviews below are made-up sample
 * text for this fake store, not real customer feedback.
 */
import "dotenv/config";
import "./_owner";
import { prisma } from "../lib/prisma";
import { CONTENT_KEY_NAMES } from "../lib/content";
import { createCategory } from "../lib/data/categories";
import { saveContent } from "../lib/data/content";
import { placeOrder, updateOrderStatus } from "../lib/data/orders";
import { createProduct, updateProduct, type VariantInput } from "../lib/data/products";
import { createStoreWithOwner } from "../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { slugify } from "../lib/slug";
import { attributeSignature, parseAttributes } from "../lib/variants";

const STORE_NAME = "Demo Boutique";
const OWNER_EMAIL = "demo-owner@example.test";

const CONTENT: Record<string, string> = {
  "announcement.text": "Free shipping on orders over $75",
  "navbar.shopLabel": "Shop",

  "hero.headline": "Considered goods for everyday living",
  "hero.subtext":
    "Small-batch clothing, ceramics and carry goods, made to be used and kept.",
  "hero.ctaLabel": "Shop the collection",
  "hero.image": "/demo/hero.svg",

  // Category tiles are the store's real top-level categories (see CATEGORIES below).
  "featuredCategories.heading": "Shop by category",

  "newArrivals.heading": "New arrivals",
  "newArrivals.empty": "No products yet. Check back soon.",

  "bestSellers.heading": "Customer favourites",
  "bestSellers.empty": "Our best sellers will appear here soon.",

  "promoBanner.heading": "The autumn edit: 15% off throws and knitwear",
  "promoBanner.subtext": "Sample offer for the demo store. Ends when the leaves do.",
  "promoBanner.ctaLabel": "Shop the edit",

  "brandStory.heading": "Made slowly, kept for years",
  "brandStory.body":
    "Demo Boutique started as a shelf of things we could not find anywhere else: a linen shirt that softens with every wash, a mug that feels good in the hand.\n\nEverything we sell is made in small runs by people we know, and built to last long enough to be handed down.",
  "brandStory.image": "/demo/blanket.svg",

  "reviews.heading": "What customers say",
  "reviews.item1.quote":
    "The overshirt is the most-worn thing in my wardrobe. Soft from day one.",
  "reviews.item1.author": "Sample customer, London",
  "reviews.item2.quote":
    "Beautifully packed, and the pour-over set makes a genuinely better coffee.",
  "reviews.item2.author": "Sample customer, Leeds",
  "reviews.item3.quote": "Sturdy, handsome and it smells like a proper workshop.",
  "reviews.item3.author": "Sample customer, Bristol",

  "instagram.heading": "Follow along",
  "instagram.handle": "@yourstore.demo",
  "instagram.image1": "/demo/lamp.svg",
  "instagram.image2": "/demo/blanket.svg",

  "footer.about":
    "Demo Boutique is a sample store used to preview storefront templates. Everything here is placeholder content.",
  "footer.copyright": "© {year} {store}. All rights reserved.",

  // Content pages. Shipping is intentionally left empty so it is neither linked nor reachable.
  "about.title": "About us",
  "about.body":
    "Demo Boutique is a made-up store used to try out this platform.\n\nWe pretend to make small-batch clothing, ceramics and carry goods, and we pretend to care about them very much.",
  "contact.title": "Contact",
  "contact.body":
    "Email: hello@demo-boutique.example\nPhone: +1 555 010 0199\n\nWe reply within one working day. This is placeholder contact information for the demo store.",
  "faq.title": "FAQ",
  "faq.body":
    "Do you deliver everywhere?\nWe deliver to a handful of pretend cities. This is a demo.\n\nHow do I pay?\nCash on delivery: you pay the courier when your order arrives.\n\nCan I change my order?\nCall us soon after ordering and we will confirm the details.",
  "shipping.body": "",

  "search.placeholder": "Search products",
};

/** name, parent name (or null). Parents must come first. Men > Shoes > Runners is 3 levels deep. */
const CATEGORIES: { name: string; parent: string | null }[] = [
  { name: "Men", parent: null },
  { name: "Shirts", parent: "Men" },
  { name: "Shoes", parent: "Men" },
  { name: "Runners", parent: "Shoes" },
  { name: "Homeware", parent: null },
  { name: "Kitchen", parent: "Homeware" },
  { name: "Bags", parent: null },
];

type V = { attrs: Record<string, string>; stock: number; price?: number; image?: string };
const PRODUCTS: {
  name: string;
  description: string;
  price: number;
  image: string;
  best: boolean;
  category: string;
  variants: V[];
}[] = [
  {
    name: "Linen Overshirt",
    description:
      "A relaxed, garment-washed linen overshirt with a soft collar and two chest pockets. Gets better with every wash.\n\nOne size runs true; model wears a medium.",
    price: 8900,
    image: "/demo/overshirt.svg",
    best: true,
    category: "Shirts",
    // size + color
    variants: [
      { attrs: { size: "S", color: "Sand" }, stock: 5 },
      { attrs: { size: "M", color: "Sand" }, stock: 6 },
      { attrs: { size: "L", color: "Sand" }, stock: 0 },
      { attrs: { size: "M", color: "Sage" }, stock: 4, price: 9400 },
    ],
  },
  {
    name: "Stoneware Pour-Over Set",
    description:
      "Hand-thrown stoneware dripper and server in a matte glaze. Brews a clean, bright cup and stacks away neatly.",
    price: 6450,
    image: "/demo/pourover.svg",
    best: false,
    category: "Kitchen",
    // just size
    variants: [
      { attrs: { size: "2-cup" }, stock: 6 },
      { attrs: { size: "4-cup" }, stock: 4, price: 7450 },
    ],
  },
  {
    name: "Waxed Canvas Weekender",
    description:
      "Roomy waxed-canvas duffel with leather-wrapped handles and a brass buckle. Built for the long weekend and everything after.",
    price: 14800,
    image: "/demo/weekender.svg",
    best: true,
    category: "Bags",
    // no real variation: one default variant, sold out
    variants: [{ attrs: {}, stock: 0 }],
  },
  {
    name: "Wool Throw Blanket",
    description:
      "A heavyweight brushed-wool throw in a warm terracotta stripe, finished with hand-knotted fringe.",
    price: 11800,
    image: "/demo/blanket.svg",
    best: true,
    category: "Homeware",
    // just color
    variants: [
      { attrs: { color: "Terracotta" }, stock: 9 },
      { attrs: { color: "Oat" }, stock: 0 },
    ],
  },
  {
    name: "Ceramic Table Lamp",
    description:
      "A glazed ceramic base with a linen shade. Casts a warm, low light that suits a reading corner.",
    price: 9600,
    image: "/demo/lamp.svg",
    best: false,
    category: "Homeware",
    // material + size
    variants: [
      { attrs: { material: "Ceramic", size: "Small" }, stock: 4 },
      { attrs: { material: "Ceramic", size: "Large" }, stock: 2, price: 12800 },
    ],
  },
  {
    name: "Trail Runner Sneaker",
    description:
      "A lightweight everyday runner with a grippy sole and a breathable knit upper. Sample product for the demo store.",
    price: 12900,
    image: "/demo/sneaker.svg",
    best: false,
    category: "Runners",
    // size only, different values per variant
    variants: [
      { attrs: { size: "40" }, stock: 3 },
      { attrs: { size: "41" }, stock: 5 },
      { attrs: { size: "42" }, stock: 0 },
      { attrs: { size: "43" }, stock: 2 },
    ],
  },
];

async function main() {
  let tenant = await prisma.tenant.findUnique({
    where: { slug: slugify(STORE_NAME) },
  });

  if (!tenant) {
    const password = generateTempPassword();
    const created = await createStoreWithOwner({
      storeName: STORE_NAME,
      ownerName: "Demo Owner",
      ownerEmail: OWNER_EMAIL,
      passwordHash: await hashPassword(password),
    });
    tenant = created.tenant;
    console.log(`Created store /store/${tenant.slug}`);
    console.log(`Owner login: ${OWNER_EMAIL} / ${password}  (shown once)`);
  } else {
    console.log(`Refreshing existing store /store/${tenant.slug}`);
  }
  const tenantId = tenant.id;

  for (const key of Object.keys(CONTENT)) {
    if (!CONTENT_KEY_NAMES.includes(key)) throw new Error(`Unknown content key: ${key}`);
  }
  await saveContent(
    tenantId,
    Object.entries(CONTENT).map(([key, value]) => ({ key, value })),
  );
  // Drop rows from older key lists that no template reads any more.
  const removed = await prisma.tenantContent.deleteMany({
    where: { tenantId, key: { notIn: CONTENT_KEY_NAMES } },
  });

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      sectionVisibility: {
        announcementBar: true,
        promoBanner: true,
        brandStory: true,
        reviews: true,
      },
    },
  });

  // Categories: create any that are missing (matched by name + parent), keep existing ones.
  const ids = new Map<string, string>();
  for (const c of CATEGORIES) {
    const parentId = c.parent ? ids.get(c.parent)! : null;
    const existing = await prisma.category.findFirst({
      where: { tenantId, name: c.name, parentId },
    });
    const row = existing ?? (await createCategory(tenantId, { name: c.name, parentId }));
    ids.set(c.name, row.id);
  }

  // Products: create or update in place, keeping variant ids stable across re-seeds.
  for (const p of PRODUCTS) {
    const slug = slugify(p.name);
    const existing = await prisma.product.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      include: { variants: true },
    });
    const oldBySig = new Map(
      (existing?.variants ?? []).map((v) => [attributeSignature(parseAttributes(v.attributes)), v.id]),
    );
    const variants: VariantInput[] = p.variants.map((v) => ({
      id: oldBySig.get(attributeSignature(v.attrs)),
      attributes: v.attrs,
      stock: v.stock,
      priceCentsOverride: v.price ?? null,
      imageUrl: v.image ?? null,
    }));
    const input = {
      name: p.name,
      description: p.description,
      basePriceCents: p.price,
      imageUrl: p.image,
      images: [],
      isBestSeller: p.best,
      categoryId: ids.get(p.category)!,
      variants,
    };
    if (existing) await updateProduct(tenantId, existing.id, input);
    else await createProduct(tenantId, input);
  }

  // Sample orders. Stock was just reset by the product updates above, so clear old orders and
  // place fresh ones through the real checkout logic (which deducts stock).
  await prisma.order.deleteMany({ where: { tenantId } });
  const variantFor = async (productName: string, attrs: Record<string, string>) => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { tenantId_slug: { tenantId, slug: slugify(productName) } },
      include: { variants: true },
    });
    const sig = attributeSignature(attrs);
    return product.variants.find((v) => attributeSignature(parseAttributes(v.attributes)) === sig)!.id;
  };
  const first = await placeOrder(
    tenantId,
    {
      customerName: "Sample Customer",
      customerPhone: "+1 555 010 0142",
      customerAddress: "42 Example Street, Sampletown",
      deliveryLocation: "https://maps.example.com/?q=42+Example+Street",
      notes: "Please call before delivering. (Sample order.)",
    },
    [
      { variantId: await variantFor("Linen Overshirt", { size: "M", color: "Sand" }), quantity: 1 },
      { variantId: await variantFor("Stoneware Pour-Over Set", { size: "2-cup" }), quantity: 1 },
    ],
  );
  await updateOrderStatus(tenantId, first.id, "CONFIRMED");
  await placeOrder(
    tenantId,
    {
      customerName: "Another Sample",
      customerPhone: "+1 555 010 0177",
      customerAddress: "7 Placeholder Road, Demoville",
      deliveryLocation: "Blue gate next to the bakery",
      notes: "",
    },
    [{ variantId: await variantFor("Wool Throw Blanket", { color: "Terracotta" }), quantity: 2 }],
  );

  console.log(
    `Seeded ${Object.keys(CONTENT).length} content keys, ${CATEGORIES.length} categories, ` +
      `${PRODUCTS.length} products with ${PRODUCTS.reduce((n, p) => n + p.variants.length, 0)} variants, ` +
      `2 sample orders, all optional sections on` +
      (removed.count ? `, removed ${removed.count} obsolete keys.` : "."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
