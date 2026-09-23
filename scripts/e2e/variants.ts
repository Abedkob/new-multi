/** Real-browser check of product variants: admin form + storefront picker (pnpm e2e:variants). */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { BASE, launch, login, makeStore } from "./browser";

async function main() {
  const store = await makeStore("Variants UI");
  const T = store.tenant.id;
  const men = await createCategory(T, { name: "Men", parentId: null });
  const shoes = await createCategory(T, { name: "Shoes", parentId: men.id });
  await createCategory(T, { name: "Nike", parentId: shoes.id });
  await createCategory(T, { name: "Homeware", parentId: null });

  const { browser, context } = await launch();
  const page = await context.newPage();
  let n = 0;
  const ok = (m: string) => console.log(`  ok  ${++n} ${m}`);

  const row = (p: Page, i: number) => p.locator(`[data-variant-row="${i}"]`);
  const fillAttr = async (p: Page, i: number, a: number, k: string, v: string) => {
    await p.fill(`[aria-label="Variant ${i + 1} attribute name ${a + 1}"]`, k);
    await p.fill(`[aria-label="Variant ${i + 1} attribute value ${a + 1}"]`, v);
  };

  try {
    await login(page, store.user.email, store.password);

    // ---- Product 1: size only, three variants, a price override, nested category
    await page.goto(`${BASE}/admin/products/new`);
    await page.fill("#name", "E2E Sneaker");
    await page.fill("#price", "100");
    await page.fill("#imageUrl", "/demo/lamp.svg");

    await page.click("#category");
    await page.fill('[aria-label="Search categories"]', "nik");
    const hits = await page.locator('[role="option"]').allTextContents();
    assert.deepEqual(hits.map((h) => h.trim()), ["No category", "Men / Shoes / Nike"]);
    await page.click('[role="option"]:has-text("Men / Shoes / Nike")');
    assert.match(await page.locator("#category").innerText(), /Men \/ Shoes \/ Nike/);
    ok("category picker is searchable and shows the nested path");

    await row(page, 0).getByRole("button", { name: "Add attribute" }).click();
    await fillAttr(page, 0, 0, "size", "40");
    await page.fill('[aria-label="Variant 1 stock"]', "3");

    await page.getByRole("button", { name: "Add variant" }).click();
    // The new row starts with the same attribute names (blank values) as the first.
    assert.equal(await page.inputValue('[aria-label="Variant 2 attribute name 1"]'), "size");
    await page.fill('[aria-label="Variant 2 attribute value 1"]', "41");
    await page.fill('[aria-label="Variant 2 stock"]', "0");
    await page.fill('[aria-label="Variant 2 price override"]', "120");
    await page.fill('[aria-label="Variant 2 image override"]', "/demo/sneaker.svg");

    await page.getByRole("button", { name: "Add variant" }).click();
    await page.fill('[aria-label="Variant 3 attribute value 1"]', "42");
    await page.fill('[aria-label="Variant 3 stock"]', "2");

    // Validation: make variant 3 identical to variant 1, expect a clear per-row error.
    await page.fill('[aria-label="Variant 3 attribute value 1"]', "40");
    await page.getByRole("button", { name: "Create product" }).click();
    await row(page, 2).getByText(/Same attributes as variant 1/).waitFor();
    assert.equal(page.url(), `${BASE}/admin/products/new`);
    ok("duplicate variants are rejected with an error on the offending row (nothing saved)");
    assert.equal(await prisma.product.count({ where: { tenantId: T } }), 0);

    await page.fill('[aria-label="Variant 3 attribute value 1"]', "42");
    await Promise.all([page.waitForURL(`${BASE}/admin/products`), page.getByRole("button", { name: "Create product" }).click()]);
    const line = page.locator("tbody tr", { hasText: "E2E Sneaker" });
    const cells = (await line.locator("td").allTextContents()).map((c) => c.replace(/\s+/g, " ").trim());
    assert.equal(cells[1], "Nike");
    assert.equal(cells[2], "$100.00 - $120.00");
    assert.match(cells[0], /3 options/);
    assert.match(cells[3], /^5 in stock/);
    ok("product created: category, price range, 3 variants, total stock 5 in the list");

    // ---- Product 2: two attributes (size + color) created through the UI as well
    await page.goto(`${BASE}/admin/products/new`);
    await page.fill("#name", "E2E Tee");
    await page.fill("#price", "25");
    await row(page, 0).getByRole("button", { name: "Add attribute" }).click();
    await row(page, 0).getByRole("button", { name: "Add attribute" }).click();
    await fillAttr(page, 0, 0, "size", "M");
    await fillAttr(page, 0, 1, "color", "White");
    await page.fill('[aria-label="Variant 1 stock"]', "4");
    await page.getByRole("button", { name: "Add variant" }).click();
    assert.equal(await page.inputValue('[aria-label="Variant 2 attribute name 2"]'), "color");
    await page.fill('[aria-label="Variant 2 attribute value 1"]', "L");
    await page.fill('[aria-label="Variant 2 attribute value 2"]', "Black");
    await page.fill('[aria-label="Variant 2 stock"]', "1");
    await Promise.all([page.waitForURL(`${BASE}/admin/products`), page.getByRole("button", { name: "Create product" }).click()]);
    ok("a second product with different attribute names (size + color) saved");

    // ---- Edit: values load back, removing a variant works, ids are preserved
    const sneaker = await prisma.product.findFirstOrThrow({ where: { tenantId: T, name: "E2E Sneaker" }, include: { variants: true } });
    await page.goto(`${BASE}/admin/products/${sneaker.id}/edit`);
    assert.equal(await page.inputValue('[aria-label="Variant 2 price override"]'), "120.00");
    assert.equal(await page.inputValue("#price"), "100.00");
    await row(page, 2).getByRole("button", { name: "Remove", exact: true }).click();
    await Promise.all([page.waitForURL(`${BASE}/admin/products`), page.getByRole("button", { name: "Save changes" }).click()]);
    const after = await prisma.productVariant.findMany({ where: { productId: sneaker.id } });
    assert.equal(after.length, 2);
    assert.deepEqual(after.map((v) => v.id).sort(), sneaker.variants.filter((v) => (v.attributes as { size: string }).size !== "42").map((v) => v.id).sort());
    ok("editing loads saved values; removing a variant keeps the other variants' ids");
    // put it back for the storefront checks
    await page.goto(`${BASE}/admin/products/${sneaker.id}/edit`);
    await page.getByRole("button", { name: "Add variant" }).click();
    await page.fill('[aria-label="Variant 3 attribute value 1"]', "42");
    await page.fill('[aria-label="Variant 3 stock"]', "2");
    await Promise.all([page.waitForURL(`${BASE}/admin/products`), page.getByRole("button", { name: "Save changes" }).click()]);

    // ---- Storefront picker
    const slug = store.tenant.slug;
    await page.goto(`${BASE}/store/${slug}/products/e2e-sneaker`);
    const status = () => page.locator('[data-testid="stock-status"]').first().innerText();
    const price = () => page.locator('[data-testid="product-price"]').first().innerText();
    const image = () => page.locator("main img").first().getAttribute("src");
    assert.equal(await status(), "Select options");
    assert.equal(await price(), "From $100.00");
    assert.equal(await image(), "/demo/lamp.svg");
    ok("before choosing: 'Select options', 'From' price and the product image");

    await page.click('[data-option="size:41"]');
    assert.equal(await status(), "Out of stock");
    assert.equal(await price(), "$120.00");
    assert.equal(await image(), "/demo/sneaker.svg");
    ok("variant 41 (override price + image, stock 0): price, image and 'Out of stock' follow the variant");

    await page.click('[data-option="size:40"]');
    assert.equal(await status(), "In stock");
    assert.equal(await price(), "$100.00");
    assert.equal(await image(), "/demo/lamp.svg");
    ok("variant 40: in stock, base price and the product image again");
    assert.equal(await page.locator('[data-option="size:41"]').getAttribute("data-available"), "false");
    ok("the sold-out option is flagged unavailable");

    await page.goto(`${BASE}/store/${slug}/products/e2e-tee`);
    const keys = await page.locator("[data-testid=variant-picker] legend").allInnerTexts();
    assert.deepEqual(keys.map((k) => k.split("\n")[0].trim().toLowerCase()), ["size", "color"]);
    await page.click('[data-option="size:M"]');
    assert.equal(await status(), "Select options"); // color still missing
    await page.click('[data-option="color:Black"]'); // M + Black does not exist
    assert.equal(await status(), "This combination isn't available");
    await page.click('[data-option="color:White"]');
    assert.equal(await status(), "In stock");
    assert.equal(await price(), "$25.00");
    ok("size + color product: needs both choices, and unavailable combinations are reported");
  } finally {
    await browser.close();
    await store.remove();
  }
  console.log(`\nAll ${n} variant UI checks passed.`);
}

main()
  .catch((e) => {
    console.error("\nE2E FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
