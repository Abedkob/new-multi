/** Prism: motion, search, responsive layout and real commerce integration. */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { saveContent } from "../../lib/data/content";
import { createProduct } from "../../lib/data/products";
import { setTenantTemplate } from "../../lib/data/theme";
import { BASE, launch, makeStore } from "./browser";
import {
  assertDevOriginAllowed,
  assertStorefrontDomainBasics,
  onCustomDomain,
} from "./custom-domain";

async function main() {
  const store = await makeStore("Prism UI");
  const { browser, context } = await launch();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = `${BASE}/store/${store.tenant.slug}`;
  const screenshots = process.env.PRISM_SCREENSHOT_DIR;
  try {
    const category = await createCategory(store.tenant.id, { name: "Everyday objects", parentId: null, imageUrl: "/demo/hero.svg" });
    await createCategory(store.tenant.id, { name: "In motion", parentId: null, imageUrl: "/demo/sneaker.svg" });
    await createCategory(store.tenant.id, { name: "After hours", parentId: null, imageUrl: "/demo/lamp.svg" });
    await createProduct(store.tenant.id, {
      name: "Prism Overshirt", description: "Made for the everyday.", basePriceCents: 12500,
      imageUrl: "/demo/overshirt.svg", images: [{ url: "/demo/hero.svg", altText: "Detail" }],
      isBestSeller: true, categoryId: category.id,
      variants: [{ attributes: {}, stock: 6, priceCentsOverride: null, imageUrl: null }],
    });
    await saveContent(store.tenant.id, [
      { key: "hero.headline", value: "A different perspective." },
      { key: "hero.subtext", value: "Considered pieces. Unexpected possibilities." },
      { key: "hero.image", value: "/demo/hero.svg" },
      { key: "promoBanner.heading", value: "Change your point of view." },
      { key: "promoBanner.image", value: "/demo/hero.svg" },
    ]);
    await setTenantTemplate(store.tenant.id, "prism");
    assert.equal((await page.goto(base))?.status(), 200);
    await page.getByRole("heading", { name: "A different perspective." }).waitFor();
    await page.waitForFunction(() => !!document.querySelector("[data-word]")?.getAttribute("style"));
    assert.ok(await page.locator("[data-prism-hero]").evaluate((el) => el.clientHeight >= window.innerHeight));
    assert.equal(await page.locator("[data-collection]").count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log("ok: full-screen hero, initialized motion and category links");
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: join(screenshots, "prism-desktop.png") });
    }
    await page.locator("[data-collection]").nth(1).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const face = document.querySelector("[data-collection] a");
      return face && getComputedStyle(face).transform !== "none";
    });
    if (screenshots) await page.screenshot({ path: join(screenshots, "prism-collections.png") });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("searchbox").evaluate((el) => document.activeElement === el), true);
    await dialog.getByRole("searchbox").fill("Prism");
    await dialog.getByRole("heading", { name: "Prism Overshirt" }).waitFor();
    assert.ok((await dialog.innerText()).includes("$125.00"));
    await dialog.getByRole("searchbox").fill("no-match-prism-xyz");
    await dialog.getByRole("status").filter({ hasText: "No products match" }).waitFor();
    await dialog.getByRole("searchbox").fill("");
    await dialog.getByRole("link", { name: "Everyday objects", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "Search", exact: true }).evaluate((el) => document.activeElement === el), true);
    console.log("ok: live search returns prices, Escape restores focus");
    await page.locator('[data-section="newArrivals"] a').filter({ hasText: "Prism Overshirt" }).click();
    await page.getByRole("heading", { name: "Prism Overshirt", exact: true, level: 1 }).waitFor();
    await page.getByRole("button", { name: "Next product image", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "2 / 2" }).waitFor();
    await page.getByRole("button", { name: /Add to cart/i }).click();
    await page.locator(`header a[href="/store/${store.tenant.slug}/cart"]`).click();
    await page.locator("main").getByText("Prism Overshirt", { exact: true }).first().waitFor();
    console.log("ok: product purchase controls add the real variant to cart");
    for (const path of ["shop", `category/${category.slug}`, "search?q=Prism", "checkout"]) {
      assert.equal((await page.goto(`${base}/${path}`))?.status(), 200);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.getByRole("heading", { name: "A different perspective." }).waitFor();
    await page.waitForFunction(() => document.querySelector("[data-prism-hero-visual]")?.getAttribute("style")?.includes("transform"));
    await page.evaluate(() => window.scrollTo({ top: Math.round(innerHeight * .45), behavior: "instant" as ScrollBehavior }));
    await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-prism-hero-visual]")!).transform !== "none");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator("[data-collection]").first().evaluate((el) => getComputedStyle(el).position), "sticky");
    await page.locator("[data-collection]").first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("[data-collection] a")?.getAttribute("style")?.includes("transform"));
    if (screenshots) { await page.waitForTimeout(1600); await page.screenshot({ path: join(screenshots, "prism-mobile.png") }); }
    console.log("ok: mobile has no page overflow and uses a pinned, animated collection sequence");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= innerWidth));
    await dialog.getByRole("button", { name: "Close search" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page.getByRole("heading", { name: "A different perspective." }).waitFor();
    assert.equal(await page.locator("[data-word]").first().evaluate((el) => getComputedStyle(el).transform), "none");
    assert.equal(await page.locator("[data-collection]").first().evaluate((el) => getComputedStyle(el).position), "relative");
    assert.deepEqual(errors, []);
    console.log("ok: reduced motion is static; no browser runtime errors");

    // ---------------------------------------------- Prism on a store's own domain
    // Mandatory since 2026-11-04 (scripts/e2e/custom-domain.ts): a leg that cannot run FAILS.
    //
    // Prism carries the most client machinery of the three: a split-word hero entrance, a
    // pinned collection sequence, and a search dialog that is its own component rather than
    // the shared navbar field. The dialog is the one worth driving here — it queries the
    // server, renders prices, and links on to a category page, so it fails three different
    // ways if the host is wrong, and the links it renders are exactly the kind a template
    // builds from the slug by mistake. The shared-host checks above reach the cart through a
    // hardcoded /store/<slug>/cart href; here that same link has to be /cart.
    const domain = "prism-e2e.test";
    assertDevOriginAllowed(domain);
    await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain } });
    try {
      await onCustomDomain(domain, async ({ context: domainContext, origin }) => {
        const d = await domainContext.newPage();
        const domainErrors: string[] = [];
        d.on("pageerror", (error) => domainErrors.push(error.message));

        await d.goto(origin, { waitUntil: "load" });
        await d.getByRole("heading", { name: "A different perspective." }).waitFor();
        await d.waitForFunction(() => !!document.querySelector("[data-word]")?.getAttribute("style"));
        assert.ok(
          await d.locator("[data-prism-hero]").evaluate((el) => el.clientHeight >= window.innerHeight),
        );
        assert.equal(await d.locator("[data-collection]").count(), 3);

        const domainDialog = d.getByRole("dialog");
        await d.getByRole("button", { name: "Search", exact: true }).click();
        await domainDialog.waitFor();
        await domainDialog.getByRole("searchbox").fill("Prism");
        await domainDialog.getByRole("heading", { name: "Prism Overshirt" }).waitFor();
        assert.ok((await domainDialog.innerText()).includes("$125.00"));
        const dialogHrefs = await domainDialog
          .locator('a[href^="/"]')
          .evaluateAll((as) => (as as HTMLAnchorElement[]).map((a) => a.getAttribute("href")!));
        assert.ok(dialogHrefs.length > 0, "a search result must be a link");
        for (const href of dialogHrefs) {
          assert.ok(
            !href.startsWith("/store/"),
            `a search result link must be root-relative on a domain, got ${href}`,
          );
        }
        await d.keyboard.press("Escape");

        // The cart link, which on the shared host is addressed as /store/<slug>/cart.
        await d.locator('header a[href="/cart"]').click();
        await d.locator('[data-testid="cart-page"]').waitFor();

        await d.goto(origin, { waitUntil: "load" });
        await assertStorefrontDomainBasics(d, origin, [
          "/shop",
          `/category/${category.slug}`,
          "/search?q=Prism",
          "/checkout",
        ]);
        assert.deepEqual(domainErrors, [], `browser errors on ${domain}: ${domainErrors.join("\n")}`);
        console.log(`ok: on ${domain} the hero, collections, search dialog and cart link all work`);
      });
    } finally {
      await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain: null } });
    }
  } finally { await browser.close(); await store.remove(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
