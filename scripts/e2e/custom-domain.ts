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

import { readFileSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright-core";
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
export const PRODUCTION_BUILD_HINT =
  "no cookie was set on the custom domain. Either this is a production build (which forces " +
  "Secure, and a plaintext host cannot carry it — run against `next dev` or an HTTPS origin), " +
  "or the hostname is missing from allowedDevOrigins in next.config.ts. This is a FAILURE, " +
  "not something to pass over: see scripts/e2e/custom-domain.ts.";
