/** Focused browser coverage for the GSAP-powered Kinetic storefront template. */
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

const product = (
  tenantId: string,
  name: string,
  imageUrl: string,
  categoryId: string,
  isBestSeller = false,
) =>
  createProduct(tenantId, {
    name,
    description: `${name} is part of the motion-led Kinetic collection.`,
    basePriceCents: 12900,
    imageUrl,
    images: [],
    isBestSeller,
    categoryId,
    variants: [{ attributes: {}, stock: 6, priceCentsOverride: null, imageUrl: null }],
  });

async function main() {
  const store = await makeStore("Kinetic UI");
  const tenantId = store.tenant.id;
  const base = `${BASE}/store/${store.tenant.slug}`;
  const screenshots = process.env.KINETIC_SCREENSHOT_DIR;

  const apparel = await createCategory(tenantId, {
    name: "Apparel",
    parentId: null,
    imageUrl: "/demo/overshirt.svg",
  });
  const movement = await createCategory(tenantId, {
    name: "Movement and Performance",
    parentId: null,
    imageUrl: "/demo/sneaker.svg",
  });
  const objects = await createCategory(tenantId, {
    name: "Objects",
    parentId: null,
    imageUrl: "/demo/lamp.svg",
  });

  const overshirt = await product(tenantId, "Future Overshirt", "/demo/overshirt.svg", apparel.id, true);
  await product(tenantId, "Velocity Runner", "/demo/sneaker.svg", movement.id, true);
  await product(tenantId, "Orbit Lamp", "/demo/lamp.svg", objects.id);
  await product(tenantId, "Carry System", "/demo/weekender.svg", apparel.id);
  await saveContent(tenantId, [
    { key: "hero.headline", value: "Objects in motion" },
    { key: "hero.subtext", value: "A collection designed to move through the city with you." },
    { key: "hero.image", value: "/demo/hero.svg" },
    { key: "hero.imageMobile", value: "/demo/hero.svg" },
    { key: "navbar.logoText", value: "IDEVELOPIT ECOMMERCE EXPERIENCE" },
    { key: "featuredCategories.heading", value: "Choose your direction" },
    { key: "newArrivals.heading", value: "The moving edit" },
    { key: "bestSellers.heading", value: "Most wanted" },
  ]);
  await setTenantTemplate(tenantId, "kinetic");
  if (screenshots) await mkdir(screenshots, { recursive: true });

  const { browser, context } = await launch();
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  let passed = 0;
  const ok = (message: string) => console.log(`  ok  ${++passed} ${message}`);

  try {
    assert.equal((await page.goto(base))?.status(), 200);
    await page.getByRole("heading", { name: "Objects in motion" }).waitFor();
    assert.equal(await page.locator('[data-section="hero"]').count(), 1);
    const desktopCtaBounds = await page.locator("[data-kinetic-cta]").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
    });
    assert.ok(
      desktopCtaBounds.top >= 0 && desktopCtaBounds.bottom <= desktopCtaBounds.viewport,
      `desktop hero action is clipped: ${JSON.stringify(desktopCtaBounds)}`,
    );
    assert.equal(await page.locator('[data-section="featuredCategories"] a').count(), 3);
    await page.locator(".pin-spacer").first().waitFor({ timeout: 5_000 }).catch(() => undefined);
    const motionDiagnostics = await page.evaluate(() => ({
      desktop: matchMedia("(min-width: 1024px)").matches,
      animate: matchMedia("(prefers-reduced-motion: no-preference)").matches,
      heroStyle: document.querySelector("[data-kinetic-word]")?.getAttribute("style"),
    }));
    assert.ok(
      await page.locator(".pin-spacer").count(),
      `desktop category film was not initialized: ${JSON.stringify({ motionDiagnostics, errors })}`,
    );
    ok("home renders real tenant content and initializes the desktop GSAP scene");

    if (screenshots) {
      await page.goto(base);
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: join(screenshots, "kinetic-desktop-hero.png") });
      await page.locator('[data-section="featuredCategories"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(screenshots, "kinetic-desktop-categories.png") });
      await page.locator('[data-section="newArrivals"]').evaluate((element) => {
        window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 72 });
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(screenshots, "kinetic-desktop-new-arrivals.png") });
    }

    const velocity = page.getByRole("button", { name: "Velocity Runner" });
    await velocity.click();
    assert.equal(await velocity.getAttribute("aria-pressed"), "true");
    await page.getByRole("link", { name: "Velocity Runner" }).first().waitFor();
    ok("the product stage switches products with accessible controls");

    const stage = page.getByRole("region", { name: "The moving edit" });
    await stage.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /Future Overshirt/ }).click();
    assert.equal(await stage.getAttribute("data-active-index"), "3");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    const rotationStarted = Date.now();
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute("data-active-index") === "0",
      '[aria-roledescription="carousel"]',
      { timeout: 5_500 },
    );
    assert.ok(Date.now() - rotationStarted < 5_000, "automatic product rotation is still too slow");
    ok("new arrivals automatically advances and wraps through the product sequence");

    await page.goto(`${base}/products/${overshirt.slug}`);
    await page.getByTestId("add-to-cart-button").click();
    assert.equal(await page.getByTestId("cart-count").first().innerText(), "(1)");
    ok("product details reuse the shared variant, stock and cart behavior");

    const reduced = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(base);
    const wordStyle = await reducedPage.locator("[data-kinetic-word]").first().getAttribute("style");
    assert.equal(wordStyle, null, "reduced-motion mode received inline GSAP transforms");
    await reduced.close();
    ok("prefers-reduced-motion receives the complete static experience");

    await saveContent(tenantId, [{ key: "hero.headline", value: "CLASSY WATCH" }]);
    await page.goto(base);
    await page.getByRole("heading", { name: "CLASSY WATCH" }).waitFor();
    const desktopWidth = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(desktopWidth.content <= desktopWidth.viewport, `long desktop headline overflow: ${JSON.stringify(desktopWidth)}`);

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(base);
    await mobilePage.getByRole("heading", { name: "CLASSY WATCH" }).waitFor();
    const mobileCtaBounds = await mobilePage.locator("[data-kinetic-cta]").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    assert.ok(
      mobileCtaBounds.left >= 0 && mobileCtaBounds.right <= mobileCtaBounds.viewport,
      `mobile hero action is clipped: ${JSON.stringify(mobileCtaBounds)}`,
    );
    const dimensions = await mobilePage.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.content <= dimensions.viewport, `mobile overflow: ${JSON.stringify(dimensions)}`);
    assert.equal(await mobilePage.locator(".pin-spacer").count(), 0);
    assert.equal(await mobilePage.locator('[data-section="featuredCategories"] a').count(), 3);
    await mobilePage
      .locator('[data-section="featuredCategories"]')
      .getByText("Movement and Performance", { exact: true })
      .waitFor();
    await mobilePage.getByText("IDEVELOPIT ECOMMERCE EXPERIENCE", { exact: true }).last().waitFor();
    if (screenshots) await mobilePage.screenshot({ path: join(screenshots, "kinetic-mobile.png"), fullPage: true });
    await mobile.close();
    ok("long headings remain complete on desktop and mobile with no horizontal overflow");

    await saveContent(tenantId, [
      { key: "hero.image", value: "" },
      { key: "hero.imageMobile", value: "" },
    ]);
    await page.goto(base);
    await page.waitForTimeout(250);
    ok("an image-free hero remains a valid static and animated state");

    assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
    ok("desktop runtime produced no console or page errors");
  } finally {
    await browser.close();
    await store.remove();
  }

  console.log(`\nAll ${passed} Kinetic UI checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nKINETIC E2E FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
