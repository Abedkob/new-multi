/**
 * The per-store consent cookie: its name, its signature, and the attributes it is set with.
 *
 * Server-only (node:crypto + lib/env.ts). The browser never reads this cookie — it is HttpOnly,
 * and the storefront layout passes the decoded state into the React tree instead. That keeps the
 * visitor's decision tamper-evident on the one side that matters: ours.
 *
 * Shape: <base64url payload>.<base64url HMAC-SHA256>
 *
 * Why signed at all, for a value the visitor could set for themselves anyway: a receipt in our
 * database says "this visitor consented". If the cookie it is reconciled against could be forged
 * by anything that can set a cookie, that record would not be worth keeping. The signature is
 * what makes a stored decision evidence rather than a guess.
 *
 * Name: store_consent_<tenantKey>, where tenantKey is a stable 12-character digest of the
 * tenant id (§4.4 wants one cookie per store, never one shared across stores).
 *
 *  - Not the slug: a store can be renamed, which would orphan every existing decision and
 *    silently re-prompt the whole audience.
 *  - Not the raw tenant id: cookie names travel to the browser, and internal ids do not need to.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import {
  type ConsentGrants,
  type ConsentLocale,
  type StoredConsent,
  isConsentLocale,
} from "@/lib/consent/types";

/** ~6 months (§4.4). Re-asked sooner if the notice version changes. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export const CONSENT_COOKIE_PREFIX = "store_consent_";

/**
 * In development ANALYTICS_SIGNING_SECRET is optional, so fall back to AUTH_SECRET (always
 * present, and already the trust anchor for sessions). Production requires the dedicated secret
 * — see the refine in lib/env.ts — so the fallback can never be what signs real traffic.
 */
function signingSecret(): string {
  return env.ANALYTICS_SIGNING_SECRET ?? env.AUTH_SECRET;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * The per-store suffix every analytics cookie name carries. Exported because the visitor and
 * session cookies (lib/analytics/identity.ts) must scope to a store exactly the way consent
 * does — one derivation, so the three can never disagree about which store they belong to.
 */
export function tenantCookieKey(tenantId: string): string {
  const digest = createHmac("sha256", signingSecret()).update(`consent:${tenantId}`).digest();
  // base32-ish from base64url, minus the two characters that are not cookie-name safe.
  return b64url(digest).replace(/[-_]/g, "").slice(0, 12);
}

export function consentCookieName(tenantId: string): string {
  return CONSENT_COOKIE_PREFIX + tenantCookieKey(tenantId);
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", signingSecret()).update(payload).digest());
}

export function encodeConsent(value: StoredConsent): string {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  return `${payload}.${sign(payload)}`;
}

/** Narrow unknown JSON to a StoredConsent, or null. Anything unexpected is treated as absent. */
function asStoredConsent(input: unknown): StoredConsent | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  const grants = o.grants as Record<string, unknown> | undefined;
  if (
    typeof o.v !== "number" ||
    typeof o.k !== "number" ||
    typeof o.at !== "number" ||
    !isConsentLocale(o.locale) ||
    typeof grants !== "object" ||
    grants === null ||
    typeof grants.analytics !== "boolean" ||
    typeof grants.advertising !== "boolean"
  ) {
    return null;
  }
  return {
    v: o.v,
    k: o.k,
    at: o.at,
    locale: o.locale,
    grants: { analytics: grants.analytics, advertising: grants.advertising },
    ref: typeof o.ref === "string" ? o.ref : undefined,
  };
}

/**
 * Verify and decode. Returns null — meaning "no decision", so the banner shows again — for a
 * missing, malformed, wrongly signed, or stale-keyed cookie. A tampered value is never treated
 * as a decision, and never as consent.
 */
export function decodeConsent(raw: string | undefined): StoredConsent | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payload = raw.slice(0, dot);
  const provided = Buffer.from(raw.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload), "base64url");
  // Compare hashes, not the raw buffers: timingSafeEqual throws on a length mismatch, and the
  // length of an attacker-supplied signature is attacker-controlled.
  const h = (b: Buffer) => createHash("sha256").update(b).digest();
  if (!timingSafeEqual(h(provided), h(expected))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const stored = asStoredConsent(parsed);
  if (!stored) return null;
  // A rotated signing secret invalidates old decisions: the visitor is asked again rather than
  // us honouring a grant we can no longer vouch for.
  if (stored.k !== env.ANALYTICS_SIGNING_KEY_VERSION) return null;
  return stored;
}

export function buildStoredConsent(input: {
  noticeVersion: number;
  grants: ConsentGrants;
  locale: ConsentLocale;
  publicRef?: string;
}): StoredConsent {
  return {
    v: input.noticeVersion,
    k: env.ANALYTICS_SIGNING_KEY_VERSION,
    grants: input.grants,
    locale: input.locale,
    at: Date.now(),
    ref: input.publicRef,
  };
}

export type ConsentCookieAttributes = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/**
 * Cookie attributes for this store on this request.
 *
 * `path`: a store on the platform's shared host is scoped to its own /store/<slug> subtree, so
 * one store's consent cookie is not even sent to another's pages (§4.4). A store on its own
 * domain has the whole origin to itself, so "/" is both correct and necessary — its storefront
 * is served from the root there.
 *
 * `secure`: true whenever the request arrived over HTTPS, and always in production. It cannot be
 * unconditional: Chrome refuses a Secure cookie on a plaintext origin, which would silently
 * break consent on a local custom-domain test (http://consent-e2e.test) — the one setup that
 * exercises the custom-domain path at all.
 */
export function consentCookieAttributes(input: {
  isHttps: boolean;
  storePath: string;
}): ConsentCookieAttributes {
  return {
    httpOnly: true,
    secure: input.isHttps || env.NODE_ENV === "production",
    sameSite: "lax",
    path: input.storePath,
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
  };
}

/** When this decision's record should be eligible for deletion (mirrors the cookie's life). */
export function consentExpiry(from = new Date()): Date {
  return new Date(from.getTime() + CONSENT_COOKIE_MAX_AGE_SECONDS * 1000);
}
