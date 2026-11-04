/**
 * The tenant-bound bootstrap token (§12.1).
 *
 * What it is: a short-lived HMAC that says "an envelope carrying this was minted for tenant X
 * in the last half hour". Minted during a storefront render and handed to the tracker.
 *
 * What it is NOT, and must never be treated as: authentication, or proof of anything about the
 * visitor. The storefront is public, so anyone can load a page and read their own token. It
 * makes blind posting to another store's endpoint fail, lets stale and forged envelopes be
 * rejected before any database work, and bounds how long a copied token stays useful. Nothing
 * downstream may infer more than that — identity comes from the signed visitor cookie, and
 * permission to collect at all comes from the consent cookie.
 *
 * Server-only (node:crypto + lib/env.ts).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Long enough to outlive a page visit, short enough that a copied token stops working. */
export const BOOTSTRAP_TOKEN_TTL_MS = 30 * 60_000;

/** Same fallback as the consent cookie: production requires the dedicated secret (lib/env.ts). */
const secret = () => env.ANALYTICS_SIGNING_SECRET ?? env.AUTH_SECRET;

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`bootstrap:${payload}`).digest("base64url");
}

/** `<key version>.<expiry ms>.<signature>` */
export function mintBootstrapToken(tenantId: string, now = Date.now()): string {
  const expiresAt = now + BOOTSTRAP_TOKEN_TTL_MS;
  const payload = `${env.ANALYTICS_SIGNING_KEY_VERSION}.${tenantId}.${expiresAt}`;
  return `${env.ANALYTICS_SIGNING_KEY_VERSION}.${expiresAt}.${sign(payload)}`;
}

export type TokenRejection = "malformed" | "expired" | "wrong-key" | "bad-signature";

/**
 * Verifies a token against the tenant it must have been minted for. Returns the reason on
 * failure so the endpoint can count rejections by kind without logging the token itself.
 */
export function verifyBootstrapToken(
  raw: string,
  tenantId: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: TokenRejection } {
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [keyVersion, expiryRaw, provided] = parts;

  const expiresAt = Number(expiryRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    return { ok: false, reason: "malformed" };
  }
  // Key version first: after a secret rotation the signature cannot match anyway, and saying so
  // precisely keeps "we rotated" distinct from "someone is forging tokens".
  if (keyVersion !== String(env.ANALYTICS_SIGNING_KEY_VERSION)) {
    return { ok: false, reason: "wrong-key" };
  }
  if (expiresAt <= now) return { ok: false, reason: "expired" };

  const expected = sign(`${keyVersion}.${tenantId}.${expiresAt}`);
  // Hash both sides before comparing: timingSafeEqual throws on a length mismatch, and the
  // length of a supplied signature is attacker-controlled.
  const h = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(h(provided), h(expected))) {
    return { ok: false, reason: "bad-signature" };
  }
  return { ok: true };
}
