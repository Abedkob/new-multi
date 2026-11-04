/**
 * Phase 2 analytics, in a real browser plus a real load generator (pnpm e2e:analytics).
 *
 * Built before the tracker is wired into any storefront, because the claim it tests is the one
 * the whole design rests on: ANALYTICS CANNOT STARVE CHECKOUT. A separate pool is only a
 * sentence in a plan until something saturates it and a shopper still gets their order through.
 *
 * P2-30 does exactly that:
 *   1. Place a real order with the system idle, and time it. That is the baseline.
 *   2. Saturate ingestion with hundreds of concurrent batches.
 *   3. Place another real order while that is still in flight, and time it.
 *   4. Sample pg_stat_activity throughout, counting connections by application_name.
 *
 * The evidence is numbers, not absence of errors: how many connections analytics ever held
 * (must stay at or under its pool size), and how much slower checkout got (must be barely).
 *
 * Needs a running server started with ANALYTICS_ROLLOUT_MODE=all, and Chrome.
 *   pnpm exec next dev --port 3100            # with ANALYTICS_ROLLOUT_MODE=all in the env
 *   BASE_URL=http://localhost:3100 pnpm e2e:analytics
 */

import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { parse as parseEnvFile } from "dotenv";
import { readFileSync } from "node:fs";
import { chromium, type Cookie, type Page, type Route } from "playwright-core";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { createProduct } from "../../lib/data/products";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPathForSlug,
  type AnalyticsEnvelope,
  type AnalyticsEventType,
} from "../../lib/analytics/contract";
import { mintBootstrapToken } from "../../lib/analytics/token";
import { PRODUCTION_BUILD_HINT, assertDevOriginAllowed, onCustomDomain } from "./custom-domain";
import { ANALYTICS_APPLICATION_NAME } from "../../lib/prisma-analytics";
import {
  buildStoredConsent,
  consentCookieName,
  encodeConsent,
} from "../../lib/consent/cookie";
import { GRANT_ALL } from "../../lib/consent/types";
import { env } from "../../lib/env";
import { BASE, launch, login, makeStore } from "./browser";

/** How many batches to fire at once. Comfortably more than the pool and the ceiling together. */
const SATURATION_BATCHES = 200;
const EVENTS_PER_BATCH = 10;

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

/** A synthetic batch, signed the way a real browser's would be. */
function envelopeFor(tenantId: string): AnalyticsEnvelope {
  const now = Date.now();
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    sentAt: now,
    token: mintBootstrapToken(tenantId),
    events: Array.from({ length: EVENTS_PER_BATCH }, () => ({
      eventId: randomUUID(),
      type: "PAGE_VIEW" as const,
      occurredAt: now,
      pageKind: "home" as const,
    })),
  };
}

/**
 * Phase 3 in a real browser: the funnel in order, the WhatsApp button, and an order that
 * carries where it came from.
 *
 * All of it needs a browser rather than a script, because what is under test is what the PAGE
 * does: which events a real journey emits, once each; that a click which navigates away still
 * gets sent; and that the attribution an order records is the one the browser's own cookies
 * resolve to. Phase 2 learned this the hard way — the ingestion endpoint sat outside the
 * consent cookie's path, every batch was silently discarded, and only a browser could see it.
 */
