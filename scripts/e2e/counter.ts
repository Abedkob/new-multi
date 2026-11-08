/**
 * Browser coverage for the in-store till: the cashier's whole workflow, in a real browser.
 *
 * `verify:counter` proves the writer is correct and `verify:staff` proves the permissions hold
 * over HTTP. Neither clicks anything, and the till is the one screen in this product where a
 * person stands in front of a customer and cannot retry — so the sequence that matters here is
 * search, add, reduce, take the money, and see the stock move.
 *
 * The custom-domain leg is mandatory and must not excuse itself. For an admin-only feature the
 * assertion is inverted: `/admin/counter` must be a 404 on a store's own domain, because a shop's
 * customers must never reach the till. That alone would pass if the route were simply broken, so
 * the same path is also asserted to answer 200 on the shared host **in the same run**.
 */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { createProduct } from "../../lib/data/products";
import { createStaffAccount } from "../../lib/data/staff";
import { setTenantCounterSales } from "../../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../../lib/passwords";
import { BASE, launch, login, makeStore } from "./browser";
import { assertDevOriginAllowed, onCustomDomain } from "./custom-domain";

const DOMAIN = "counter-e2e.test";

let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log(`  ok  ${name}`);
};

async function stockOf(variantId: string) {
  const row = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { stock: true },
  });
  return row?.stock ?? -1;
}

