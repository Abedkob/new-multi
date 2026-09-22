/** Real-browser check of shop / category / search / content pages (pnpm e2e:pages). */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { saveContent } from "../../lib/data/content";
import { createProduct } from "../../lib/data/products";
import { setTenantTemplate } from "../../lib/data/theme";
import { TEMPLATE_IDS } from "../../templates/meta";
import { BASE, launch, makeStore } from "./browser";

const variant = (stock = 5) => [{ attributes: {}, stock, priceCentsOverride: null, imageUrl: null }];
const mk = (tenantId: string, name: string, categoryId: string | null, description = "") =>
  createProduct(tenantId, {
    name,
    description,
    basePriceCents: 1000,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId,
    variants: variant(),
  });

async function main() {
  const store = await makeStore("Pages UI");
  const other = await makeStore("Pages Other");
  const T = store.tenant.id;
  const slug = store.tenant.slug;
  const men = await createCategory(T, { name: "Men", parentId: null });
  const shoes = await createCategory(T, { name: "Shoes", parentId: men.id });
  const nike = await createCategory(T, { name: "Nike", parentId: shoes.id });
  const home = await createCategory(T, { name: "Homeware", parentId: null });

  // 13 products: pagination (12 per page) + a category tree with products at every level.
  await mk(T, "Cotton Shirt", men.id, "Soft cotton");
  await mk(T, "Leather Boot", shoes.id);
  await mk(T, "Nike Runner", nike.id, "Fast RUNNING shoe");
  await mk(T, "Nike Trainer", nike.id);
  await mk(T, "Ceramic Bowl", home.id, "Handmade bowl");
  await mk(T, "Loose Item", null);
  for (let i = 1; i <= 7; i++) await mk(T, `Filler ${String(i).padStart(2, "0")}`, home.id);
  // Another store with the same words must never leak into this store's results.
  await mk(other.tenant.id, "Nike Runner Other Store", null);
  await createCategory(other.tenant.id, { name: "Secret", parentId: null });

  const { browser, context } = await launch();
  const page = await context.newPage();
  let n = 0;
  const ok = (m: string) => console.log(`  ok  ${++n} ${m}`);
  const productLinks = async () =>
    (await page.locator('[data-testid="catalog-page"] a[href*="/products/"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("/products/")[1]))])).sort();
  const go = (path: string) => page.goto(`${BASE}/store/${slug}${path}`);

  try {
    // ---------- shop + pagination
    await go("/shop");
    assert.equal(await page.locator('[data-testid="result-count"]').innerText(), "13 products");
    assert.equal((await productLinks()).length, 12);
    assert.match(await page.locator('[data-testid="pagination"]').innerText(), /Page 1 of 2/);
    await Promise.all([page.waitForURL(/page=2/), page.locator('[data-testid="pagination"] a[rel="next"]').click()]);
    assert.equal((await productLinks()).length, 1);
    assert.match(await page.locator('[data-testid="pagination"]').innerText(), /Page 2 of 2/);
    await page.locator('[data-testid="pagination"] a[rel="prev"]').click();
    await page.waitForURL(/\/shop$/);
    ok("shop lists every product, 12 per page, with working previous/next");

    // ---------- categories include subcategories
    await go("/category/men");
    assert.deepEqual(await productLinks(), ["cotton-shirt", "leather-boot", "nike-runner", "nike-trainer"]);
    assert.equal(await page.locator('[data-testid="result-count"]').innerText(), "4 products");
    assert.deepEqual(await page.locator('[data-testid="category-chips"] a').allInnerTexts(), ["Shoes"]);
    await go("/category/shoes");
    assert.deepEqual(await productLinks(), ["leather-boot", "nike-runner", "nike-trainer"]);
    await go("/category/nike");
    assert.deepEqual(await productLinks(), ["nike-runner", "nike-trainer"]);
    const crumbs = (await page.locator('nav[aria-label="Breadcrumb"]').innerText()).replace(/\s+/g, " ");
    assert.match(crumbs, /Shop\/Men\/Shoes\/Nike$/);
    await go("/category/homeware");
    assert.equal((await productLinks()).length, 8);
    ok("a category shows its own products plus everything in its subcategories (Men > Shoes > Nike)");

    // clicking a subcategory chip navigates down the tree
    await go("/category/men");
    await Promise.all([page.waitForURL(/category\/shoes/), page.locator('[data-testid="category-chips"] a', { hasText: "Shoes" }).click()]);
    ok("subcategory chips navigate down the tree");

    // ---------- search
    await go("/search?q=NIKE");
    assert.deepEqual(await productLinks(), ["nike-runner", "nike-trainer"]);
    await go("/search?q=running");
    assert.deepEqual(await productLinks(), ["nike-runner"]); // matched on description, case-insensitively
    await go("/search?q=zzzz");
    assert.match(await page.locator('[data-testid="catalog-empty"]').innerText(), /No products match "zzzz"/);
    assert.equal(await page.locator('[data-testid="result-count"]').innerText(), "0 products");
    await go("/search?q=other%20store");
    assert.equal((await productLinks()).length, 0, "another store's product leaked into search");
    ok("search matches name or description case-insensitively, shows a no-results message, and never crosses stores");

    // ---------- category of another store
    const secret = await prisma.category.findFirstOrThrow({ where: { tenantId: other.tenant.id, name: "Secret" } });
    assert.equal((await go(`/category/${secret.slug}`))?.status(), 404);
    assert.equal((await go("/category/does-not-exist"))?.status(), 404);
    ok("another store's category slug is a 404");

    // ---------- content pages: only linked and reachable when they have text
    await saveContent(T, [
      { key: "about.body", value: "First paragraph.\n\nSecond paragraph." },
      { key: "faq.title", value: "Questions" },
      { key: "faq.body", value: "Q: Why?\nA: Because." },
    ]);
    for (const id of TEMPLATE_IDS) {
      await setTenantTemplate(T, id);
      await go("");
      const links = await page.locator('header a[href*="/about"], header a[href*="/faq"], header a[href*="/contact"], header a[href*="/shipping"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split(/\/store\/[^/]+/)[1]));
      assert.deepEqual([...new Set(links)].sort(), ["/about", "/faq"], `${id}: navbar page links`);
      const footerLinks = await page.locator('footer a[href*="/about"], footer a[href*="/faq"], footer a[href*="/contact"], footer a[href*="/shipping"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split(/\/store\/[^/]+/)[1]));
      assert.deepEqual([...new Set(footerLinks)].sort(), ["/about", "/faq"], `${id}: footer page links`);
      assert.equal(await page.locator('header a', { hasText: "Questions" }).count() > 0, true, `${id}: custom page title used as link text`);
    }
    await go("/about");
    assert.equal(await page.locator('[data-testid="content-page"] p').count(), 2);
    assert.equal(await page.locator('[data-testid="content-page"] h1').innerText(), "About us");
    assert.equal((await go("/contact"))?.status(), 404);
    assert.equal((await go("/shipping"))?.status(), 404);
    ok("About/FAQ pages render and are linked in navbar+footer in every template; empty Contact/Shipping are neither linked nor reachable");

    await saveContent(T, [{ key: "shipping.body", value: "We ship in 3 days." }]);
    await go("/shipping");
    assert.match(await page.locator('[data-testid="content-page"]').innerText(), /We ship in 3 days\./);
    await go("");
    assert.ok((await page.locator('header a[href$="/shipping"]').count()) > 0);
    ok("writing text for a page makes it appear (and get linked) immediately");

    // ---------- navbar search box + cart link + real category navigation, per template
    for (const id of TEMPLATE_IDS) {
      await setTenantTemplate(T, id);
      await go("");
      assert.equal(await page.locator('[data-testid="cart-count"]').first().innerText(), "(0)", `${id}: cart link`);
      const box = page.locator('header input[type="search"]').first();
      await box.fill("shirt");
      await Promise.all([page.waitForURL(/\/search\?q=shirt/), box.press("Enter")]);
      assert.deepEqual(await productLinks(), ["cotton-shirt"], `${id}: navbar search`);
      // featured category tiles/links are real category pages
      await go("");
      const tile = page.locator(`a[href$="/category/men"]`).first();
      await Promise.all([page.waitForURL(/category\/men/), tile.click()]);
    }
    ok("every template: navbar search works, cart link shows (0), category links go to real category pages");
  } finally {
    await browser.close();
    await store.remove();
    await other.remove();
  }
  console.log(`\nAll ${n} storefront page checks passed.`);
}

main()
  .catch((e) => {
    console.error("\nE2E FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
