/**
 * Phase 1 consent, in a real browser (pnpm e2e:consent).
 *
 * This is the half of PHASE_1_ACCEPTANCE.md that only a browser can answer: what actually leaves
 * the page before a visitor has chosen. The assertions are made against Chrome's own request log,
 * not against our source — "no tag is rendered" is a claim about code, "nothing was requested" is
 * a fact about the network, and only the second one is worth anything here.
 *
 * Third-party hosts are recorded and then aborted, so a run never touches Google or Meta and
 * never sends a test store's id to anyone.
 *
 * Needs a running server (BASE_URL, default http://localhost:3000) and Chrome installed. Creates
 * and removes its own throwaway stores, like the other e2e scripts.
 */

import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page, type Request } from "playwright-core";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { createProduct } from "../../lib/data/products";
import { setTenantTemplate } from "../../lib/data/theme";
import { BASE, makeStore } from "./browser";

const SHOTS = process.env.CONSENT_SCREENSHOT_DIR ?? "consent-screenshots";

/** Hosts that must never be contacted before the matching category is granted. */
const TRACKER_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "connect.facebook.net",
  "facebook.com",
  "doubleclick.net",
  "googleadservices.com",
];

const isTracker = (url: string) => TRACKER_HOSTS.some((host) => url.includes(host));
/** Our own analytics surface. Phase 1 ships none; this keeps it that way as Phase 2 lands. */
const isOwnAnalytics = (url: string) => /\/analytics(\/|\?|$)/.test(new URL(url).pathname + "?");

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

type Log = { urls: string[]; reset: () => void };

/** Records every request, and aborts the third-party ones so nothing leaves this machine. */
async function instrument(context: BrowserContext): Promise<Log> {
  const urls: string[] = [];
  context.on("request", (request: Request) => urls.push(request.url()));
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isTracker(url)) return route.abort();
    return route.fallback();
  });
  return { urls, reset: () => urls.splice(0, urls.length) };
}

const trackersIn = (log: Log) => log.urls.filter(isTracker);
const ownAnalyticsIn = (log: Log) =>
  log.urls.filter((u) => u.startsWith(BASE) && isOwnAnalytics(u));