async function phase3() {
  const store = await makeStore("Funnel");
  const T = store.tenant.id;
  const slug = store.tenant.slug;

  await prisma.tenant.update({
    where: { id: T },
    data: {
      privacyControllerName: "Funnel Test Ltd",
      privacyEmail: "privacy@funnel.test",
      analyticsTimezone: "Asia/Beirut",
      defaultLocale: "en",
      // So the product page renders its WhatsApp order button.
      whatsappNumber: "96170123456",
    },
  });

  const category = await createCategory(T, { name: "Funnel", parentId: null });
  const product = await createProduct(T, {
    name: "Funnel Item",
    description: "For the funnel checks",
    basePriceCents: 2000,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: category.id,
    variants: [{ attributes: {}, stock: 20, priceCentsOverride: null, imageUrl: null }],
  });
  const variantId = product.variants[0].id;

  const countType = (type: AnalyticsEventType) =>
    prisma.analyticsEvent.count({ where: { tenantId: T, type } });
  /** One flush interval plus a margin: the tracker sends every 10s. */
  const flush = (page: Page) => page.waitForTimeout(12_000);

  const { browser, context } = await launch();
  // The WhatsApp link really does point at wa.me. Stop the browser leaving for it, so a run
  // never depends on the internet, while the click itself stays a genuine click.
  await context.route("**wa.me/**", (route: Route) => route.abort());
  const page = await context.newPage();
  const home = `${BASE}/store/${slug}`;
  const productUrl = `${home}/products/${product.slug}`;

  try {
    // ---------------------------------------------------------------- a whole journey
    // Landing with campaign parameters, so the session has a source to give the order later.
    await page.goto(`${home}?utm_source=newsletter&utm_medium=email&utm_campaign=nov`, {
      waitUntil: "load",
    });
    await page.locator('[data-testid="consent-accept-all"]').click();
    await page.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });
    await flush(page);

    await page.goto(productUrl, { waitUntil: "load" });
    await page.locator('[data-testid="add-to-cart-button"]').waitFor();
    await flush(page);
    assert.equal(await countType("PRODUCT_VIEW"), 1, "one product view for one product page");

    // Reloading is not a new shopper. Two more views, still one session.
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-testid="add-to-cart-button"]').waitFor();
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-testid="add-to-cart-button"]').waitFor();
    await flush(page);
    const sessions = await prisma.analyticsSession.count({ where: { tenantId: T } });
    const views = await countType("PRODUCT_VIEW");
    assert.equal(sessions, 1, `refreshing created ${sessions} sessions`);
    assert.equal(views, 3, `expected three product views, got ${views}`);
    ok("P3-08", `three visits to one product page: ${views} views, still ${sessions} session`);

    // Add, then remove from the cart page, then add again. The remove must be counted once and
    // only once, from an entry point that is not the one the add came from.
    await page.locator('[data-testid="add-to-cart-button"]').click();
    await Promise.all([
      page.waitForURL(/\/cart$/),
      page.locator('[data-testid="cart-link"]').first().click(),
    ]);
    await page.waitForSelector('[data-testid="cart-line"]');
    await flush(page);
    assert.equal(await countType("ADD_TO_CART"), 1);
    assert.equal(await countType("CART_VIEW"), 1, "one cart view for one visit to the cart");

    await page.locator('[data-testid="cart-remove"]').first().click();
    await page.locator('[data-testid="cart-empty"]').waitFor();
    await flush(page);
    const removals = await countType("REMOVE_FROM_CART");
    assert.equal(removals, 1, `removing one line emitted ${removals} events`);
    ok("P3-10", "removing a line from the cart page emits exactly one REMOVE_FROM_CART");

    await page.goto(productUrl, { waitUntil: "load" });
    await page.locator('[data-testid="add-to-cart-button"]').click();
    await Promise.all([
      page.waitForURL(/\/cart$/),
      page.locator('[data-testid="cart-link"]').first().click(),
    ]);
    await page.waitForSelector('[data-testid="cart-line"]');
    await Promise.all([page.waitForURL(/\/checkout$/), page.click('[data-testid="go-to-checkout"]')]);
    await flush(page);

    // The order has NOT been submitted yet. That is the whole point of this step.
    const startedBeforeSubmit = await countType("CHECKOUT_STARTED");
    const ordersBeforeSubmit = await prisma.order.count({ where: { tenantId: T } });
    assert.equal(startedBeforeSubmit, 1, `expected one CHECKOUT_STARTED, got ${startedBeforeSubmit}`);
    assert.equal(ordersBeforeSubmit, 0, "no order should exist yet");
    ok(
      "P3-09",
      "CHECKOUT_STARTED is recorded on arrival at checkout with a full cart, before any submit",
    );

    await page.fill("#co-customerName", "Funnel Shopper");
    await page.fill("#co-customerPhone", "+961 70 000 000");
    await page.fill("#co-customerAddress", "1 Funnel Street");
    await page.fill("#co-deliveryLocation", "https://maps.example.com/?q=funnel");
    await Promise.all([
      page.waitForURL(/order-confirmation/),
      page.locator('button[type="submit"]').last().click(),
    ]);

    const steps: AnalyticsEventType[] = [
      "PRODUCT_VIEW",
      "ADD_TO_CART",
      "CART_VIEW",
      "REMOVE_FROM_CART",
      "CHECKOUT_STARTED",
    ];
    const ordered = await prisma.analyticsEvent.findMany({
      where: { tenantId: T, type: { in: steps } },
      orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }],
      select: { type: true },
    });
    const sequence = ordered.map((row) => row.type);
    // Product views repeat (three page visits); the rest happen once, in this order.
    const firstOf = (type: AnalyticsEventType) => sequence.indexOf(type);
    assert.ok(firstOf("PRODUCT_VIEW") < firstOf("ADD_TO_CART"), "a view precedes an add");
    assert.ok(firstOf("ADD_TO_CART") < firstOf("CART_VIEW"), "an add precedes the cart");
    assert.ok(firstOf("CART_VIEW") < firstOf("CHECKOUT_STARTED"), "the cart precedes checkout");
    assert.equal(await countType("ADD_TO_CART"), 2, "two adds: one before the removal, one after");
    assert.equal(await countType("CHECKOUT_STARTED"), 1);
    ok("P3-06", `one journey emitted the funnel in order: ${sequence.join(" -> ")}`);

    // ---------------------------------------------------------------- the order knows its origin
    const order = await prisma.order.findFirstOrThrow({ where: { tenantId: T } });
    const session = await prisma.analyticsSession.findFirstOrThrow({ where: { tenantId: T } });
    assert.equal(order.analyticsSessionId, session.id, "the order must name the session that placed it");
    assert.equal(order.attributionSource, "newsletter");
    assert.equal(order.attributionMedium, "email");
    assert.equal(order.attributionCampaign, "nov");
    assert.equal(order.isReturningVisitor, false, "a first-time visitor is not returning");
    assert.ok(order.analyticsDeviceClass, "the device class should be recorded");
    ok(
      "P3-14",
      `a real checkout recorded its session, source "${order.attributionSource}", campaign ` +
        `"${order.attributionCampaign}", device ${order.analyticsDeviceClass} and ` +
        `isReturningVisitor=${order.isReturningVisitor}`,
    );

    // ---------------------------------------------------------------- WhatsApp
    await page.goto(productUrl, { waitUntil: "load" });
    const whatsappLink = page.locator('[data-testid="whatsapp-button"]');
    await whatsappLink.waitFor();
    const href = await whatsappLink.getAttribute("href");
    assert.ok(href?.startsWith("https://wa.me/"), `the WhatsApp link is wrong: ${href}`);
    await whatsappLink.click();
    // Beaconed immediately, so this needs no flush interval.
    await page.waitForTimeout(2_000);
    const click = await prisma.analyticsEvent.findFirstOrThrow({
      where: { tenantId: T, type: "WHATSAPP_ORDER_CLICK" },
    });
    assert.equal(click.productId, product.id);
    assert.equal(click.variantId, variantId);
    assert.equal(click.quantity, 1);
    assert.equal(click.valueCents, 2000, `the server should have priced it, got ${click.valueCents}`);
    ok(
      "P3-11",
      `clicking Order on WhatsApp recorded the product, the variant, quantity 1 and a ` +
        `server-computed value of ${click.valueCents} cents`,
    );

    // ---------------------------------------------------------------- the link outlives analytics
    const refusing = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await refusing.route("**wa.me/**", (route: Route) => route.abort());
    const refusingPage = await refusing.newPage();
    const refusedCalls: string[] = [];
    refusingPage.on("request", (r) => {
      if (r.url().includes("/analytics/events")) refusedCalls.push(r.url());
    });
    await refusingPage.goto(productUrl, { waitUntil: "load" });
    await refusingPage.locator('[data-testid="consent-reject"]').click();
    const refusedLink = refusingPage.locator('[data-testid="whatsapp-button"]');
    await refusedLink.waitFor();
    const refusedHref = await refusedLink.getAttribute("href");
    const clicksBefore = await countType("WHATSAPP_ORDER_CLICK");
    await refusedLink.click();
    await refusingPage.waitForTimeout(3_000);
    assert.ok(refusedHref?.startsWith("https://wa.me/"), "the link must work without analytics");
    assert.deepEqual(refusedCalls, [], "a refusing visitor must send nothing, click or no click");
    assert.equal(await countType("WHATSAPP_ORDER_CLICK"), clicksBefore);
    await refusing.close();
    ok(
      "P3-12",
      "with consent refused the WhatsApp link is still there and still opens, and the click " +
        "records nothing",
    );

    // ---------------------------------------------------------------- checkout outlives analytics
    // A real fault, injected from outside the app: the role the server connects as loses the
    // right to read the analytics tables. Attribution resolution then fails for real, on the
    // live request, in the middle of a checkout.
    const owner = new Client({ connectionString: process.env.DATABASE_URL });
    await owner.connect();
    let revoked = false;
    try {
      await owner.query('REVOKE SELECT ON "AnalyticsSession" FROM app_user');
      revoked = true;
      const brokenPage = await context.newPage();
      await brokenPage.goto(productUrl, { waitUntil: "load" });
      await brokenPage.locator('[data-testid="add-to-cart-button"]').click();
      await Promise.all([
        brokenPage.waitForURL(/\/cart$/),
        brokenPage.locator('[data-testid="cart-link"]').first().click(),
      ]);
      await brokenPage.waitForSelector('[data-testid="cart-line"]');
      await Promise.all([
        brokenPage.waitForURL(/\/checkout$/),
        brokenPage.click('[data-testid="go-to-checkout"]'),
      ]);
      await brokenPage.fill("#co-customerName", "Blind Shopper");
      await brokenPage.fill("#co-customerPhone", "+961 70 000 001");
      await brokenPage.fill("#co-customerAddress", "2 Funnel Street");
      await brokenPage.fill("#co-deliveryLocation", "https://maps.example.com/?q=blind");
      const started = Date.now();
      await Promise.all([
        brokenPage.waitForURL(/order-confirmation/),
        brokenPage.locator('button[type="submit"]').last().click(),
      ]);
      const tookMs = Date.now() - started;
      await brokenPage.close();
      const blind = await prisma.order.findFirstOrThrow({
        where: { tenantId: T, customerName: "Blind Shopper" },
      });
      assert.equal(blind.analyticsSessionId, null, "a failed resolution must record nothing");
      assert.equal(blind.attributionSource, null);
      ok(
        "P3-19",
        `with the analytics tables unreadable, the order still completed in ${tookMs}ms and ` +
          "recorded no attribution",
      );
    } finally {
      if (revoked) await owner.query('GRANT SELECT ON "AnalyticsSession" TO app_user');
      await owner.end().catch(() => {});
    }

    // ---------------------------------------------------------------- the same, on a custom domain
    // A store on its own domain has different cookie paths (/ rather than /store/<slug>), and
    // Phase 2's worst bug was exactly a cookie that never reached the server. So the order's
    // attribution is proved again there, on a hostname Chrome resolves itself.
    const domain = "analytics-e2e.test";
    const port = new URL(BASE).port || "80";
    // Fail here, loudly, rather than twenty assertions later for a reason that has nothing to
    // do with the feature: without this hostname in allowedDevOrigins, next dev serves the page
    // and withholds its JavaScript.
    assertDevOriginAllowed(domain);
    await prisma.tenant.update({ where: { id: T }, data: { domain } });
    const domainBrowser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [`--host-resolver-rules=MAP ${domain} 127.0.0.1`],
    });
    try {
      const dContext = await domainBrowser.newContext({ viewport: { width: 1280, height: 800 } });
      await dContext.route("**wa.me/**", (route: Route) => route.abort());
      const dPage = await dContext.newPage();
      const origin = `http://${domain}:${port}`;
      await dPage.goto(`${origin}/?utm_source=domain-newsletter&utm_medium=email`, {
        waitUntil: "load",
      });
      await dPage.locator('[data-testid="consent-accept-all"]').click();
      await dPage.waitForTimeout(1_000);
      const decided = (await dContext.cookies(origin)).some((c: Cookie) =>
        c.name.startsWith("store_consent_"),
      );
      // A leg that cannot run is a FAILURE — never a pass, never a quiet line of output. Not
      // running is how two phases of custom-domain data loss stayed invisible behind a green
      // suite. scripts/e2e/custom-domain.ts carries the policy and the two innocent causes.
      assert.ok(decided, `P3-14 on ${domain}: ${PRODUCTION_BUILD_HINT}`);
      {
        await dPage.goto(`${origin}/products/${product.slug}`, { waitUntil: "load" });
        await dPage.locator('[data-testid="add-to-cart-button"]').click();
        await dPage.waitForTimeout(12_000);
        await Promise.all([
          dPage.waitForURL(/\/cart$/),
          dPage.locator('[data-testid="cart-link"]').first().click(),
        ]);
        await dPage.waitForSelector('[data-testid="cart-line"]');
        await Promise.all([
          dPage.waitForURL(/\/checkout$/),
          dPage.click('[data-testid="go-to-checkout"]'),
        ]);
        await dPage.fill("#co-customerName", "Domain Shopper");
        await dPage.fill("#co-customerPhone", "+961 70 000 002");
        await dPage.fill("#co-customerAddress", "3 Funnel Street");
        await dPage.fill("#co-deliveryLocation", "https://maps.example.com/?q=domain");
        await Promise.all([
          dPage.waitForURL(/order-confirmation/),
          dPage.locator('button[type="submit"]').last().click(),
        ]);
        const domainOrder = await prisma.order.findFirstOrThrow({
          where: { tenantId: T, customerName: "Domain Shopper" },
        });
        assert.ok(domainOrder.analyticsSessionId, "the custom-domain order recorded no session");
        assert.equal(domainOrder.attributionSource, "domain-newsletter");
        assert.equal(domainOrder.attributionMedium, "email");
        ok(
          "P3-14",
          `on ${domain} an order recorded its session and source "${domainOrder.attributionSource}" ` +
            "with cookies scoped to / instead of /store/<slug>",
        );
      }
    } finally {
      await domainBrowser.close();
      await prisma.tenant.update({ where: { id: T }, data: { domain: null } });
    }
  } finally {
    await context.close();
    await browser.close();
    await store.remove();
  }
}

