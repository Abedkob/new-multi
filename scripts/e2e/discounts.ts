/** Browser coverage for the owner discount workflow and shopper-facing sale prices. */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { createProduct } from "../../lib/data/products";
import { BASE, launch, login, makeStore } from "./browser";
import { assertDevOriginAllowed, onCustomDomain } from "./custom-domain";

const variant = (priceCentsOverride: number | null = null) => [{
  attributes: {},
  stock: 10,
  priceCentsOverride,
  imageUrl: null,
}];

async function main() {
  const store = await makeStore("Discounts UI");
  const product = await createProduct(store.tenant.id, {
    name: "Sale Tee",
    description: "A product used to verify automatic discounts.",
    basePriceCents: 10000,
    imageUrl: "/demo/overshirt.svg",
    images: [],
    isBestSeller: false,
    categoryId: null,
    variants: variant(),
  });
  await createProduct(store.tenant.id, {
    name: "Regular Hat",
    description: "Not assigned to the campaign.",
    basePriceCents: 2500,
    imageUrl: "/demo/cap.svg",
    images: [],
    isBestSeller: false,
    categoryId: null,
    variants: variant(),
  });

  const { browser, context } = await launch();
  const page = await context.newPage();
  let passed = 0;
  const ok = (message: string) => console.log(`  ok  ${++passed} ${message}`);

  try {
    await login(page, store.user.email, store.password);
    await page.goto(`${BASE}/admin/discounts`);
    await page.getByText("No discounts yet.").waitFor();
    await page.getByRole("link", { name: "New discount" }).first().click();
    await page.fill("#discount-name", "Launch offer");
    await page.fill("#discount-value", "20");
    await page.getByRole("switch", { name: "Enable discount" }).click();
    await Promise.all([
      page.waitForURL(/\/admin\/discounts\/[^/]+\/edit\?section=products$/),
      page.getByRole("button", { name: "Create discount" }).click(),
    ]);
    assert.equal(await page.getByRole("button", { name: /^Save/ }).count(), 1);
    ok("owner creates and enables a percentage discount");

    const saleRow = page.locator("label", { hasText: "Sale Tee" });
    assert.match((await saleRow.innerText()).replace(/\s+/g, " "), /\$100\.00 Select to apply discount/);
    await saleRow.locator('input[type="checkbox"]').check();
    assert.match((await saleRow.innerText()).replace(/\s+/g, " "), /\$100\.00 \$80\.00/);
    await page.getByRole("button", { name: "Save product selection" }).click();
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await saleRow.locator('input[type="checkbox"]').isChecked(), true);
    if (process.env.DISCOUNT_DESKTOP_SCREENSHOT) {
      await page.screenshot({ path: process.env.DISCOUNT_DESKTOP_SCREENSHOT, fullPage: true });
    }
    ok("paginated product assignment previews and saves the discounted price");

    await page.goto(`${BASE}/admin/products`);
    const adminRow = page.locator("tbody tr", { hasText: "Sale Tee" });
    // Wait for the badge rather than reading the row the moment it exists: saving the
    // assignment revalidates this page, and sampling it mid-revalidation showed the plain
    // price once — a flake that would have been read as "discounts are broken".
    await adminRow.getByText("Discounted").waitFor();
    assert.match((await adminRow.innerText()).replace(/\s+/g, " "), /\$100\.00\s*\$80\.00\s*Discounted/);
    ok("the product list shows regular and discounted prices");

    await page.goto(`${BASE}/store/${store.tenant.slug}/products/${product.slug}`);
    const productPrice = (await page.locator('[data-testid="product-price"]').first().innerText()).replace(/\s+/g, " ");
    assert.match(productPrice, /\$100\.00\s*\$80\.00\s*Sale/);
    await page.locator('[data-testid="add-to-cart-button"]').click();
    await page.locator('[data-testid="cart-link"]').first().click();
    await page.waitForSelector('[data-testid="cart-line"]');
    assert.match((await page.locator('[data-testid="cart-line"]').innerText()).replace(/\s+/g, " "), /\$100\.00\s*\$80\.00\s*Sale/);
    assert.equal(await page.locator('[data-testid="cart-subtotal"]').innerText(), "$80.00");
    if (process.env.DISCOUNT_STOREFRONT_SCREENSHOT) {
      await page.screenshot({ path: process.env.DISCOUNT_STOREFRONT_SCREENSHOT, fullPage: true });
    }
    ok("product detail and cart consistently show and total the sale price");

    // ------------------------------------------------- the sale price, on the store's own domain
    // Mandatory since 2026-11-04 (scripts/e2e/custom-domain.ts): a leg that cannot run FAILS.
    //
    // A discount is resolved on the server from the tenant, and on a custom domain the tenant
    // comes from proxy.ts's host rewrite rather than from a slug in the path. Everything below
    // the price therefore depends on that rewrite having found the right store — which is why
    // this leg does not stop at reading the price off the page, but buys the thing and checks
    // what the order wrote down. A discount that shows and does not charge, or charges and does
    // not show, is money either way.
    const domain = "discounts-e2e.test";
    assertDevOriginAllowed(domain);
    await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain } });
    try {
      await onCustomDomain(domain, async ({ context: domainContext, origin }) => {
        const d = await domainContext.newPage();
        await d.goto(`${origin}/products/${product.slug}`, { waitUntil: "load" });
        const onDomain = (await d.locator('[data-testid="product-price"]').first().innerText()).replace(/\s+/g, " ");
        assert.match(onDomain, /\$100\.00\s*\$80\.00\s*Sale/, `price on ${domain}: ${onDomain}`);

        await d.locator('[data-testid="add-to-cart-button"]').click();
        await d.locator('[data-testid="cart-link"]').first().click();
        // Cart lines are resolved by a Server Action, so the subtotal is $0.00 until it
        // answers: wait for the resolved line price instead of reading the total the instant a
        // line appears. A line can also be withdrawn again (useCartDetails drops anything out
        // of stock), so the notice is checked too — that way a withdrawal fails as a
        // withdrawal rather than as a wrong subtotal.
        const dLine = d.locator('[data-testid="cart-line"]');
        await dLine.getByText("$80.00").first().waitFor();
        assert.equal(await d.locator('[data-testid="cart-removed-notice"]').count(), 0);
        assert.equal(await d.locator('[data-testid="cart-subtotal"]').innerText(), "$80.00");

        await Promise.all([d.waitForURL(/\/checkout$/), d.click('[data-testid="go-to-checkout"]')]);
        await d.waitForSelector("#co-customerName");
        await d.fill("#co-customerName", "Sale Buyer");
        await d.fill("#co-customerPhone", "+1 555 010 0177");
        await d.fill("#co-customerAddress", "9 Discount Road");
        await d.fill("#co-deliveryLocation", "https://maps.example.com/?q=discount");
        assert.equal(await d.locator('[data-testid="checkout-total"]').innerText(), "$80.00");
        await Promise.all([
          d.waitForURL(/order-confirmation\//),
          d.click('[data-testid="place-order"]'),
        ]);
        await d.locator('[data-testid="confirmation-page"]').waitFor();
        const order = await prisma.order.findFirstOrThrow({
          where: { tenantId: store.tenant.id, customerName: "Sale Buyer" },
          include: { items: true },
        });
        assert.equal(
          order.items[0].priceCentsSnapshot,
          8000,
          "the order must be charged the sale price the shopper was shown, not the base price",
        );
        ok(`on ${domain} the sale price is shown, totalled and charged (order snapshot $80.00)`);

        // The product that is not in the campaign must be untouched here too — a host rewrite
        // that resolved the wrong tenant would show a sale on everything or on nothing.
        await d.goto(`${origin}/products/regular-hat`, { waitUntil: "load" });
        const plain = (await d.locator('[data-testid="product-price"]').first().innerText()).replace(/\s+/g, " ");
        assert.equal(plain, "$25.00", `an unassigned product must have no sale price, got ${plain}`);
        ok(`on ${domain} a product outside the campaign keeps its plain price`);
      });
    } finally {
      await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain: null } });
    }

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await login(mobilePage, store.user.email, store.password);
    const discount = await prisma.discountCampaign.findFirstOrThrow({ where: { tenantId: store.tenant.id } });
    await mobilePage.goto(`${BASE}/admin/discounts/${discount.id}/edit`);
    const fit = await mobilePage.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(fit.scrollWidth <= fit.width, `mobile page overflows horizontally: ${JSON.stringify(fit)}`);
    const mobileSave = mobilePage.getByRole("button", { name: "Save changes" });
    await mobileSave.scrollIntoViewIfNeeded();
    assert.ok(await mobileSave.isVisible());
    assert.equal(await mobilePage.getByRole("button", { name: /^Save/ }).count(), 1);
    await mobilePage.getByRole("link", { name: /^Products \(/ }).click();
    await mobilePage.getByRole("button", { name: "Save product selection" }).waitFor();
    assert.equal(await mobilePage.getByRole("button", { name: /^Save/ }).count(), 1);
    if (process.env.DISCOUNT_SCREENSHOT) {
      await mobilePage.screenshot({ path: process.env.DISCOUNT_SCREENSHOT, fullPage: true });
    }
    await mobilePage.goto(`${BASE}/admin/discounts`);
    assert.ok(await mobilePage.getByRole("article").filter({ hasText: "Launch offer" }).isVisible());
    if (process.env.DISCOUNT_LIST_SCREENSHOT) {
      await mobilePage.screenshot({ path: process.env.DISCOUNT_LIST_SCREENSHOT, fullPage: true });
    }
    await mobile.close();
    ok("discount editor and campaign list fit a 390px mobile viewport");

    await page.goto(`${BASE}/admin/discounts`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("link", { name: "All discounts" }).click();
    await page.locator('[data-slot="badge"]:visible', { hasText: "Archived" }).waitFor();
    await page.getByRole("button", { name: "Restore" }).click();
    await page.waitForURL(/\/edit$/);
    assert.equal(await page.getByRole("switch", { name: "Enable discount" }).getAttribute("data-checked"), null);
    ok("archive stops a campaign and restore returns it disabled for review");
  } finally {
    await browser.close();
    await store.remove();
  }
  console.log(`\nAll ${passed} discount UI checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nDISCOUNT E2E FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
