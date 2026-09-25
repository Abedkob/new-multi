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
    createCategory(tenantId, { name: "Form", parentId: null, imageUrl: "/demo/overshirt.svg" }),
    createCategory(tenantId, { name: "Motion", parentId: null, imageUrl: "/demo/sneaker.svg" }),
    createCategory(tenantId, { name: "Light", parentId: null, imageUrl: "/demo/lamp.svg" }),
  ]);
  for (const [index, name] of ["Future Overshirt", "Velocity Runner", "Orbit Lamp", "Carry System"].entries()) {
    await createProduct(tenantId, {
      name,
      description: `${name} belongs to the Mirage spatial collection.`,
      basePriceCents: 12900 + index * 1000,
      imageUrl: ["/demo/overshirt.svg", "/demo/sneaker.svg", "/demo/lamp.svg", "/demo/weekender.svg"][index],
      images: [],
      isBestSeller: index < 2,
      categoryId: categories[index % categories.length].id,
      variants: [{ attributes: {}, stock: 6, priceCentsOverride: null, imageUrl: null }],
    });
  }
  await saveContent(tenantId, [
    { key: "hero.headline", value: "Beyond the visible" },
    { key: "hero.subtext", value: "Objects shaped for a world in motion." },
    { key: "hero.image", value: "/demo/hero.svg" },
    { key: "hero.imageMobile", value: "/demo/hero.svg" },
    { key: "featuredCategories.heading", value: "Enter another dimension" },
    { key: "newArrivals.heading", value: "New forms" },
    { key: "bestSellers.heading", value: "In focus" },
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
    await page.getByRole("heading", { name: "Beyond the visible" }).waitFor();
    await page.locator(".pin-spacer").first().waitFor({ timeout: 5_000 });
    assert.equal(await page.locator('[data-section="featuredCategories"] a').count(), 3);
    assert.ok(await page.locator("[data-mirage-word]").count());
    ok("desktop hero and pinned collection scenes initialize");

    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport, `desktop overflow: ${JSON.stringify(width)}`);
    if (screenshots) {
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: join(screenshots, "mirage-desktop-hero.png") });
      await page.locator('[data-section="featuredCategories"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(screenshots, "mirage-desktop-collections.png") });
    }
    ok("desktop composition has no horizontal overflow");

    const reduced = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(base);
    assert.equal(await reducedPage.locator("[data-mirage-word]").first().getAttribute("style"), null);
    assert.equal(await reducedPage.locator(".pin-spacer").count(), 0);
    await reduced.close();
    ok("reduced motion receives the complete static composition");

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(base);
    await mobilePage.getByRole("heading", { name: "Beyond the visible" }).waitFor();
    const mobileWidth = await mobilePage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(mobileWidth.content <= mobileWidth.viewport, `mobile overflow: ${JSON.stringify(mobileWidth)}`);
    assert.equal(await mobilePage.locator(".pin-spacer").count(), 0);
    if (screenshots) await mobilePage.screenshot({ path: join(screenshots, "mirage-mobile.png"), fullPage: true });
    await mobile.close();
    ok("mobile uses the complete native-flow experience");

    await saveContent(tenantId, [{ key: "hero.image", value: "" }, { key: "hero.imageMobile", value: "" }]);
    await page.goto(base);
    await page.getByRole("heading", { name: "Beyond the visible" }).waitFor();
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
