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
import { assertDevOriginAllowed, onCustomDomain } from "./custom-domain";

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
      const whatsappButton = page.getByTestId("whatsapp-contact-button");
      await whatsappButton.waitFor();
      assert.equal(await whatsappButton.getAttribute("href"), "https://wa.me/96170123456", `${templateId}: WhatsApp href`);
      assert.equal(await whatsappButton.getAttribute("target"), "_blank", `${templateId}: WhatsApp target`);
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
    ok(`all ${TEMPLATE_IDS.length} template looks render configured links safely with no desktop overflow`);

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${BASE}/store/${store.tenant.slug}`);
    const mobileFooter = mobilePage.locator('footer');
    await mobileFooter.scrollIntoViewIfNeeded();
    const mobileWhatsapp = mobilePage.getByTestId("whatsapp-contact-button");
    const whatsappBox = await mobileWhatsapp.boundingBox();
    assert.ok(whatsappBox && whatsappBox.width >= 44 && whatsappBox.height >= 44, "mobile WhatsApp target is too small");
    assert.equal(await mobileWhatsapp.evaluate((element) => getComputedStyle(element).position), "fixed");
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

    // -------------------------------------------- the footer on the store's own domain
    // Mandatory since 2026-11-04 (scripts/e2e/custom-domain.ts): a leg that cannot run FAILS.
    //
    // The footer is where the two kinds of link sit side by side, and the host decides which is
    // which. The owner's social links are absolute and must survive untouched; everything else
    // in the footer is store-relative and must lose its /store/<slug> prefix, because on a
    // domain the store IS the root. Getting that backwards is invisible on the shared host and
    // breaks every footer link, or every social link, on every store that has a domain.
    const domain = "social-e2e.test";
    assertDevOriginAllowed(domain);
    await setTenantTemplate(store.tenant.id, "minimal");
    await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain } });
    try {
      await onCustomDomain(domain, async ({ context: domainContext, origin }) => {
        const d = await domainContext.newPage();
        await d.goto(origin, { waitUntil: "load" });
        const footer = d.locator("footer");
        await footer.waitFor();

        // Absolute, owner-supplied, and unchanged by the host.
        const whatsapp = d.getByTestId("whatsapp-contact-button");
        await whatsapp.waitFor();
        assert.equal(await whatsapp.getAttribute("href"), "https://wa.me/96170123456");
        const social = footer.locator('nav[aria-label="Social links"] a');
        assert.equal(await social.count(), 4);
        for (const link of await social.all()) {
          const href = await link.getAttribute("href");
          assert.ok(
            href?.startsWith("https://"),
            `a social link must stay absolute on a domain, got ${href}`,
          );
          assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
        }

        // Store-relative, and root-relative here. Checked by where they point AND by one of
        // them actually resolving — a link can be shaped correctly and still 404.
        const internal = await footer.locator('a[href^="/"]').evaluateAll((as) =>
          (as as HTMLAnchorElement[]).map((a) => a.getAttribute("href")!),
        );
        assert.ok(internal.length > 0, "the footer must link into the store");
        for (const href of internal) {
          assert.ok(
            !href.startsWith("/store/"),
            `on a domain a storefront link must not carry /store/<slug>, got ${href}`,
          );
        }
        assert.equal((await d.goto(`${origin}/privacy`))?.status(), 200);
        ok(`on ${domain} social links stay absolute and the footer's own links are root-relative`);
      });
    } finally {
      await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain: null } });
    }

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