async function consentCookies(context: BrowserContext) {
  return (await context.cookies()).filter((c) => c.name.startsWith("store_consent_"));
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });

  const store = await makeStore("Consent");
  const T = store.tenant.id;
  const slug = store.tenant.slug;

  // A store with all three integrations configured: the gating has to be the only reason
  // nothing loads.
  await prisma.tenant.update({
    where: { id: T },
    data: {
      gaMeasurementId: "G-E2ECONSENT",
      googleAdsId: "AW-123456789",
      googleAdsPurchaseLabel: "e2eLabel",
      metaPixelId: "1234567890",
      privacyControllerName: "Consent Test Ltd",
      privacyEmail: "privacy@consent.test",
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
    },
  });

  const category = await createCategory(T, { name: "Shirts", parentId: null });
  const product = await createProduct(T, {
    name: "Linen Shirt",
    description: "A shirt",
    basePriceCents: 4500,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: category.id,
    variants: [{ attributes: {}, stock: 5, priceCentsOverride: null, imageUrl: null }],
  });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log = await instrument(context);
  const page = await context.newPage();
  const home = `${BASE}/store/${slug}`;

  try {
    // ------------------------------------------------------------------ nothing before consent
    await page.goto(home, { waitUntil: "networkidle" });
    await page.locator('[data-testid="consent-banner"]').waitFor();

    assert.deepEqual(trackersIn(log), [], `requests left before any choice: ${trackersIn(log)}`);
    ok("P1-01", `no request to any of the ${TRACKER_HOSTS.length} tracker hosts before a choice`);

    assert.deepEqual(ownAnalyticsIn(log), [], `own analytics calls: ${ownAnalyticsIn(log)}`);
    ok("P1-33", "no request to our own /analytics/ paths before a choice");

    const trackerScripts = await page.locator("script[src]").evaluateAll((nodes) =>
      nodes
        .map((n) => (n as HTMLScriptElement).src)
        .filter((src) =>
          ["googletagmanager", "google-analytics", "facebook", "doubleclick"].some((h) =>
            src.includes(h),
          ),
        ),
    );
    assert.deepEqual(trackerScripts, [], `tracker <script> in the DOM: ${trackerScripts}`);
    ok("P1-02", "no tracking <script> is in the pre-consent DOM at all");

    assert.deepEqual(await consentCookies(context), []);
    ok("P1-03", "no consent or analytics cookie exists before a choice");

    // ------------------------------------------------------------------ banner correctness
    await page.locator('[data-testid="consent-manage"]').click();
    await page.locator('[data-testid="consent-manage-dialog"]').waitFor();
    assert.equal(await page.locator('[data-testid="consent-category-analytics"]').isChecked(), false);
    assert.equal(
      await page.locator('[data-testid="consent-category-advertising"]').isChecked(),
      false,
    );
    ok("P1-14", "neither non-essential category is preselected");

    // Esc closes and focus returns to the control that opened it.
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="consent-manage-dialog"]').waitFor({ state: "hidden" });
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );
    assert.equal(focused, "consent-manage", "focus must return to the trigger");
    ok("P1-18", "the dialog closes on Escape and returns focus to the control that opened it");

    const accept = await page.locator('[data-testid="consent-accept-all"]').boundingBox();
    const reject = await page.locator('[data-testid="consent-reject"]').boundingBox();
    assert.ok(accept && reject);
    assert.equal(Math.round(accept!.height), Math.round(reject!.height));
    const ratio = accept!.width / reject!.width;
    assert.ok(ratio > 0.5 && ratio < 2, `Accept/Reject width ratio ${ratio.toFixed(2)}`);
    assert.ok(Math.abs(accept!.y - reject!.y) < 2, "both choices must sit on the same row");
    ok(
      "P1-15",
      `Accept and Reject: same height (${Math.round(accept!.height)}px), same row, width ratio ${ratio.toFixed(2)}`,
    );

    // ------------------------------------------------------------------ language and direction
    const beforeSwitch = await page.locator('[data-testid="consent-banner"]').getAttribute("dir");
    await page.locator('[data-testid="consent-language-switch"]').click();
    const banner = page.locator('[data-testid="consent-banner"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="consent-banner"]')?.getAttribute("dir") === "rtl",
    );
    assert.equal(beforeSwitch, "ltr", "the store's default locale is English");
    assert.equal(await banner.getAttribute("dir"), "rtl");
    assert.equal(await page.locator("html").getAttribute("dir"), null, "the document must not flip");
    const arabic = await banner.innerText();
    assert.ok(/[؀-ۿ]/.test(arabic), "the notice must actually be in Arabic");
    ok("P1-16", "the in-notice switch renders Arabic with dir=rtl scoped to the notice only");

    await page.locator('[data-testid="consent-language-switch"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="consent-banner"]')?.getAttribute("dir") === "ltr",
    );
    ok("P1-37", "the notice opened in the store's default language and can be switched back");

    // ------------------------------------------------------------------ analytics only
    log.reset();
    await page.locator('[data-testid="consent-manage"]').click();
    await page.locator('[data-testid="consent-category-analytics"]').check();
    await page.locator('[data-testid="consent-save"]').click();
    await page.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle");

    const afterAnalytics = trackersIn(log);
    assert.ok(
      afterAnalytics.some((u) => u.includes("googletagmanager.com")),
      `GA4 should load once analytics is granted; saw ${afterAnalytics.join(", ")}`,
    );
    assert.deepEqual(
      afterAnalytics.filter((u) => u.includes("facebook") || u.includes("doubleclick")),
      [],
      "advertising was not granted",
    );
    ok("P1-05", "granting analytics alone loads GA4 and nothing from Meta or Google Ads");

    const cookie = (await consentCookies(context))[0];
    assert.ok(cookie, "a consent cookie must now exist");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Lax");
    assert.equal(cookie.path, `/store/${slug}`, "path-scoped to this store on the shared host");
    const months = (cookie.expires * 1000 - Date.now()) / (86400_000 * 30);
    assert.ok(months > 5 && months < 7, `cookie life ${months.toFixed(1)} months`);
    ok("P1-13", `the cookie is HttpOnly, Lax, scoped to /store/${slug}, ~${months.toFixed(0)} months`);

    const receipts = await prisma.analyticsConsentReceipt.findMany({ where: { tenantId: T } });
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].analyticsGranted, true);
    assert.equal(receipts[0].advertisingGranted, false);
    assert.equal(receipts[0].decisionMethod, "MANAGE");
    assert.equal(receipts[0].country, null, "no proxy country header in a local run");
    assert.equal(receipts[0].deviceClass, "desktop");
    ok("P1-23", "the decision is recorded once, with its method and the coarse device class");

    // ------------------------------------------------------------------ withdrawal
    log.reset();
    await page.locator('[data-testid="cookie-settings-link"]').first().click();
    await page.locator('[data-testid="consent-manage-dialog"]').waitFor();
    await page.locator('[data-testid="consent-withdraw"]').click();
    await page.locator('[data-testid="consent-manage-dialog"]').waitFor({ state: "hidden" });
    await page.waitForLoadState("networkidle");
    ok("P1-09", "withdrawing takes two clicks from the footer — the same as accepting took");

    log.reset();
    await page.goto(home, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    assert.deepEqual(trackersIn(log), [], `tracking after withdrawal: ${trackersIn(log)}`);
    ok("P1-10", "after withdrawal no tracking request leaves the page again");

    const withdrawn = await prisma.analyticsConsentReceipt.findFirst({
      where: { tenantId: T, decisionMethod: "FOOTER_WITHDRAW" },
    });
    assert.ok(withdrawn, "withdrawal must be recorded, not just forgotten");
    assert.equal(withdrawn!.analyticsGranted, false);
    ok("P1-23", "withdrawal is recorded as its own refusal receipt");

    // No banner, because a refusal is still a decision.
    assert.equal(await page.locator('[data-testid="consent-banner"]').count(), 0);
    ok("P1-11", "a refusal is a decision: the notice does not come back on the next page load");

    // ------------------------------------------------------------------ notice version bump
    await prisma.tenant.update({
      where: { id: T },
      data: { consentNoticeVersion: { increment: 1 } },
    });
    await page.goto(home, { waitUntil: "networkidle" });
    await page.locator('[data-testid="consent-banner"]').waitFor();
    ok("P1-11", "bumping the notice version asks a visitor who already answered to answer again");

    // ------------------------------------------------------------------ advertising only
    log.reset();
    await page.locator('[data-testid="consent-manage"]').click();
    await page.locator('[data-testid="consent-category-advertising"]').check();
    await page.locator('[data-testid="consent-save"]').click();
    await page.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle");
    const afterAds = trackersIn(log);
    assert.ok(
      afterAds.some((u) => u.includes("connect.facebook.net")),
      `Meta should load once advertising is granted; saw ${afterAds.join(", ")}`,
    );
    assert.deepEqual(
      afterAds.filter((u) => u.includes("google-analytics.com/g/collect")),
      [],
      "GA4 was not granted",
    );
    ok("P1-06", "granting advertising alone loads Meta and Google Ads and not GA4");

    // ------------------------------------------------------------------ commerce after refusal
    const refuser = await context.newPage();
    await refuser.goto(home);
    // A fresh page shares the context's cookie, so clear the decision for this leg.
    await context.clearCookies({ name: (await consentCookies(context))[0]?.name });
    await refuser.goto(home, { waitUntil: "networkidle" });
    await refuser.locator('[data-testid="consent-reject"]').click();
    await refuser.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });

    await refuser.goto(`${home}/products/${product.slug}`, { waitUntil: "networkidle" });
    await refuser.locator('[data-testid="add-to-cart-button"]').click();
    await refuser.goto(`${home}/checkout`, { waitUntil: "networkidle" });
    await refuser.fill("#co-customerName", "Refusing Shopper");
    await refuser.fill("#co-customerPhone", "+961 70 000 000");
    await refuser.fill("#co-customerAddress", "1 Privacy Street");
    await refuser.fill("#co-deliveryLocation", "https://maps.example.com/?q=privacy");
    await Promise.all([
      refuser.waitForURL(/order-confirmation/),
      refuser.locator('button[type="submit"]').last().click(),
    ]);
    const orders = await prisma.order.count({ where: { tenantId: T } });
    assert.equal(orders, 1, "a refusing shopper must still be able to order");
    const whatsapp = await refuser.locator('a[href*="wa.me"]').count();
    ok("P1-20", `a shopper who refused completed a real order (WhatsApp links present: ${whatsapp})`);
    await refuser.close();

    // ------------------------------------------------------------------ mobile + screenshots
    const mobile = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
    });
    const mobileLog = await instrument(mobile);
    const mPage = await mobile.newPage();
    const shotTemplates = ["minimal", "fashion", "atelier"] as const;
    const shots: string[] = [];

    for (const template of shotTemplates) {
      await setTenantTemplate(T, template);
      for (const locale of ["en", "ar"] as const) {
        await prisma.tenant.update({ where: { id: T }, data: { defaultLocale: locale } });
        await mobile.clearCookies();
        await mPage.goto(home, { waitUntil: "networkidle" });
        const bannerEl = mPage.locator('[data-testid="consent-banner"]');
        await bannerEl.waitFor();

        const overflow = await mPage.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1, `${template}/${locale}: ${overflow}px of horizontal overflow`);

        const box = await bannerEl.boundingBox();
        assert.ok(box && box.width <= 375, `${template}/${locale}: notice wider than the screen`);

        const path = `${SHOTS}/consent-${template}-${locale}-375.png`;
        await mPage.screenshot({ path, fullPage: false });
        shots.push(path);
      }
    }
    assert.deepEqual(trackersIn(mobileLog), [], "mobile run leaked tracking before consent");
    ok(
      "P1-19",
      `at 375px the notice fits with no horizontal overflow on ${shotTemplates.length} templates`,
    );
    ok("P1-36", `saved ${shots.length} EN/AR mobile screenshots: ${shots.join(", ")}`);
    await mobile.close();

    // ------------------------------------------------------------------ custom domain
    // A real hostname, resolved by Chrome itself rather than by editing the machine's hosts
    // file: --host-resolver-rules needs no elevation and leaves nothing behind.
    const domain = "consent-e2e.test";
    await prisma.tenant.update({ where: { id: T }, data: { domain, defaultLocale: "en" } });
    const port = new URL(BASE).port || "80";
    const domainBrowser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [`--host-resolver-rules=MAP ${domain} 127.0.0.1`],
    });
    try {
      const dContext = await domainBrowser.newContext({ viewport: { width: 1280, height: 800 } });
      const dLog = await instrument(dContext);
      const dPage = await dContext.newPage();
      const origin = `http://${domain}:${port}`;

      await dPage.goto(`${origin}/privacy`, { waitUntil: "networkidle" });
      await dPage.locator('[data-testid="privacy-page"]').waitFor();
      const privacyText = await dPage.locator('[data-testid="privacy-page"]').innerText();
      assert.ok(
        privacyText.includes("Consent Test Ltd"),
        "the privacy page must name the responsible business",
      );
      assert.ok(
        /jointly responsible|Platform/i.test(privacyText),
        "the privacy page must describe the joint-controller arrangement",
      );
      ok("P1-35", `/privacy works on a custom domain (${origin}/privacy) and names both controllers`);

      await dPage.locator('[data-testid="privacy-language-switch"]').click();
      await dPage.waitForURL(/lang=ar/);
      assert.ok(
        /[؀-ۿ]/.test(await dPage.locator('[data-testid="privacy-page"]').innerText()),
        "the privacy page must switch to Arabic",
      );
      ok("P1-35", "the privacy page reads in Arabic without a consent decision being needed");

      assert.deepEqual(trackersIn(dLog), [], "tracking fired on the custom domain before consent");
      await dPage.goto(origin, { waitUntil: "networkidle" });
      await dPage.locator('[data-testid="consent-accept-all"]').click();
      await dPage.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });

      const dCookie = (await consentCookies(dContext))[0];
      assert.ok(dCookie, "the custom-domain visitor must get a consent cookie");
      assert.equal(dCookie.domain, domain, "the cookie belongs to the store's own domain");
      assert.equal(dCookie.path, "/", "a custom domain's root IS the store");
      assert.equal(dCookie.secure, false, "a plaintext host cannot receive a Secure cookie");
      assert.equal(dCookie.httpOnly, true);
      ok("P1-34", `on ${domain} the cookie is scoped to "/" for that host alone, HttpOnly, not Secure`);

      await dPage.goto(origin, { waitUntil: "networkidle" });
      assert.equal(await dPage.locator('[data-testid="consent-banner"]').count(), 0);
      ok("P1-34", "the custom-domain decision persists across a reload");
    } finally {
      await domainBrowser.close();
      await prisma.tenant.update({ where: { id: T }, data: { domain: null } });
    }
  } finally {
    await context.close();
    await browser.close();
    await store.remove();
    await prisma.$disconnect();
  }
}

main()
  .then(() => console.log(`\n${checks} checks passed.`))
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => {});
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