async function main() {
  const store = await makeStore("Counter UI");
  const tenantId = store.tenant.id;
  // The platform switch, not a flag the store can set: without this the till does not exist.
  await setTenantCounterSales(tenantId, store.user.id);

  const product = await createProduct(tenantId, {
    name: "Counter Mug",
    description: "A product used to verify the till.",
    basePriceCents: 1500,
    imageUrl: "/demo/cap.svg",
    images: [],
    isBestSeller: false,
    categoryId: null,
    variants: [{ attributes: {}, stock: 12, priceCentsOverride: null, imageUrl: null }],
  });
  const variantId = product.variants[0].id;

  const staffPassword = generateTempPassword();
  const staff = await createStaffAccount(
    tenantId,
    {
      name: "Counter Staff",
      email: `e2e-counter-staff-${Date.now().toString(36)}@example.test`,
      passwordHash: await hashPassword(staffPassword),
    },
    { userId: store.user.id, email: store.user.email },
  );
  await prisma.user.update({ where: { id: staff.id }, data: { mustChangePassword: false } });

  const { browser, context } = await launch();
  try {
    // ---- the owner rings up a sale ---------------------------------------------------------
    const page = await context.newPage();
    await login(page, store.user.email, store.password);

    await page.goto(`${BASE}/admin/counter/new`, { waitUntil: "load" });
    await page.fill("#till-search", "Counter Mug");
    // The results arrive through a server action, so wait for the row rather than the keystroke.
    await page.locator('[data-testid="till-result"]').first().waitFor();
    await page.locator('[data-testid="till-add"]').first().click();
    await page.locator('[data-testid="till-add"]').first().click();
    assert.equal(
      await page.locator('[data-testid="till-line"]').count(),
      1,
      "adding the same variant twice must raise its quantity, not add a second line",
    );
    assert.equal(
      await page.locator('[data-testid="till-total"]').innerText(),
      "$30.00",
      "two at $15.00",
    );
    ok("the same variant added twice is one line of two");

    // A reduction, with its reason. The owner is uncapped, so $2.50 off each is allowed.
    await page.locator('[data-testid="till-line"] input').nth(0).fill("2.50");
    await page.locator('[data-testid="till-line"] input').nth(1).fill("chipped handle");
    await page.locator('[data-testid="till-total"]').getByText("$25.00").waitFor();
    ok("a reduction with a reason changes the total on screen");

    // The cart must survive a search: this is the interaction the whole screen is shaped around.
    await page.fill("#till-search", "nothing-matches-this-term");
    await page.getByText("Nothing matches that.").waitFor();
    assert.equal(
      await page.locator('[data-testid="till-line"]').count(),
      1,
      "searching again must not empty the cart — a cashier losing a half-rung sale is the worst " +
        "bug this screen could have",
    );
    assert.equal(await page.locator('[data-testid="till-total"]').innerText(), "$25.00");
    ok("the cart survives a second search");

    await page.locator('[data-testid="till-complete"]').click();
    await page.locator('[data-testid="till-recorded"]').waitFor();
    assert.equal(await stockOf(variantId), 10, "two mugs left the shelf");
    const sale = await prisma.counterSale.findFirstOrThrow({
      where: { tenantId },
      select: { id: true, payment: true, items: { select: { priceCentsSnapshot: true } } },
    });
    assert.equal(sale.payment, "CASH", "cash is the default and was not changed");
    assert.equal(sale.items[0].priceCentsSnapshot, 1250, "$15.00 less the $2.50 reduction");
    ok("completing the sale deducts the stock and records the reduced price");

    // ---- the receipt, and the void ---------------------------------------------------------
    await page.goto(`${BASE}/admin/counter/${sale.id}`, { waitUntil: "load" });
    assert.equal(await page.locator('[data-testid="receipt-total"]').innerText(), "$25.00");
    await page.fill("#void-reason", "rang up by mistake");
    await page.locator('[data-testid="counter-void"]').click();
    await page.getByRole("button", { name: "Void this sale", exact: true }).last().click();
    await page.getByText("The stock went back on the shelf.").waitFor();
    assert.equal(await stockOf(variantId), 12, "voiding put both mugs back");
    ok("the owner can void a sale from its receipt and the stock returns");

    // ---- the staff member --------------------------------------------------------------- --
    const staffPage = await (await browser.newContext()).newPage();
    await login(staffPage, staff.email, staffPassword);
    await staffPage.goto(`${BASE}/admin/counter/new`, { waitUntil: "load" });
    await staffPage.fill("#till-search", "Counter Mug");
    await staffPage.locator('[data-testid="till-result"]').first().waitFor();
    await staffPage.locator('[data-testid="till-add"]').first().click();
    await staffPage.locator('[data-testid="till-complete"]').click();
    await staffPage.locator('[data-testid="till-recorded"]').waitFor();
    assert.equal(await stockOf(variantId), 11, "a staff member can sell");
    const staffSale = await prisma.counterSale.findFirstOrThrow({
      where: { tenantId, soldByUserId: staff.id },
      select: { id: true, soldByNameSnapshot: true },
    });
    assert.equal(staffSale.soldByNameSnapshot, "Counter Staff", "the receipt names who sold it");
    ok("a staff member can ring up a sale of their own");

    await staffPage.goto(`${BASE}/admin/counter/${staffSale.id}`, { waitUntil: "load" });
    assert.equal(
      await staffPage.locator('[data-testid="counter-void"]').count(),
      0,
      "a staff member must not be offered the void control",
    );
    ok("and is not offered the void control on it");

    // ---- the mandatory custom-domain leg ---------------------------------------------------
    assertDevOriginAllowed(DOMAIN);
    await prisma.tenant.update({ where: { id: tenantId }, data: { domain: DOMAIN } });
    try {
      // Measured on the shared host in this same run, so a route that 404s everywhere — a typo,
      // a deleted page — cannot pass the leg below by being broken in both places.
      const onSharedHost = await page.goto(`${BASE}/admin/counter`, { waitUntil: "load" });
      assert.equal(onSharedHost?.status(), 200, "the till must answer on the platform host");

      await onCustomDomain(DOMAIN, async ({ context: domainContext, origin }) => {
        const d = await domainContext.newPage();
        for (const path of ["/admin/counter", "/admin/counter/new", `/admin/counter/${sale.id}`]) {
          const response = await d.goto(`${origin}${path}`, { waitUntil: "load" });
          assert.equal(
            response?.status(),
            404,
            `${path} must be a 404 on a store's own domain (proxy.ts's PLATFORM_ONLY_PREFIXES) — ` +
              "a shop's customers must never reach the till",
          );
        }
        // And the storefront on that domain still works, so the 404s above are the proxy
        // refusing an admin path rather than the host being broken.
        const home = await d.goto(`${origin}/`, { waitUntil: "load" });
        assert.equal(home?.status(), 200, `the storefront must still serve on ${DOMAIN}`);
      });
      ok("the till is a 404 on a store's own domain and 200 on the platform host");
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { domain: null } });
    }

    console.log(`\nAll ${checks} counter-sale browser checks passed.`);
  } finally {
    await browser.close();
    await prisma.user.deleteMany({ where: { staffTenantId: tenantId } });
    await store.remove();
  }
}

main().catch((error) => {
  console.error("\nCOUNTER E2E FAILED\n", error);
  process.exitCode = 1;
});
