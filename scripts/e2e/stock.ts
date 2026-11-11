/**
 * Browser coverage for the stockroom's two forms, in a real browser (pnpm e2e:stock).
 *
 * `verify:stock` proves the writers are correct and `verify:stock-ui` proves the screens render
 * and refuse. Neither of them clicks anything, and three of this phase's claims can only be true
 * or false in a browser:
 *
 *  1. **Five lines can be entered from the keyboard alone.** A stockroom is one hand on a box and
 *     one on a keyboard. The picker is a combobox with ↑/↓ and Enter precisely so nobody has to
 *     find a mouse, and an assertion about the markup cannot tell whether it works.
 *  2. **A quantity field keeps what was typed.** The till shipped a money field that re-formatted
 *     itself on every keystroke, so "2.50" was charged as 2.01 — a bug invisible to `fill`, which
 *     sets a whole value in one event. Everything here is typed one character at a time.
 *  3. **Staff never see a cost field.** `verify:staff` can only check an EMPTY form, where the
 *     per-line field is absent whatever the role — so that assertion passes for the wrong reason.
 *     Here the line exists first, which is the only state in which the question means anything.
 *
 * The custom-domain leg is mandatory and must not excuse itself. For an admin-only feature the
 * assertion is inverted: every `/admin/stock` path must 404 on a store's own domain, because a
 * shop's customers must never reach its stockroom. That alone would pass if the routes were simply
 * broken, so the same paths are asserted to answer 200 on the shared host **in the same run**.
 */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { createProduct } from "../../lib/data/products";
import { createStaffAccount } from "../../lib/data/staff";
import { setTenantStock } from "../../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../../lib/passwords";
import { BASE, launch, login, makeStore } from "./browser";
import { assertDevOriginAllowed, onCustomDomain } from "./custom-domain";

const DOMAIN = "stock-e2e.test";

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

const PRODUCTS = [
  "Stock Alpha",
  "Stock Bravo",
  "Stock Charlie",
  "Stock Delta",
  "Stock Echo",
] as const;

