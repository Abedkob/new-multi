/**
 * Every admin and console screen, at a phone, measured (pnpm verify:admin-layout).
 *
 * ADMIN_UI.md §11 has said "every screen is usable at phone width with no horizontal page scroll"
 * since it was written, and `verify:admin-ui` cannot check it: that suite reads class names, and
 * every class involved in breaking this rule was a reasonable one. So the rule was being asserted
 * rather than checked, and it was false nearly everywhere — measured at 375px before this suite
 * existed, `/admin/products` laid out a **984px** document, `/admin/orders` 538px and the
 * dashboard 412px. The whole page scrolled sideways instead of the table inside it.
 *
 * Three causes, all the same shape — an item whose intrinsic minimum nobody had capped:
 *
 *   - A panel is a grid item, and a grid item's `min-width` is `auto`, so a panel holding a table
 *     grew to the table's natural width and the table's own `overflow-x-auto` never fired.
 *   - `min-w-0 flex-1 truncate` does not stop an unbreakable string (a store URL) contributing
 *     its full width; `w-0 flex-1` does.
 *   - A 28px page title does not fit a 375px screen.
 *
 * What this asserts, per route: the document is no wider than the viewport. That is the whole
 * rule, and it is the one a merchant feels — a page that slides under their thumb while they are
 * trying to scroll it.
 *
 * It also reports, without failing, any element whose own content overflows its box. A table
 * inside `overflow-x-auto` is *supposed* to do that, so it cannot be an assertion; but it is
 * exactly where to look when a route does fail.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";

import { createProduct } from "../lib/data/products";
import { setTenantStock, setTenantCounterSales } from "../lib/data/tenants";
import { prisma } from "../lib/prisma";
import { BASE, launch, login, makeStore } from "./e2e/browser";

/** 375x812 is the iPhone SE/13 mini class — the narrowest phone worth supporting. */
const PHONE = { width: 375, height: 812 };

/** Routes a store with both modules on and one product can actually open. */
const ADMIN_ROUTES = [
  "/admin",
  "/admin/orders",
  "/admin/products",
  "/admin/products/new",
  "/admin/products/import",
  "/admin/categories",
  "/admin/categories/new",
  "/admin/discounts",
  "/admin/discounts/new",
  "/admin/discounts/coupons",
  "/admin/stock",
  "/admin/stock/receive",
  "/admin/stock/count",
  "/admin/stock/history",
  "/admin/stock/import",
  "/admin/counter",
  "/admin/counter/new",
  "/admin/content",
  "/admin/delivery",
  "/admin/social-links",
  "/admin/analytics",
  "/admin/analytics/products",
  "/admin/analytics/funnel",
  "/admin/analytics/searches",
  "/admin/marketing",
  "/admin/marketing/links",
  "/admin/marketing/integrations",
  "/admin/notifications",
  "/admin/staff",
  "/admin/change-password",
];

async function main() {
  const store = await makeStore("Layout");
  const T = store.tenant.id;
  const { browser, context } = await launch();
  let checks = 0;
  let failures = 0;

  try {
    await setTenantStock(T, store.user.id);
    await setTenantCounterSales(T, store.user.id);
    // One product, so the list screens are not all empty states — an EmptyState is narrow and
    // would hide exactly the overflow this suite exists to find.
    await createProduct(
      T,
      {
        name: "Layout Probe Jacket",
        description: "A product long enough to make a list row do some work.",
        basePriceCents: 12_900,
        // `ProductInput.imageUrl` is `string`, not `string | null`. Passing null makes Prisma
        // reject the unchecked create input and fall back to the checked one, which has no
        // `tenantId` — so it reports "Argument `tenant` is missing", naming a field that was
        // never the problem.
        imageUrl: "/layout-probe.svg",
        images: [{ url: "/layout-probe.svg" }],
        isBestSeller: false,
        categoryId: null,
        variants: [
          { attributes: { Size: "M" }, stock: 5, priceCentsOverride: null, imageUrl: null },
          { attributes: { Size: "L" }, stock: 2, priceCentsOverride: null, imageUrl: null },
        ],
      },
      { userId: store.user.id, name: "Layout" },
    );

    const page = await context.newPage();
    await page.setViewportSize(PHONE);
    await login(page, store.user.email, store.password);

    console.log(`Every admin screen at ${PHONE.width}x${PHONE.height}:\n`);

    for (const route of ADMIN_ROUTES) {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      if (status === 404) {
        // A route this store cannot open is not this suite's business — but say so, rather than
        // passing silently, or a typo'd path would read as a clean screen for ever.
        console.log(`  --  ${route} answered 404 for this store, not measured`);
        continue;
      }

      const measured = await page.evaluate(() => {
        const d = document.documentElement;
        const culprits = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
          .slice(0, 3)
          .map((e) => `${e.tagName.toLowerCase()}.${(e.className + "").split(/\s+/)[0] || "?"}` +
            ` (${e.clientWidth}->${e.scrollWidth})`);
        return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, culprits };
      });

      checks++;
      const over = measured.scrollWidth - measured.clientWidth;
      if (over > 1) {
        failures++;
        console.log(
          `  FAIL ${route}  document is ${measured.scrollWidth}px in a ${measured.clientWidth}px ` +
            `viewport (+${over})\n       widest: ${measured.culprits.join(", ") || "(none found)"}`,
        );
      } else {
        // An inner scroller is fine and expected — a table is meant to scroll inside its panel.
        const inner = measured.culprits.length ? `  [inner scroll: ${measured.culprits.length}]` : "";
        console.log(`  ok   ${route}${inner}`);
      }
    }

    console.log(
      `\n${checks} screens measured, ${failures} wider than the phone.` +
        (failures ? "\nADMIN_UI.md §11: a page must not scroll sideways; the table inside it may." : ""),
    );
    assert.equal(failures, 0, `${failures} screen(s) scroll horizontally at ${PHONE.width}px`);
  } finally {
    await browser.close();
    await store.remove();
  }
}

main()
  .catch((error) => {
    console.error("\nADMIN LAYOUT CHECK FAILED\n", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