/**
 * Phase 4's search legs (P4-09, P4-10, P4-13), in a real browser because every claim here is
 * about what a shopper's typing does and nothing else can prove it.
 *
 *   PHASE4_ONLY=1 BASE_URL=http://localhost:3300 pnpm e2e:analytics
 */
/**
 * Types into a search box and makes sure the box kept what was typed.
 *
 * A server-rendered input exists in the DOM before React has hydrated it, and a controlled
 * input that hydrates mid-typing is reset to its initial state — so the characters land, the
 * form submits an empty query, and the failure looks like a bug in the feature rather than a
 * race in the check. `waitFor()` does not help: the element is already there.
 *
 * So this types, reads the value back, and types again if the field was reset. It cost a run to
 * learn, and only on a cold dev server, which is exactly the kind of flake that gets explained
 * away as "probably fine".
 */
async function typeSearch(page: Page, selector: string, term: string) {
  const box = page.locator(selector).first();
  await box.waitFor();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await box.fill("");
    // Character by character, with a human-ish gap: the claim under test is that a suggestion
    // fetch per keystroke does NOT become an event per keystroke.
    await box.pressSequentially(term, { delay: 120 });
    if ((await box.inputValue()) === term) return box;
    await page.waitForTimeout(500 * attempt);
  }
  throw new Error(
    `the search box would not keep "${term}" (it reset to "${await box.inputValue()}") — the ` +
      "page is probably not hydrated yet",
  );
}

