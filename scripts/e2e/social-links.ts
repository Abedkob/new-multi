/** Real-browser check of the owner Social links page and every shared storefront footer look. */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../lib/prisma";
import { updateTenantSocialLinks } from "../../lib/data/tenants";
import { saveThemeOverrides, setTenantTemplate } from "../../lib/data/theme";
import { TEMPLATE_IDS } from "../../templates/meta";
import { BASE, launch, login, makeStore } from "./browser";

async function main() {
  const store = await makeStore("Social Links UI");
  const { browser, context } = await launch();
  const page = await context.newPage();
  const shots = mkdtempSync(join(tmpdir(), "social-footer-qa-"));
  let checks = 0;
  const ok = (message: string) => console.log(`  ok  ${++checks} ${message}`);

  try {
    await updateTenantSocialLinks(store.tenant.id, {
      instagramUrl: "https://instagram.com/social-links-test",
      facebookUrl: "https://facebook.com/social-links-test",
      tiktokUrl: "https://tiktok.com/@social-links-test",
      whatsappNumber: "96170123456",
      googleMapsUrl: "https://maps.app.goo.gl/example",
    });
    await saveThemeOverrides(store.tenant.id, {
      primaryColor: "#164e63",
      secondaryColor: "#cffafe",
      accentColor: "#c2410c",
      backgroundColor: "#ffffff",
    });

    await login(page, store.user.email, store.password);
    await page.goto(`${BASE}/admin/social-links`);
    assert.equal(await page.getByRole("button", { name: "Save social links" }).count(), 1);
    assert.equal(await page.locator('input[type="url"]').count(), 4);
    assert.equal(await page.locator('input[type="tel"]').count(), 1);
    await page.getByLabel("Facebook").fill("");
    await page.getByLabel("Instagram").fill("https://instagram.com/updated-social-test");
    await page.getByRole("button", { name: "Save social links" }).click();
    await page.getByText("Social links saved.").waitFor();
    const saved = await prisma.tenant.findUniqueOrThrow({
      where: { id: store.tenant.id },
      select: { instagramUrl: true, facebookUrl: true },
    });
    assert.equal(saved.instagramUrl, "https://instagram.com/updated-social-test");
    assert.equal(saved.facebookUrl, null);
    await page.screenshot({ path: join(shots, "admin-social-links.png"), fullPage: true });
    ok("owner form has one Save action and persists both a changed link and an empty link");

    for (const templateId of TEMPLATE_IDS) {
      await setTenantTemplate(store.tenant.id, templateId);
      await page.goto(`${BASE}/store/${store.tenant.slug}`);
      const footer = page.locator('footer');
      await footer.waitFor();
      assert.equal(await footer.locator('nav[aria-label="Social links"] a').count(), 4, `${templateId}: wrong social count`);
      for (const link of await footer.locator('nav[aria-label="Social links"] a').all()) {
        assert.equal(await link.getAttribute("target"), "_blank", `${templateId}: target`);
        assert.equal(await link.getAttribute("rel"), "noopener noreferrer", `${templateId}: rel`);
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        false,
        `${templateId}: horizontal overflow`,
      );
    }
    await page.locator('footer').screenshot({ path: join(shots, "footer-desktop.png") });
    ok("all nine template looks render configured links safely with no desktop overflow");

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${BASE}/store/${store.tenant.slug}`);
    const mobileFooter = mobilePage.locator('footer');
    await mobileFooter.scrollIntoViewIfNeeded();
    assert.equal(
      await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      false,
      "mobile horizontal overflow",
    );
    const boxes = await mobileFooter.locator("a").evaluateAll((links) =>
      links.map((link) => {
        const box = link.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    );
    assert.ok(boxes.every((box) => box.width > 0 && box.height > 0), "mobile footer has hidden links");
    await mobileFooter.screenshot({ path: join(shots, "footer-mobile.png") });
    await mobile.close();
    ok("mobile footer keeps every link visible without horizontal overflow");

    console.log(`\nAll ${checks} social-link browser checks passed.`);
    console.log(`Screenshots: ${shots}`);
  } finally {
    await browser.close();
    await store.remove();
  }
}

main()
  .catch((error) => {
    console.error("\nSOCIAL LINKS E2E FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
