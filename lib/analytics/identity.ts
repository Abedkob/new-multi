/**
 * The visitor and session cookies (§4.4), deliberately deferred from Phase 1 until something
 * read them.
 *
 * Both are HttpOnly, signed, and tenant-scoped by name — the same derivation as the consent
 * cookie, so one store's identifiers are never sent to another and the two stores cannot be
 * correlated. Neither is ever minted for a visitor who has not granted analytics: the endpoint
 * checks consent before it reaches any of this.
 *
 * Server-only (node:crypto + lib/env.ts).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { tenantCookieKey } from "@/lib/consent/cookie";

/** ~12 months (§4.4). */
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Rolling inactivity window; refreshed on every batch that arrives. */
export const sessionCookieMaxAgeSeconds = () => env.ANALYTICS_SESSION_TIMEOUT_MINUTES * 60;

export const VISITOR_COOKIE_PREFIX = "store_visitor_";
export const SESSION_COOKIE_PREFIX = "store_session_";

export const visitorCookieName = (tenantId: string) =>
  VISITOR_COOKIE_PREFIX + tenantCookieKey(tenantId);
export const sessionCookieName = (tenantId: string) =>
  SESSION_COOKIE_PREFIX + tenantCookieKey(tenantId);

const secret = () => env.ANALYTICS_SIGNING_SECRET ?? env.AUTH_SECRET;

function sign(kind: "visitor" | "session", id: string): string {
  return createHmac("sha256", secret()).update(`${kind}:${id}`).digest("base64url");
}

export const encodeIdentity = (kind: "visitor" | "session", id: string) =>
  `${id}.${sign(kind, id)}`;

/**
 * Returns the id only if the signature matches. An unsigned or edited cookie is treated as
 * absent, so the visitor simply gets a new identifier rather than being able to choose one —
 * which would let them merge themselves into someone else's session.
 */
export function decodeIdentity(kind: "visitor" | "session", raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const id = raw.slice(0, dot);
  // cuid()s only; anything else is not something we minted.
  if (!/^[a-z0-9]{20,40}$/.test(id)) return null;

  const provided = Buffer.from(raw.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(kind, id), "base64url");
  const h = (b: Buffer) => createHash("sha256").update(b).digest();
  if (!timingSafeEqual(h(provided), h(expected))) return null;
  return id;
}

export type IdentityCookieAttributes = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/** Same reasoning as the consent cookie: Secure follows the scheme, forced in production. */
export function identityCookieAttributes(input: {
  isHttps: boolean;
  storePath: string;
  maxAge: number;
}): IdentityCookieAttributes {
  return {
    httpOnly: true,
    secure: input.isHttps || env.NODE_ENV === "production",
    sameSite: "lax",
    path: input.storePath,
    maxAge: input.maxAge,
  };
}

/** Whether a session's last activity is old enough that the next event starts a new session. */
export function sessionExpired(lastActivityAt: Date, now = new Date()): boolean {
  return now.getTime() - lastActivityAt.getTime() > env.ANALYTICS_SESSION_TIMEOUT_MINUTES * 60_000;
}