async function main() {
  const store = await makeStore("Stock UI");
  const tenantId = store.tenant.id;
  // The platform switch, not a flag the store can set: without this the stockroom does not exist.
  await setTenantStock(tenantId, store.user.id);
  const actor = { userId: store.user.id, name: "Stock UI" };

  const variants: string[] = [];
  for (const name of PRODUCTS) {
    const product = await createProduct(
      tenantId,
      {
        name,
        description: "A product used to verify the stockroom.",
        basePriceCents: 1500,
        imageUrl: "/demo/cap.svg",
        images: [],
        isBestSeller: false,
        categoryId: null,
        lowStockThreshold: null,
        variants: [{ attributes: {}, stock: 10, priceCentsOverride: null, imageUrl: null }],
      },
      actor,
    );
    variants.push(product.variants[0].id);
  }

  const staffPassword = generateTempPassword();
  const staff = await createStaffAccount(
    tenantId,
    {
      name: "Stock Staff",
      email: `e2e-stock-staff-${Date.now().toString(36)}@example.test`,
      passwordHash: await hashPassword(staffPassword),
    },
    { userId: store.user.id, email: store.user.email },
  );
  await prisma.user.update({ where: { id: staff.id }, data: { mustChangePassword: false } });

  const { browser, context } = await launch();
  try {
    const page = await context.newPage();
    await login(page, store.user.email, store.password);

    // ---- five lines, from the keyboard alone ------------------------------------------------
    await page.goto(`${BASE}/admin/stock/receive`, { waitUntil: "load" });
    const picker = page.locator('input[role="combobox"]');
    await picker.click();

    for (const name of PRODUCTS) {
      // Typed, not filled: the picker debounces on change events, and `fill` emits one.
      await picker.pressSequentially(name, { delay: 15 });
      await page.locator('[data-testid="stock-picker-option"]').first().waitFor();
      // ArrowDown then Enter, never a click. This is the whole claim: a hand on a box and a hand
      // on a keyboard, with no reason to reach for a mouse.
      await picker.press("ArrowDown");
      await picker.press("ArrowUp");
      await picker.press("Enter");
      await page.locator(`[data-testid="stock-line"]:has-text("${name}")`).waitFor();
    }
    assert.equal(
      await page.locator('[data-testid="stock-line"]').count(),
      PRODUCTS.length,
      "five options added with the keyboard alone",
    );
    assert.equal(
      await picker.inputValue(),
      "",
      "and the box clears itself after each one, so the next name can be typed straight away",
    );
    ok("five lines entered from the keyboard alone, with no mouse and no page reload");

    // ---- a quantity field keeps what was typed ----------------------------------------------
    const firstQty = page.locator('[data-testid="stock-line"] input').nth(0);
    await firstQty.click();
    await firstQty.press("ControlOrMeta+a");
    await firstQty.pressSequentially("24", { delay: 20 });
    assert.equal(
      await firstQty.inputValue(),
      "24",
      "a quantity field that re-formats on each keystroke cannot be typed into — the till " +
        "shipped exactly that and charged 2.01 for a 2.50 reduction",
    );
    ok("a quantity keeps the characters that were typed into it");

    // The owner's cost field exists, and only now is that a real question: it is per line, so on
    // an empty form it is absent whatever the role.
    const costFields = page.locator('[data-testid="stock-line"] input[inputmode="decimal"]');
    assert.equal(
      await costFields.count(),
      PRODUCTS.length,
      "the owner gets a cost field on every line",
    );
    await costFields.nth(0).click();
    await costFields.nth(0).pressSequentially("4.50", { delay: 20 });
    assert.equal(await costFields.nth(0).inputValue(), "4.50", "and it takes a decimal");
    ok("the owner is asked what each line cost, once there is a line to ask about");

    // ---- recorded ---------------------------------------------------------------------------
    await page.locator('[data-testid="stock-submit"]').click();
    await page.locator('[data-testid="stock-document-done"]').waitFor();
    assert.equal(await stockOf(variants[0]), 34, "10 + 24");
    assert.equal(await stockOf(variants[1]), 11, "10 + 1, the default for a fresh line");
    const receipt = await prisma.stockBatch.findFirstOrThrow({
      where: { tenantId, kind: "RECEIPT" },
      select: { id: true, actorNameSnapshot: true },
    });
    const received = await prisma.stockMovement.findMany({
      where: { tenantId, batchId: receipt.id },
      select: { delta: true, unitCostCents: true, balanceAfter: true },
      orderBy: { delta: "desc" },
    });
    assert.equal(received.length, PRODUCTS.length, "one movement per line, naming the document");
    assert.deepEqual(
      [received[0].delta, received[0].balanceAfter, received[0].unitCostCents],
      [24, 34, 450],
      "the typed cost reached the ledger as cents",
    );
    assert.equal(receipt.actorNameSnapshot, "Stock UI", "and the document names who received it");
    ok("the delivery is recorded, the shelves move, and each line keeps its own cost");

    // ---- a stocktake states its variance before applying it ---------------------------------
    await page.goto(`${BASE}/admin/stock/count`, { waitUntil: "load" });
    const countPicker = page.locator('input[role="combobox"]');
    await countPicker.click();
    await countPicker.pressSequentially("Stock Alpha", { delay: 15 });
    await page.locator('[data-testid="stock-picker-option"]').first().waitFor();
    await countPicker.press("Enter");
    const counted = page.locator('[data-testid="stock-line"] input').nth(0);
    assert.equal(
      await counted.inputValue(),
      "34",
      "a count starts at what is believed to be there, so a shelf that agrees needs no typing " +
        "at all — and still gets its zero-delta row",
    );
    await counted.press("ControlOrMeta+a");
    await counted.pressSequentially("30", { delay: 20 });

    await page.locator('[data-testid="stock-submit"]').click();
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await dialog.waitFor();
    const said = await dialog.innerText();
    assert.ok(
      said.includes("-4") && said.includes("Stock Alpha"),
      `the dialog must state the change it is about to make: "are you sure" with no numbers is ` +
        `not a question. Got: ${said}`,
    );
    await dialog.locator('button:has-text("Apply the count")').click();
    await page.locator('[data-testid="stock-document-done"]').waitFor();
    assert.equal(await stockOf(variants[0]), 30, "the counted figure is the new figure");
    const countRow = await prisma.stockMovement.findFirstOrThrow({
      where: { tenantId, reason: "COUNT" },
      select: { delta: true, balanceAfter: true },
    });
    assert.deepEqual([countRow.delta, countRow.balanceAfter], [-4, 30]);
    ok("a stocktake states its variance, then applies exactly it");

    // ---- staff: the job, without the margin --------------------------------------------------
    const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const staffPage = await staffContext.newPage();
    await login(staffPage, staff.email, staffPassword);
    await staffPage.goto(`${BASE}/admin/stock/receive`, { waitUntil: "load" });
    const staffPicker = staffPage.locator('input[role="combobox"]');
    await staffPicker.click();
    await staffPicker.pressSequentially("Stock Bravo", { delay: 15 });
    await staffPage.locator('[data-testid="stock-picker-option"]').first().waitFor();
    await staffPicker.press("Enter");
    await staffPage.locator('[data-testid="stock-line"]').waitFor();
    assert.equal(
      await staffPage.locator('[data-testid="stock-line"] input[inputmode="decimal"]').count(),
      0,
      "a staff member must not be asked what the goods cost — and this is the only state in " +
        "which that assertion means anything, because the field is per line",
    );
    await staffPage.locator('[data-testid="stock-submit"]').click();
    await staffPage.locator('[data-testid="stock-document-done"]').waitFor();
    assert.equal(await stockOf(variants[1]), 12, "a staff member can receive a delivery");
    const staffLine = await prisma.stockMovement.findFirstOrThrow({
      where: { tenantId, actorUserId: staff.id, reason: "RECEIPT" },
      select: { unitCostCents: true, actorNameSnapshot: true },
    });
    assert.equal(staffLine.unitCostCents, null, "and it records no cost");
    assert.equal(staffLine.actorNameSnapshot, "Stock Staff", "but does record who received it");
    ok("a staff member receives a delivery, is never asked the cost, and records none");

    // ---- the mandatory custom-domain leg -----------------------------------------------------
    assertDevOriginAllowed(DOMAIN);
    await prisma.tenant.update({ where: { id: tenantId }, data: { domain: DOMAIN } });
    const ADMIN_PATHS = [
      "/admin/stock",
      "/admin/stock/history",
      "/admin/stock/receive",
      "/admin/stock/count",
    ];
    try {
      // Measured on the shared host in this same run, so routes that 404 everywhere — a typo, a
      // deleted page — cannot pass the leg below by being broken in both places.
      for (const path of ADMIN_PATHS) {
        const response = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
        assert.equal(response?.status(), 200, `${path} must answer on the platform host`);
      }

      await onCustomDomain(DOMAIN, async ({ context: domainContext, origin }) => {
        const d = await domainContext.newPage();
        for (const path of ADMIN_PATHS) {
          const response = await d.goto(`${origin}${path}`, { waitUntil: "load" });
          assert.equal(
            response?.status(),
            404,
            `${path} must be a 404 on a store's own domain (proxy.ts's PLATFORM_ONLY_PREFIXES) — ` +
              "a shop's customers must never reach its stockroom",
          );
        }
        // And the storefront on that domain still works, so the 404s above are the proxy
        // refusing an admin path rather than the host being broken.
        const home = await d.goto(`${origin}/`, { waitUntil: "load" });
        assert.equal(home?.status(), 200, `the storefront must still serve on ${DOMAIN}`);
      });
      ok("every stockroom path is a 404 on a store's own domain and 200 on the platform host");
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { domain: null } });
    }

    console.log(`\nAll ${checks} stockroom browser checks passed.`);
  } finally {
    await browser.close();
    await prisma.user.deleteMany({ where: { staffTenantId: tenantId } });
    await store.remove();
  }
}

main().catch((error) => {
  console.error("\nSTOCK E2E FAILED\n", error);
  process.exitCode = 1;
});
