/**
 * The full customer + owner flow in a real browser (pnpm e2e:checkout):
 * browse -> category -> search -> product -> pick variant -> cart -> checkout -> confirmation
 * -> order in /admin/orders -> status changes -> cancel restores stock; plus stock limits,
 * a lost race for the last unit, tenant isolation, and every template.
 */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { createProduct } from "../../lib/data/products";
import { setTenantTemplate } from "../../lib/data/theme";
import { TEMPLATE_IDS } from "../../templates/meta";
import { BASE, launch, login, makeStore } from "./browser";

const v = (attributes: Record<string, string>, stock: number, price: number | null = null) => ({
  attributes,
  stock,
  priceCentsOverride: price,
  imageUrl: null,
});
const mk = (tenantId: string, name: string, categoryId: string | null, basePriceCents: number, variants: ReturnType<typeof v>[]) =>
  createProduct(tenantId, { name, description: `${name} description`, basePriceCents, imageUrl: "", images: [], isBestSeller: false, categoryId, variants });

async function main() {
  const store = await makeStore("Checkout UI");
  const other = await makeStore("Checkout Other");
  const T = store.tenant.id;
  const slug = store.tenant.slug;
  const men = await createCategory(T, { name: "Men", parentId: null });
  const shoes = await createCategory(T, { name: "Shoes", parentId: men.id });

  const sneaker = await mk(T, "Sneaker", shoes.id, 10000, [v({ size: "40" }, 2), v({ size: "41" }, 1, 12000)]);
  const cap = await mk(T, "Cap", null, 2000, [v({}, 5)]);
  const lastOne = await mk(T, "Last One", null, 1000, [v({}, 1)]);
  const [s40] = sneaker.variants;
  const capVariant = cap.variants[0];
  const lastVariant = lastOne.variants[0];
  const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;

  const { browser, context } = await launch();
  const page = await context.newPage();
  let n = 0;
  const ok = (m: string) => console.log(`  ok  ${++n} ${m}`);
  const cartCount = (p: Page) => p.locator('[data-testid="cart-count"]').first().innerText();
  const store_ = (path = "") => `${BASE}/store/${slug}${path}`;

  const fillCheckout = async (p: Page, name: string) => {
    await p.fill("#co-customerName", name);
    await p.fill("#co-customerPhone", "+1 555 010 0199");
    await p.fill("#co-customerAddress", "12 Analytical Street");
    await p.fill("#co-deliveryLocation", "https://maps.example.com/?q=analytical");
    await p.fill("#co-notes", "Ring twice");
  };

  try {
    // ---------------------------------------------------------------- browse -> add to cart
    await page.goto(store_("/shop"));
    await Promise.all([page.waitForURL(/category\/men/), page.locator('a[href$="/category/men"]').first().click()]);
    await Promise.all([page.waitForURL(/category\/shoes/), page.locator('[data-testid="category-chips"] a', { hasText: "Shoes" }).click()]);
    ok("browse the shop, then filter by category (Men > Shoes)");

    // search -> product
    const box = page.locator('header input[type="search"]').first();
    await box.fill("sneak");
    await Promise.all([page.waitForURL(/search\?q=sneak/), box.press("Enter")]);
    await Promise.all([page.waitForURL(/products\/sneaker/), page.locator('a[href$="/products/sneaker"]').first().click()]);
    ok("search finds the product and opens it");

    const addBtn = page.locator('[data-testid="add-to-cart-button"]');
    assert.equal(await addBtn.innerText(), "Select options");
    assert.equal(await addBtn.isDisabled(), true);
    ok("with several variants the add-to-cart button is disabled until one is chosen");

    await page.click('[data-option="size:40"]');
    assert.equal(await addBtn.innerText(), "Add to cart");
    await addBtn.click();
    assert.match(await page.locator('[data-testid="add-to-cart-note"]').innerText(), /Added to your cart/);
    assert.equal(await cartCount(page), "(1)");
    await addBtn.click();
    assert.equal(await cartCount(page), "(2)");
    await addBtn.click(); // stock is 2: a third unit must be refused
    assert.match(await page.locator('[data-testid="add-to-cart-note"]').innerText(), /All available stock is already in your cart/);
    assert.equal(await cartCount(page), "(2)");
    ok("adding is capped at the variant's stock (3rd click refused, cart stays at 2)");

    // sold-out variant can't be added
    await page.click('[data-option="size:41"]');
    assert.equal(await page.locator('[data-testid="stock-status"]').first().innerText(), "In stock");
    assert.equal(await page.locator('[data-testid="product-price"]').first().innerText(), "$120.00");
    ok("selecting variant 41 shows its own price ($120.00) and stock");

    // cart survives client-side navigation but is not persisted anywhere
    await Promise.all([page.waitForURL(/\/shop$/), page.locator('header a[href$="/shop"]').first().click()]);
    assert.equal(await cartCount(page), "(2)");
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    ok("the cart survives navigation between pages and uses no localStorage/sessionStorage");

    // second product via search box again
    await box.fill("cap").catch(() => {});
    await page.locator('header input[type="search"]').first().fill("cap");
    await Promise.all([page.waitForURL(/search\?q=cap/), page.locator('header input[type="search"]').first().press("Enter")]);
    await Promise.all([page.waitForURL(/products\/cap/), page.locator('a[href$="/products/cap"]').first().click()]);
    assert.equal(await addBtn.innerText(), "Add to cart"); // single default variant: nothing to choose
    await addBtn.click();
    assert.equal(await cartCount(page), "(3)");
    ok("a product without variation adds straight away (single default variant)");

    // ---------------------------------------------------------------- cart page
    await Promise.all([page.waitForURL(/\/cart$/), page.locator('[data-testid="cart-link"]').first().click()]);
    await page.waitForSelector('[data-testid="cart-line"]');
    assert.equal(await page.locator('[data-testid="cart-line"]').count(), 2);
    const lineFor = (name: string) => page.locator('[data-testid="cart-line"]', { hasText: name });
    assert.equal(await lineFor("Sneaker").locator('[data-testid="line-qty"]').innerText(), "2");
    assert.equal(await lineFor("Sneaker").getByRole("button", { name: "Increase quantity" }).isDisabled(), true);
    assert.match(await lineFor("Sneaker").innerText(), /Only 2 available/);
    assert.equal(await page.locator('[data-testid="cart-subtotal"]').innerText(), "$220.00");
    ok("cart page: two lines, quantity capped at stock (+ disabled, 'Only 2 available'), subtotal $220.00");

    await lineFor("Sneaker").getByRole("button", { name: "Decrease quantity" }).click();
    assert.equal(await page.locator('[data-testid="cart-subtotal"]').innerText(), "$120.00");
    await lineFor("Cap").getByRole("button", { name: "Increase quantity" }).click();
    await lineFor("Cap").getByRole("button", { name: "Increase quantity" }).click();
    assert.equal(await lineFor("Cap").locator('[data-testid="line-total"]').innerText(), "$60.00");
    assert.equal(await page.locator('[data-testid="cart-subtotal"]').innerText(), "$160.00");
    await lineFor("Cap").getByRole("button", { name: "Remove" }).click();
    assert.equal(await page.locator('[data-testid="cart-line"]').count(), 1);
    assert.equal(await cartCount(page), "(1)");
    ok("quantity +/-, line totals, and removing an item update the subtotal and the header count");

    // ---------------------------------------------------------------- checkout validation
    await Promise.all([page.waitForURL(/\/checkout$/), page.click('[data-testid="go-to-checkout"]')]);
    await page.waitForSelector("#co-customerName");
    await page.fill("#co-customerName", "A");
    await page.fill("#co-customerPhone", "abc");
    await page.click('[data-testid="place-order"]');
    await page.getByText("Enter a valid phone number").waitFor();
    await page.getByText("Enter your full name").waitFor();
    await page.getByText("Enter your address").waitFor();
    assert.equal(await prisma.order.count({ where: { tenantId: T } }), 0);
    ok("checkout validates name, phone, address and delivery location (no order created)");

    // ---------------------------------------------------------------- place the order
    await fillCheckout(page, "Ada Lovelace");
    await Promise.all([page.waitForURL(/order-confirmation\//), page.click('[data-testid="place-order"]')]);
    const confirmation = page.locator('[data-testid="confirmation-page"]');
    await confirmation.waitFor();
    const text = await confirmation.innerText();
    assert.match(text, /Thank you!/);
    assert.match(text, /1 × Sneaker/);
    assert.match(text, /size: 40/);
    assert.match(text, /Ada Lovelace/);
    assert.equal(await page.locator('[data-testid="confirmation-total"]').innerText(), "$100.00");
    assert.equal(await cartCount(page), "(0)");
    const order1 = await prisma.order.findFirstOrThrow({ where: { tenantId: T, customerName: "Ada Lovelace" }, include: { items: true } });
    assert.equal(order1.status, "PENDING");
    assert.equal(order1.items[0].productNameSnapshot, "Sneaker");
    assert.equal(await stock(s40.id), 1, "stock should drop from 2 to 1");
    ok("order placed: confirmation page shows the summary, cart is emptied, order is PENDING, stock deducted (2 -> 1)");

    // the confirmation of another store 404s
    assert.equal((await page.goto(`${BASE}/store/${other.tenant.slug}/order-confirmation/${order1.id}`))?.status(), 404);
    ok("an order id is not viewable through another store's storefront (404)");

    // ---------------------------------------------------------------- losing the race for the last unit
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageB = await contextB.newPage();
    // A puts the last unit in the cart and gets as far as the checkout form...
    await page.goto(store_("/products/last-one"));
    await page.locator('[data-testid="add-to-cart-button"]').click();
    await Promise.all([page.waitForURL(/\/cart$/), page.locator('[data-testid="cart-link"]').first().click()]);
    await page.waitForSelector('[data-testid="cart-line"]');
    await Promise.all([page.waitForURL(/\/checkout$/), page.click('[data-testid="go-to-checkout"]')]);
    await page.waitForSelector("#co-customerName");
    await fillCheckout(page, "Slow Buyer");
    // ...while B buys it first.
    await pageB.goto(store_("/products/last-one"));
    await pageB.locator('[data-testid="add-to-cart-button"]').click();
    await Promise.all([pageB.waitForURL(/\/cart$/), pageB.locator('[data-testid="cart-link"]').first().click()]);
    await pageB.waitForSelector('[data-testid="cart-line"]');
    await Promise.all([pageB.waitForURL(/\/checkout$/), pageB.click('[data-testid="go-to-checkout"]')]);
    await pageB.waitForSelector("#co-customerName");
    await fillCheckout(pageB, "Fast Buyer");
    await Promise.all([pageB.waitForURL(/order-confirmation\//), pageB.click('[data-testid="place-order"]')]);
    assert.equal(await stock(lastVariant.id), 0);
    // A now submits.
    await page.click('[data-testid="place-order"]');
    await page.locator('[data-testid="checkout-error"]').waitFor();
    assert.match(await page.locator('[data-testid="checkout-error"]').innerText(), /just sold out/);
    assert.equal(await prisma.order.count({ where: { tenantId: T, customerName: "Slow Buyer" } }), 0);
    assert.equal(await stock(lastVariant.id), 0, "stock went negative or was double-deducted");
    ok("someone else bought the last unit first: clear 'just sold out' error, no order created, stock stays at 0");
    await contextB.close();

    // ---------------------------------------------------------------- store owner: /admin/orders
    const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await login(admin, store.user.email, store.password);
    assert.equal(await admin.locator('[data-testid="pending-orders"]').innerText(), "2");
    await admin.goto(`${BASE}/admin/orders`);
    const rows = await admin.locator('[data-testid="order-row"]').allInnerTexts();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /Fast Buyer/); // newest first
    assert.match(rows[1], /Ada Lovelace/);
    assert.match(rows[1], /Pending/);
    assert.match(rows[1], /\$100\.00/);
    ok("owner sees both orders in /admin/orders, newest first, with status and totals; dashboard shows 2 pending");

    await admin.locator('[data-testid="order-row"]', { hasText: "Ada Lovelace" }).getByRole("link", { name: "View" }).click();
    await admin.waitForSelector('[data-testid="order-title"]');
    const detail = await admin.locator("main").innerText();
    assert.match(detail, /Ada Lovelace/);
    assert.match(detail, /\+1 555 010 0199/);
    assert.match(detail, /12 Analytical Street/);
    assert.match(detail, /Ring twice/);
    assert.match(detail, /Sneaker/);
    assert.equal(await admin.locator('a[href^="https://maps.example.com"]').count(), 1);
    assert.deepEqual(await admin.locator("#next-status option").allInnerTexts(), ["Confirmed", "Cancelled"]);
    ok("order detail shows customer info, notes, items and total; only valid next statuses are offered");

    await admin.selectOption("#next-status", "CONFIRMED");
    await admin.getByRole("button", { name: "Update status" }).click();
    await admin.locator('[data-testid="order-status"]', { hasText: "Confirmed" }).waitFor();
    assert.deepEqual(await admin.locator("#next-status option").allInnerTexts(), ["Delivered", "Cancelled"]);
    assert.equal(await stock(s40.id), 1);
    ok("Pending -> Confirmed works (stock unchanged) and the next options update");

    // ---------------------------------------------------------------- cancel restores stock
    await admin.selectOption("#next-status", "CANCELLED");
    await admin.getByRole("button", { name: "Update status" }).click();
    // An in-app confirmation modal, not a browser dialog.
    await admin.getByTestId("confirm-dialog-confirm").click();
    await admin.locator('[data-testid="order-status"]', { hasText: "Cancelled" }).waitFor();
    await admin.locator('[data-testid="status-final"]').waitFor();
    assert.equal(await stock(s40.id), 2, "cancelling should give the sneaker back (1 -> 2)");
    ok("Cancelled restores stock (1 -> 2) and the order becomes final");

    // ---------------------------------------------------------------- tenant isolation for orders
    const otherOwner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await login(otherOwner, other.user.email, other.password);
    assert.equal((await otherOwner.goto(`${BASE}/admin/orders/${order1.id}`))?.status(), 404);
    await otherOwner.goto(`${BASE}/admin/orders`);
    assert.ok(await otherOwner.getByText("No orders yet.").isVisible());
    ok("another store's owner can't see the order list or open this store's order (404)");

    // ---------------------------------------------------------------- every template
    for (const id of TEMPLATE_IDS) {
      await setTenantTemplate(T, id);
      await prisma.productVariant.update({ where: { id: capVariant.id }, data: { stock: 5 } });
      const p = await context.newPage();
      await p.goto(store_("/products/sneaker"));
      await p.click('[data-option="size:40"]');
      await p.locator('[data-testid="add-to-cart-button"]').click();
      assert.equal(await cartCount(p), "(1)", `${id}: cart count`);
      await Promise.all([p.waitForURL(/\/cart$/), p.locator('[data-testid="cart-link"]').first().click()]);
      await p.waitForSelector('[data-testid="cart-line"]');
      await Promise.all([p.waitForURL(/\/checkout$/), p.click('[data-testid="go-to-checkout"]')]);
      await p.waitForSelector("#co-customerName");
      await p.waitForSelector('[data-testid="checkout-lines"] li'); // resolved from the server
      assert.match(await p.locator('[data-testid="checkout-lines"]').innerText(), /Sneaker/, `${id}: checkout summary`);
      await p.close();
    }
    ok("product page -> add to cart -> cart -> checkout works in Minimal, Classic and Tonkic");
  } finally {
    await browser.close();
    await store.remove();
    await other.remove();
  }
  console.log(`\nAll ${n} checkout flow checks passed.`);
}

main()
  .catch((e) => {
    console.error("\nE2E FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