async function phase4() {
  const store = await makeStore("Search");
  const T = store.tenant.id;
  const slug = store.tenant.slug;

  await prisma.tenant.update({
    where: { id: T },
    data: {
      privacyControllerName: "Search Test Ltd",
      privacyEmail: "privacy@search.test",
      analyticsTimezone: "Asia/Beirut",
      defaultLocale: "en",
    },
  });

  const category = await createCategory(T, { name: "Search", parentId: null });
  const product = await createProduct(T, {
    name: "Searchable Jacket",
    description: "For the search checks",
    basePriceCents: 4000,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: category.id,
    variants: [{ attributes: {}, stock: 10, priceCentsOverride: null, imageUrl: null }],
  });

  const searches = () =>
    prisma.analyticsEvent.findMany({
      where: { tenantId: T, type: { in: ["SEARCH_SUBMITTED", "SEARCH_RESULT_CLICK"] } },
      select: { type: true, searchQuery: true, resultCount: true, productId: true },
      orderBy: { receivedAt: "asc" },
    });
  const flush = (page: Page) => page.waitForTimeout(12_000);

  const { browser, context } = await launch();
  const page = await context.newPage();
  const home = `${BASE}/store/${slug}`;

  try {
    await page.goto(home, { waitUntil: "load" });
    await page.locator('[data-testid="consent-accept-all"]').click();
    await page.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });

    // ------------------------------------------------- P4-09: one submit, not one per keystroke
    // Typed character by character, the way a shopper types, through the navbar's own control.
    const box = await typeSearch(page, 'header input[type="search"]', "jacket");
    await page.waitForTimeout(1_500); // long enough for the suggestion fetch AND its settle timer
    await Promise.all([page.waitForURL(/\/search\?q=jacket/), box.press("Enter")]);
    await page.locator('[data-testid="catalog-page"]').waitFor();
    await flush(page);

    const typed = await searches();
    assert.equal(
      typed.length,
      1,
      `typing "jacket" must emit exactly one search, not one per keystroke: ${JSON.stringify(typed)}`,
    );
    assert.equal(typed[0].type, "SEARCH_SUBMITTED");
    assert.equal(typed[0].searchQuery, "jacket");
    assert.equal(typed[0].resultCount, 1);
    ok("P4-09", 'typing "jacket" one letter at a time emitted one SEARCH_SUBMITTED, with 1 result');

    // ------------------------------------------------------- P4-13: which result was clicked
    await Promise.all([
      page.waitForURL(new RegExp(`/products/${product.slug}`)),
      page.locator(`[data-testid="catalog-page"] a[href$="/products/${product.slug}"]`).first().click(),
    ]);
    await page.waitForTimeout(2_000); // the click beacons immediately
    const clicked = (await searches()).find((e) => e.type === "SEARCH_RESULT_CLICK");
    assert.ok(clicked, "a result click must be recorded");
    assert.equal(clicked.productId, product.id, "the click must name the product that was clicked");
    assert.equal(clicked.searchQuery, "jacket", "the click must carry the search it came from");
    ok("P4-13", "clicking a result recorded the product and the phrase it was found by");

    // ------------------------------------------ P4-10: a no-result phrase, reported once
    // Typed and abandoned — never submitted. This is the search a merchant most wants to see,
    // and the only one allowed to come from the suggestion panel.
    await prisma.analyticsEvent.deleteMany({ where: { tenantId: T } });
    const page2 = await context.newPage();
    await page2.goto(home, { waitUntil: "load" });
    await typeSearch(page2, 'header input[type="search"]', "umbrella");
    await page2.waitForTimeout(2_000);
    await flush(page2);

    const none = await searches();
    assert.equal(
      none.length,
      1,
      `an abandoned no-result search must be reported exactly once: ${JSON.stringify(none)}`,
    );
    assert.equal(none[0].searchQuery, "umbrella");
    assert.equal(none[0].resultCount, 0);
    ok("P4-10", 'typing "umbrella" and never submitting reported one no-result search');
    await page2.close();

    // ------------------------------------- the privacy identifier, and the console that uses it
    // §4.7 wants the shopper able to ask about their own data, and D36 puts the answering in the
    // platform admin's hands. Both halves are exercised here because they only work together: an
    // id nobody can see is useless, and a console that cannot resolve one is worse.
    const idPage = await context.newPage();
    await idPage.goto(`${home}/privacy`, { waitUntil: "load" });
    const shown = await idPage.locator('[data-testid="privacy-measurement-id"]').innerText();
    const visitorRow = await prisma.analyticsVisitor.findFirstOrThrow({ where: { tenantId: T } });
    assert.equal(shown.trim(), visitorRow.id, "the privacy page must show this browser's own id");
    ok("P4-26", "the shopper's measurement id is shown on /privacy and matches their visitor row");

    // The platform admin resolves that id, and only a platform admin can.
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    assert.ok(
      adminEmail && adminPassword,
      "PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are needed to exercise the console",
    );
    const adminPage = await context.newPage();
    await login(adminPage, adminEmail, adminPassword);
    await adminPage.goto(`${BASE}/platform/stores/${slug}/privacy`, { waitUntil: "load" });
    await adminPage.locator('[data-testid="privacy-request-control"]').waitFor();
    await adminPage.fill('input[name="visitorId"]', visitorRow.id);
    await adminPage.click('button:has-text("Look up")');
    await adminPage.locator('[data-testid="privacy-request-summary"]').waitFor();
    const summaryText = await adminPage.locator('[data-testid="privacy-request-summary"]').innerText();
    assert.match(summaryText, /Sessions \/ events/, "the summary must say how much there is");
    assert.match(summaryText, /kept/i, "and must say the linked orders are kept");
    // Looking is itself an access to personal data, so it must already be logged.
    const logged = await prisma.analyticsAuditLog.findFirst({
      where: { tenantId: T, action: "PRIVACY_SUMMARY" },
      orderBy: { at: "desc" },
    });
    assert.ok(logged, "a lookup must be audit-logged, not only an erasure");
    assert.equal(logged.subject, visitorRow.id);
    assert.equal(logged.actorEmail, adminEmail);
    ok("P4-26a", `the platform console resolved the id and logged the lookup as ${adminEmail}`);

    // The owner of this very store must not be able to reach that page at all.
    // Its own context, because this one is signed in as the platform admin and /login would
    // simply redirect — the check would then "pass" without ever having been an owner.
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ownerPage = await ownerContext.newPage();
    await login(ownerPage, store.user.email, store.password);
    const ownerResponse = await ownerPage.goto(`${BASE}/platform/stores/${slug}/privacy`, {
      waitUntil: "load",
    });
    assert.ok(
      !ownerPage.url().includes("/platform/stores/"),
      `a store owner reached the platform privacy console: ${ownerPage.url()} (${ownerResponse?.status()})`,
    );
    assert.equal(
      await ownerPage.locator('[data-testid="privacy-request-control"]').count(),
      0,
      "the console must not render for a store owner",
    );
    ok("P4-26a", `a store owner asking for the console was sent to ${new URL(ownerPage.url()).pathname}`);

    // ------------------------------------------------- the link builder, in the owner's hands
    // Structural movability is checked in verify:acquisition; what a browser adds is that the
    // thing actually builds a usable link for the store it is open on.
    await ownerPage.goto(`${BASE}/admin/analytics/links`, { waitUntil: "load" });
    await ownerPage.locator('[data-testid="link-builder"]').waitFor();
    await ownerPage.selectOption('[data-testid="link-builder-channel"]', "instagram");
    await ownerPage.fill('[data-testid="link-builder-campaign"]', "Eid Sale 2026");
    await ownerPage.fill('[data-testid="link-builder-content"]', "Story 1");
    const built = await ownerPage.locator('[data-testid="link-builder-url"]').inputValue();
    const builtUrl = new URL(built);
    assert.equal(builtUrl.searchParams.get("utm_source"), "instagram");
    assert.equal(builtUrl.searchParams.get("utm_medium"), "social");
    assert.equal(
      builtUrl.searchParams.get("utm_campaign"),
      "eid-sale-2026",
      "a campaign name a person typed must be normalized, or two spellings become two campaigns",
    );
    assert.equal(builtUrl.searchParams.get("utm_content"), "story-1");
    assert.equal(
      builtUrl.pathname,
      `/store/${slug}`,
      `the link must point at this store, got ${built}`,
    );
    // The ORIGIN is PLATFORM_BASE_URL, not this test server: the builder hands a merchant a
    // link to paste in public, so it must use the store's real public origin rather than
    // whatever port a check happens to run on. Which is exactly why the visit below is made
    // against BASE with the built path and query — the part the builder is responsible for.
    const linkPage = await ownerContext.newPage();
    await linkPage.goto(`${BASE}${builtUrl.pathname}${builtUrl.search}`, { waitUntil: "load" });
    await linkPage.locator('[data-testid="consent-accept-all"]').click();
    await linkPage.waitForTimeout(12_000);
    const fromLink = await prisma.analyticsSession.findFirst({
      where: { tenantId: T, source: "instagram" },
      orderBy: { startedAt: "desc" },
    });
    assert.ok(fromLink, "a visit through the built link must record its campaign");
    assert.equal(fromLink.sourceKind, "campaign");
    assert.equal(fromLink.medium, "social");
    assert.equal(fromLink.campaign, "eid-sale-2026");
    await linkPage.close();
    ok("P4-35", "a link built in the admin recorded instagram / social / eid-sale-2026 when used");

    await idPage.close();
    await adminPage.close();
    await ownerContext.close();

    // ----------------------------------------------------------- the same, on a custom domain
    // Mandatory since 2026-11-04 (scripts/e2e/custom-domain.ts): a leg that cannot run FAILS.
    const domain = "analytics-e2e.test";
    assertDevOriginAllowed(domain);
    await prisma.tenant.update({ where: { id: T }, data: { domain } });
    await prisma.analyticsEvent.deleteMany({ where: { tenantId: T } });
    try {
      await onCustomDomain(domain, async ({ context: dContext, origin }) => {
        const dPage = await dContext.newPage();
        await dPage.goto(origin, { waitUntil: "load" });
        await dPage.locator('[data-testid="consent-accept-all"]').click();
        await dPage.waitForTimeout(1_000);
        const decided = (await dContext.cookies(origin)).some((c: Cookie) =>
          c.name.startsWith("store_consent_"),
        );
        assert.ok(decided, `P4-09 on ${domain}: ${PRODUCTION_BUILD_HINT}`);

        const dBox = await typeSearch(dPage, 'header input[type="search"]', "jacket");
        await dPage.waitForTimeout(1_500);
        await Promise.all([dPage.waitForURL(/\/search\?q=jacket/), dBox.press("Enter")]);
        await dPage.locator('[data-testid="catalog-page"]').waitFor();
        await flush(dPage);

        const onDomain = await searches();
        assert.equal(
          onDomain.length,
          1,
          `one search on a custom domain too: ${JSON.stringify(onDomain)}`,
        );
        assert.equal(onDomain[0].searchQuery, "jacket");
        assert.equal(onDomain[0].resultCount, 1);
        ok("P4-09", `on ${domain} the same typing emitted one search, with cookies scoped to /`);
      });
    } finally {
      await prisma.tenant.update({ where: { id: T }, data: { domain: null } });
    }
  } finally {
    await context.close();
    await browser.close();
    await store.remove();
  }
}

