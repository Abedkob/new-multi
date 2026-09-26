/** Focused browser coverage for the GSAP-powered Mirage storefront template. */
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

async function main() {
  const store = await makeStore("Mirage UI");
  const tenantId = store.tenant.id;
  const base = `${BASE}/store/${store.tenant.slug}`;
  const screenshots = process.env.MIRAGE_SCREENSHOT_DIR;

  const categories = await Promise.all([
    createCategory(tenantId, { name: "Phones", parentId: null, imageUrl: "/demo/hero.svg" }),
    createCategory(tenantId, { name: "Audio", parentId: null, imageUrl: "/demo/sneaker.svg" }),
    createCategory(tenantId, { name: "Accessories", parentId: null, imageUrl: "/demo/lamp.svg" }),
  ]);
  for (const [index, name] of ["Nova Phone", "Pulse Earbuds", "Arc Charger", "Shield Case"].entries()) {
    await createProduct(tenantId, {
      name,
      description: `${name} is part of the connected mobile collection.`,
      basePriceCents: 12900 + index * 1000,
      imageUrl: ["/demo/overshirt.svg", "/demo/sneaker.svg", "/demo/lamp.svg", "/demo/weekender.svg"][index],
      images: [],
      isBestSeller: index < 2,
      categoryId: categories[index % categories.length].id,
      variants: [{ attributes: {}, stock: 6, priceCentsOverride: null, imageUrl: null }],
    });
  }
  await saveContent(tenantId, [
    { key: "hero.headline", value: "The next upgrade is here" },
    { key: "hero.subtext", value: "Phones, audio and everyday accessories selected for life in motion." },
    { key: "hero.image", value: "/demo/hero.svg" },
    { key: "hero.imageMobile", value: "/demo/hero.svg" },
    { key: "featuredCategories.heading", value: "Shop by device" },
    { key: "newArrivals.heading", value: "Just landed" },
    { key: "bestSellers.heading", value: "Most wanted" },
  ]);
  await setTenantTemplate(tenantId, "mirage");
  if (screenshots) await mkdir(screenshots, { recursive: true });

  const { browser, context } = await launch();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  let passed = 0;
  const ok = (message: string) => console.log(`  ok  ${++passed} ${message}`);

  try {
    assert.equal((await page.goto(base))?.status(), 200);
    await page.getByRole("heading", { name: "The next upgrade is here" }).waitFor();
    const heroCoverage = await page.locator("[data-mirage-hero]").evaluate((hero) => {
      const visual = hero.querySelector<HTMLElement>("[data-mirage-visual]");
      const image = visual?.querySelector("img");
      if (!visual || !image) return null;
      const heroBox = hero.getBoundingClientRect();
      const visualBox = visual.getBoundingClientRect();
      return { heroWidth: heroBox.width, heroHeight: heroBox.height, visualWidth: visualBox.width, visualHeight: visualBox.height };
    });
    assert.ok(heroCoverage, "hero background image is missing");
    assert.ok(heroCoverage.visualWidth >= heroCoverage.heroWidth, "hero image does not cover the full width");
    assert.ok(heroCoverage.visualHeight >= heroCoverage.heroHeight, "hero image does not cover the full height");
    assert.equal(await page.locator('[data-section="featuredCategories"] a').count(), 3);
    assert.ok(await page.locator("[data-mirage-word]").count());
    await page.waitForFunction(() => document.querySelector("[data-mirage-word]")?.hasAttribute("style"));
    assert.equal(await page.locator(".pin-spacer").count(), 0);
    ok("desktop hero uses a full-bleed background and initializes its GSAP entrance");

    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport, `desktop overflow: ${JSON.stringify(width)}`);
    if (screenshots) {
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: join(screenshots, "mirage-desktop-hero.png") });
    }
    ok("desktop composition has no horizontal overflow");

    await page.locator('[data-section="featuredCategories"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("[data-mirage-collection]")?.hasAttribute("style"));
    assert.match((await page.locator("[data-mirage-collection]").first().getAttribute("style")) ?? "", /transform|opacity/);
    if (screenshots) {
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(screenshots, "mirage-desktop-collections.png") });
    }
    await page.locator('[data-section="newArrivals"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("[data-mirage-product]")?.hasAttribute("style"));
    assert.match((await page.locator("[data-mirage-product]").first().getAttribute("style")) ?? "", /transform|opacity/);
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("footer [data-footer-motion-item]")?.hasAttribute("style"));
    assert.match((await page.locator("footer [data-footer-motion-item]").first().getAttribute("style")) ?? "", /transform|opacity/);
    ok("category, product and footer GSAP sequences initialize on scroll");

    const reduced = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(base);
    assert.equal(await reducedPage.locator("[data-mirage-word]").first().getAttribute("style"), null);
    assert.equal(await reducedPage.locator("[data-mirage-collection]").first().getAttribute("style"), null);
    assert.equal(await reducedPage.locator("[data-mirage-product]").first().getAttribute("style"), null);
    assert.equal(await reducedPage.locator("footer [data-footer-motion-item]").first().getAttribute("style"), null);
    assert.equal(await reducedPage.locator(".pin-spacer").count(), 0);
    await reduced.close();
    ok("reduced motion receives the complete static composition");

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(base);
    await mobilePage.getByRole("heading", { name: "The next upgrade is here" }).waitFor();
    const mobileWidth = await mobilePage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(mobileWidth.content <= mobileWidth.viewport, `mobile overflow: ${JSON.stringify(mobileWidth)}`);
    assert.equal(await mobilePage.locator(".pin-spacer").count(), 0);
    if (screenshots) await mobilePage.screenshot({ path: join(screenshots, "mirage-mobile.png"), fullPage: true });
    await mobile.close();
    ok("mobile uses the complete native-flow experience");

    await saveContent(tenantId, [{ key: "hero.image", value: "" }, { key: "hero.imageMobile", value: "" }]);
    await page.goto(base);
    await page.getByRole("heading", { name: "The next upgrade is here" }).waitFor();
    ok("image-free hero remains valid");

    assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
    ok("desktop runtime produced no console or page errors");
  } finally {
    await browser.close();
    await store.remove();
  }
  console.log(`\nAll ${passed} Mirage UI checks passed.`);
}

main()
  .catch((error) => { console.error("\nMIRAGE E2E FAILED\n", error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
