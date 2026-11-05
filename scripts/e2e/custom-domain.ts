/**
 * The custom-domain leg every end-to-end suite must have.
 *
 * Twice now, in two consecutive phases, a store on its own domain has behaved differently from
 * the same store on the shared host, and both times the difference was total data loss that
 * every shared-host check called healthy:
 *
 *   - Phase 2: a cookie scoped to /store/<slug> never reached the server at the domain root.
 *   - Phase 3: event ids were not UUIDs off localhost (crypto.randomUUID is secure-context
 *     only), so the contract refused every batch with a 400 and the page's analytics vanished.
 *
 * A custom domain changes the origin, the cookie path, the secure context and the proxy's host
 * routing all at once. It is not a variation of the shared host; it is the other half of the
 * product. So:
 *
 *   1. Every e2e suite exercises its feature on a custom domain as well as the shared host.
 *   2. A leg that cannot run FAILS. It does not skip, and it does not report a skip as a pass.
 *      A skip is how both bugs above stayed invisible: the suite stayed green while the leg
 *      that would have caught them quietly did not run.
 *
 * `pnpm verify:e2e-policy` enforces both rules statically.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { BASE } from "./browser";

/**
 * Chrome resolves these itself via --host-resolver-rules, so nothing is written to the hosts
 * file and no suite needs elevation. Each must also be listed in `allowedDevOrigins` in
 * next.config.ts, or `next dev` serves the page without its JavaScript — which is exactly the
 * failure that got misdiagnosed as a cookie problem in Phase 3.
 */
export function assertDevOriginAllowed(domain: string): void {
  const config = readFileSync("next.config.ts", "utf8");
  if (!config.includes(`"${domain}"`)) {
    throw new Error(
      `${domain} is missing from allowedDevOrigins in next.config.ts. Without it, next dev ` +
        "serves the page but refuses its JavaScript, so every interactive assertion fails for " +
        "a reason that has nothing to do with the feature under test.",
    );
  }
}

/**
 * Runs `fn` against `http://<domain>:<port>` in a browser that resolves that hostname to the
 * loopback address. The caller is responsible for pointing the tenant at the domain and
 * clearing it afterwards, because only the caller knows which tenant it made.
 */
export async function onCustomDomain<T>(
  domain: string,
  fn: (leg: { context: BrowserContext; origin: string }) => Promise<T>,
): Promise<T> {
  assertDevOriginAllowed(domain);
  const port = new URL(BASE).port || "80";
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [`--host-resolver-rules=MAP ${domain} 127.0.0.1`],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    return await fn({ context, origin: `http://${domain}:${port}` });
  } finally {
    await browser.close();
  }
}

/**
 * Why a leg must not excuse itself.
 *
 * The one honest reason a custom-domain leg cannot run is a production build, which forces
 * Secure on the cookies this depends on and so cannot be exercised over plain http. That is
 * correct behaviour — real custom domains are HTTPS — but it is not a reason to pass. The suite
 * says so and fails, and the operator runs it against `next dev` or an HTTPS origin.
 */
/**
 * The half of a template's custom-domain leg that is the same for all thirteen of them.
 *
 * A template's own leg has to assert its own thing — whether its motion initialized, whether
 * its search dialog opens — because that is what differs between them and what the host can
 * silently take away. These three are what every template owes a store with a domain, and
 * saying them once means a new template's leg cannot quietly leave one out:
 *
 *   1. Every storefront link is root-relative. A template that builds links from the slug
 *      instead of from store.basePath 404s every one of them here, and only here.
 *   2. The composition still fits. The viewport is the same, but the URL depth is not, and a
 *      template that pads from the path (or renders a different nav) can overflow.
 *   3. The routes a shopper reaches from those links actually answer on this host.
 */
export async function assertStorefrontDomainBasics(
  page: Page,
  origin: string,
  routes: string[],
): Promise<void> {
  const host = new URL(origin).host;
  assert.equal(new URL(page.url()).host, host, "the leg must be driving the custom domain");

  const internal = await page
    .locator('a[href^="/"]')
    .evaluateAll((as) => (as as HTMLAnchorElement[]).map((a) => a.getAttribute("href")!));
  assert.ok(internal.length > 0, "a storefront page must link into the store");
  for (const href of internal) {
    assert.ok(
      !href.startsWith("/store/"),
      `on a domain a storefront link must not carry /store/<slug>, got ${href}`,
    );
  }

  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(size.content <= size.viewport, `horizontal overflow on ${host}: ${JSON.stringify(size)}`);

  for (const route of routes) {
    assert.equal(
      (await page.goto(`${origin}${route}`))?.status(),
      200,
      `${route} must answer on a store's own domain`,
    );
  }
}

export const PRODUCTION_BUILD_HINT =
  "no cookie was set on the custom domain. Either this is a production build (which forces " +
  "Secure, and a plaintext host cannot carry it — run against `next dev` or an HTTPS origin), " +
  "or the hostname is missing from allowedDevOrigins in next.config.ts. This is a FAILURE, " +
  "not something to pass over: see scripts/e2e/custom-domain.ts.";