async function main() {
  // The Phase 3 legs alone, for iterating on one of them without paying for the saturation run:
  //   PHASE3_ONLY=1 BASE_URL=http://localhost:3300 pnpm e2e:analytics
  if (process.env.PHASE3_ONLY) {
    await phase3();
    return;
  }
  if (process.env.PHASE4_ONLY) {
    await phase4();
    return;
  }

  const store = await makeStore("Analytics");
  const T = store.tenant.id;
  const slug = store.tenant.slug;

  await prisma.tenant.update({
    where: { id: T },
    data: {
      privacyControllerName: "Analytics Test Ltd",
      privacyEmail: "privacy@analytics.test",
      analyticsTimezone: "Asia/Beirut",
      defaultLocale: "en",
    },
  });

  const category = await createCategory(T, { name: "Load", parentId: null });
  const product = await createProduct(T, {
    name: "Load Test Item",
    description: "For the pool isolation check",
    basePriceCents: 2500,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: category.id,
    variants: [{ attributes: {}, stock: 50, priceCentsOverride: null, imageUrl: null }],
  });

  // A consent cookie the endpoint will accept, built with the same code the app uses.
  const consentCookie = `${consentCookieName(T)}=${encodeConsent(
    buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
  )}`;
  const endpoint = `${BASE}${analyticsEventsPathForSlug(slug)}`;

  const postBatch = async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: consentCookie },
      body: JSON.stringify(envelopeFor(T)),
    });
    return response.status;
  };

  // Connection sampling, by application_name, straight from Postgres.
  const restricted = parseEnvFile(readFileSync(".env")).APP_DATABASE_URL;
  const monitor = new Client({ connectionString: restricted });
  await monitor.connect();
  const sampleConnections = async () => {
    const { rows } = await monitor.query<{ application_name: string; n: string }>(
      `select coalesce(nullif(application_name, ''), 'app') application_name, count(*) n
         from pg_stat_activity where datname = current_database() group by 1`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.application_name, Number(r.n)]));
    return {
      analytics: byName[ANALYTICS_APPLICATION_NAME] ?? 0,
      total: rows.reduce((sum, r) => sum + Number(r.n), 0),
    };
  };

  const { browser, context } = await launch();
  const page = await context.newPage();
  const home = `${BASE}/store/${slug}`;

  /** The real customer path, click by click, returning how long the submit took. */
  const placeOrder = async (p: Page, who: string): Promise<number> => {
    await p.goto(`${home}/products/${product.slug}`, { waitUntil: "load" });
    await p.locator('[data-testid="add-to-cart-button"]').click();
    await Promise.all([
      p.waitForURL(/\/cart$/),
      p.locator('[data-testid="cart-link"]').first().click(),
    ]);
    await p.waitForSelector('[data-testid="cart-line"]');
    await Promise.all([
      p.waitForURL(/\/checkout$/),
      p.click('[data-testid="go-to-checkout"]'),
    ]);
    await p.fill("#co-customerName", who);
    await p.fill("#co-customerPhone", "+961 70 000 000");
    await p.fill("#co-customerAddress", "1 Load Street");
    await p.fill("#co-deliveryLocation", "https://maps.example.com/?q=load");
    const started = Date.now();
    await Promise.all([
      p.waitForURL(/order-confirmation/),
      p.locator('button[type="submit"]').last().click(),
    ]);
    return Date.now() - started;
  };

  try {
    // ---------------------------------------------------------------- the tracker obeys consent
    // Everything below the consent line is browser-side: what the page actually sends.
    const eventCalls: string[] = [];
    context.on("request", (request) => {
      if (request.url().includes("/analytics/events")) eventCalls.push(request.url());
    });

    await page.goto(home, { waitUntil: "load" });
    await page.locator('[data-testid="consent-banner"]').waitFor();
    await page.waitForTimeout(12_000); // past one flush interval
    assert.deepEqual(eventCalls, [], `events were sent before consent: ${eventCalls.length}`);
    ok("P2-01", "no event request is made before the visitor has chosen (one flush interval)");

    await page.locator('[data-testid="consent-accept-all"]').click();
    await page.locator('[data-testid="consent-banner"]').waitFor({ state: "detached" });
    await page.waitForTimeout(12_000);
    assert.ok(eventCalls.length > 0, "accepting analytics must start collection");
    const storedAfterConsent = await prisma.analyticsEvent.count({ where: { tenantId: T } });
    assert.ok(storedAfterConsent > 0, "a PAGE_VIEW should have been stored");
    ok("P2-01", `after accepting, the tracker sent ${eventCalls.length} batch(es) and PAGE_VIEW rows exist`);

    const beforeWithdraw = eventCalls.length;
    await page.locator('[data-testid="cookie-settings-link"]').first().click();
    await page.locator('[data-testid="consent-manage-dialog"]').waitFor();
    await page.locator('[data-testid="consent-withdraw"]').click();
    await page.locator('[data-testid="consent-manage-dialog"]').waitFor({ state: "hidden" });
    await page.goto(home, { waitUntil: "load" });
    await page.waitForTimeout(12_000);
    assert.equal(
      eventCalls.length,
      beforeWithdraw,
      `${eventCalls.length - beforeWithdraw} batches were sent after withdrawal`,
    );
    ok("P2-02", "withdrawing consent stops collection immediately and nothing further is sent");

    // The platform's analytics kill switch is the same gate the rollout uses, so pausing a
    // store exercises the out-of-rollout path without restarting the server.
    await prisma.tenant.update({
      where: { id: T },
      data: { analyticsPausedAt: new Date(), analyticsPauseReason: "e2e" },
    });
    // The withdrawal above is still in this context's cookies, so start this leg undecided.
    await context.clearCookies();
    const pausedPage = await context.newPage();
    const pausedCalls: string[] = [];
    pausedPage.on("request", (r) => {
      if (r.url().includes("/analytics/events")) pausedCalls.push(r.url());
    });
    await pausedPage.goto(home, { waitUntil: "load" });
    await pausedPage.locator('[data-testid="consent-accept-all"]').click();
    await pausedPage.waitForTimeout(12_000);
    assert.deepEqual(pausedCalls, [], "a paused store must mount no tracker at all");
    await pausedPage.close();
    await prisma.tenant.update({
      where: { id: T },
      data: { analyticsPausedAt: null, analyticsPauseReason: null },
    });
    ok("P2-04", "a store outside collection mounts no tracker, even for a consenting visitor");

    // ---------------------------------------------------------------- Phase 3: the funnel
    // On its own store and its own browser context, so event counts mean what they say and the
    // saturation leg below (which deliberately exhausts limits) cannot interfere.
    await phase3();
    await phase4();

    // Clear the decision so the load section below starts from a clean synthetic identity.
    await context.clearCookies();
    await prisma.analyticsEvent.deleteMany({ where: { tenantId: T } });

    // ---------------------------------------------------------------- the endpoint is live
    const first = await postBatch();
    assert.equal(first, 202, `the endpoint should accept a valid batch, got ${first}`);
    // Give the write a moment, then confirm it actually landed — otherwise the saturation
    // below would be measuring rejections rather than work.
    await new Promise((r) => setTimeout(r, 500));
    const afterFirst = await prisma.analyticsEvent.count({ where: { tenantId: T } });
    assert.ok(
      afterFirst > 0,
      "No events were stored. Is the server running with ANALYTICS_ROLLOUT_MODE=all? " +
        "Collection is gated by the rollout, so an out-of-rollout store accepts and discards.",
    );
    ok("P2-06", `a valid batch returns 202 and persists its events (${afterFirst} rows)`);

    // ---------------------------------------------------------------- idempotency, before load
    // Deliberately before the flood: the flood exhausts the per-IP limit on purpose, and a
    // rate-limited batch is accepted and discarded, which would make this unmeasurable.
    const replayed = envelopeFor(T);
    const sendReplayed = () =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: consentCookie },
        body: JSON.stringify(replayed),
      }).then((r) => r.status);
    assert.equal(await sendReplayed(), 202);
    assert.equal(await sendReplayed(), 202);
    await new Promise((r) => setTimeout(r, 500));
    const duplicated = await prisma.analyticsEvent.count({
      where: { tenantId: T, eventId: { in: replayed.events.map((e) => e.eventId) } },
    });
    assert.equal(duplicated, EVENTS_PER_BATCH, "a replayed batch must not duplicate rows");
    ok("P2-07", `the same batch delivered twice stored ${duplicated} rows, not ${EVENTS_PER_BATCH * 2}`);

    // ---------------------------------------------------------------- baseline, system idle
    // The first pass through these routes compiles them, which has nothing to do with
    // database contention; timing it would make the comparison meaningless in both directions.
    const warmupMs = await placeOrder(page, "Warmup Shopper");
    const idleConnections = await sampleConnections();
    const baselineMs = await placeOrder(page, "Baseline Shopper");
    ok("P2-30", `warm-up order (route compilation) took ${warmupMs}ms and is excluded`);
    ok("P2-30", `baseline: an order placed with analytics idle took ${baselineMs}ms`);

    // ---------------------------------------------------------------- saturate, then order
    let peakAnalytics = 0;
    let peakTotal = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const sample = await sampleConnections();
        peakAnalytics = Math.max(peakAnalytics, sample.analytics);
        peakTotal = Math.max(peakTotal, sample.total);
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    const flood = Promise.all(
      Array.from({ length: SATURATION_BATCHES }, () => postBatch().catch(() => 0)),
    );
    // Let the flood build before the shopper starts, so the order really does compete with it.
    await new Promise((r) => setTimeout(r, 300));

    const underLoadPage = await context.newPage();
    const underLoadMs = await placeOrder(underLoadPage, "Loaded Shopper");
    const statuses = await flood;
    sampling = false;
    await sampler;
    await underLoadPage.close();

    const accepted = statuses.filter((s) => s === 202).length;
    const refused = statuses.length - accepted;

    // 1. Checkout still worked.
    const orders = await prisma.order.count({ where: { tenantId: T } });
    assert.equal(orders, 3, "warm-up, baseline and under-load orders must all exist");
    ok("P2-30", `the order placed under saturation succeeded (${SATURATION_BATCHES} batches concurrent)`);

    // 2. Checkout did not meaningfully slow down. The allowance is generous because this runs
    //    against a dev server, but a pool that was actually shared would blow well past it.
    const budgetMs = baselineMs * 3 + 2000;
    assert.ok(
      underLoadMs <= budgetMs,
      `checkout under load took ${underLoadMs}ms, over the ${budgetMs}ms budget (baseline ${baselineMs}ms)`,
    );
    ok(
      "P2-30",
      `checkout under saturation took ${underLoadMs}ms vs ${baselineMs}ms idle ` +
        `(${(underLoadMs / baselineMs).toFixed(2)}x, budget ${budgetMs}ms)`,
    );

    // 3. The pool held its ceiling. This is the real proof: however hard analytics was pushed,
    //    it never held more connections than its own small allowance.
    assert.ok(
      peakAnalytics <= env.ANALYTICS_DATABASE_POOL_MAX,
      `analytics held ${peakAnalytics} connections, above its pool of ${env.ANALYTICS_DATABASE_POOL_MAX}`,
    );
    ok(
      "P2-30",
      `analytics never exceeded its pool: peak ${peakAnalytics}/${env.ANALYTICS_DATABASE_POOL_MAX} ` +
        `connections (idle ${idleConnections.analytics}, database peak ${peakTotal} total)`,
    );

    // 4. Nothing was reported as a failure to the caller, even where work was dropped.
    assert.equal(refused, 0, `${refused} batches did not return 202`);
    const stored = await prisma.analyticsEvent.count({ where: { tenantId: T } });
    const offered = (SATURATION_BATCHES + 1) * EVENTS_PER_BATCH;
    ok(
      "P2-13",
      `every batch answered 202; ${stored}/${offered} events stored and the rest dropped ` +
        "silently at the concurrency ceiling, which is the designed behaviour for a burst " +
        "this far past capacity (GET /api/internal/analytics-health attributes each drop)",
    );

  } finally {
    await monitor.end().catch(() => {});
    await context.close();
    await browser.close();
    await store.remove();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log(`\n${checks} checks passed.`);
    process.exit(0);
  })
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => {});
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
