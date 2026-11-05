/**
 * What may be believed about where a request came from (D75, D83).
 *
 * `lib/analytics/request.ts` reads `cf-ipcountry` (and the Vercel/generic equivalents) and
 * trusts whichever appears. That is right behind an edge and forgeable without one: anybody who
 * can reach this origin directly can send `cf-ipcountry: FR` and write a country of their
 * choosing into the analytics tables, or send a fresh `cf-connecting-ip` per request and never
 * meet a rate limit.
 *
 * The real fix is outside the application — the origin accepts HTTP connections only from
 * Cloudflare's published ranges, enforced at the reverse proxy, with the edge headers stripped
 * from anything that arrives another way. EDGE_HARDENING.md is that runbook, including the
 * break-glass path, because an origin lock is also how a deployment becomes unreachable.
 *
 * This file is the half the application can enforce by itself, and the half that survives a
 * proxy someone reconfigures later: one place that answers "did this arrive through the edge?",
 * and the readers of forgeable metadata routed through it. What it can check is a shared secret
 * that Cloudflare adds with a Transform Rule and a direct client cannot guess — not an IP
 * range, because the socket's peer address never reaches here (every request's peer is the
 * local reverse proxy).
 *
 * EDGE_TRUST_MODE=off, the default and what every committed configuration ships, keeps the
 * behaviour the app had before Phase 7: there is no edge, and proxy metadata is believed. That
 * is correct for `pnpm dev`, and it is a deliberate statement rather than an oversight — see
 * the mode's own comment in lib/env.ts.
 *
 * Every function here takes its configuration as an optional last argument, defaulting to the
 * environment. Not for flexibility — nothing in the app passes one — but because `lib/env.ts`
 * parses once per process, so behaviour that reads it directly can only be verified by spawning
 * a process per case. `pnpm verify:edge` exercises all four modes in one pass instead.
 *
 * Server-only (it reads env and node:crypto). Note that `lib/analytics/request.ts` is imported
 * by client components, which is why the gate lives here and not there.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { countryFrom } from "@/lib/analytics/request";
import { env } from "@/lib/env";

/** The header Cloudflare's Transform Rule adds, and the only thing this origin can verify. */
export const EDGE_TOKEN_HEADER = "x-edge-token";

export type EdgeConfig = {
  mode: "off" | "cloudflare";
  secret?: string;
  forceHttps: boolean;
  hstsMaxAge: number;
};

export const edgeConfigFromEnv = (): EdgeConfig => ({
  mode: env.EDGE_TRUST_MODE,
  secret: env.EDGE_SHARED_SECRET,
  forceHttps: env.EDGE_FORCE_HTTPS,
  hstsMaxAge: env.EDGE_HSTS_MAX_AGE,
});

/**
 * Headers that describe the client and can only be believed from the edge that wrote them.
 *
 * Every name `countryFrom` reads must appear here, and `pnpm verify:edge` fails if one does not
 * — a new country header added to that list without being added to this one would be believed
 * from anywhere.
 *
 * `x-forwarded-for` is deliberately **not** in this list: the local reverse proxy appends to it
 * legitimately and `clientIp` already discards the client-controlled prefix (see its docstring).
 * Neither is `x-forwarded-proto`: forging it can only make this origin *skip* an upgrade to
 * https, never fake one, and the edge is what stops a plaintext request from arriving at all.
 */
export const EDGE_IDENTITY_HEADERS = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "true-client-ip",
  "x-vercel-ip-country",
  "x-geo-country",
] as const;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compared as digests so the comparison is both constant-time and length-independent. */
const secretsMatch = (presented: string, expected: string) =>
  timingSafeEqual(digest(presented), digest(expected));

/**
 * Did this request come through the edge?
 *
 * In `off` mode the answer is yes for everything, which is the pre-Phase-7 behaviour and the
 * only sensible answer when nothing has been declared to be in front of the origin.
 */
export function isTrustedEdgeRequest(headers: Headers, config = edgeConfigFromEnv()): boolean {
  if (config.mode === "off") return true;
  // lib/env.ts refuses to boot in this state; belt as well as braces, because the alternative
  // is believing everything.
  if (!config.secret) return false;
  const presented = headers.get(EDGE_TOKEN_HEADER)?.trim();
  return !!presented && secretsMatch(presented, config.secret);
}

/**
 * Country, or null when the request did not come through the edge.
 *
 * **The only legitimate caller of `countryFrom`.** `verify:edge` asserts that nothing else in
 * the repository calls it, so there is one gate rather than one per reader — the alternative is
 * three readers and a comment asking everyone to remember.
 *
 * Null rather than a guess: §4.5's rule is that an unmeasured dimension stays unknown, and the
 * report layer already distinguishes "no country" from "a country" (a rate with no denominator
 * is null, never 0).
 */
export function countryFromTrusted(headers: Headers, config = edgeConfigFromEnv()): string | null {
  return isTrustedEdgeRequest(headers, config) ? countryFrom(headers) : null;
}

/**
 * The client address the edge reported, when there is an edge to report it.
 *
 * Behind Cloudflare this is strictly better than counting X-Forwarded-For hops: getting
 * TRUSTED_PROXY_COUNT wrong by one puts either the whole internet or the edge itself into a
 * single rate-limit bucket, and neither failure announces itself. `clientIp` falls back to the
 * hop counting when this returns null.
 */
export function trustedClientIp(headers: Headers, config = edgeConfigFromEnv()): string | null {
  if (config.mode === "off" || !isTrustedEdgeRequest(headers, config)) return null;
  const ip = headers.get("cf-connecting-ip")?.trim();
  return ip || null;
}

/**
 * The request's headers with the edge's own metadata removed, for an untrusted request.
 *
 * Belt to `countryFromTrusted`'s braces: a reader added in a hurry sees nothing to believe
 * rather than something forged. It is not the guarantee — the proxy matcher excludes `/api` and
 * `/_next`, so not every request passes through here, which is exactly why the gate above sits
 * at the point of reading and this does not.
 */
export function sanitizeEdgeHeaders(headers: Headers, config = edgeConfigFromEnv()): Headers {
  const copy = new Headers(headers);
  if (isTrustedEdgeRequest(headers, config)) return copy;
  for (const name of EDGE_IDENTITY_HEADERS) copy.delete(name);
  return copy;
}

/**
 * Where a plaintext request should be sent instead, or null to serve it.
 *
 * Fires only on an explicit `x-forwarded-proto: http`. An **absent** header is left alone on
 * purpose: that is what the container's own healthcheck sends (`wget http://127.0.0.1:3000/login`
 * in docker-compose.yml), and a redirect answered by a proxy that then re-sends the same
 * headers is how this becomes an infinite loop rather than an upgrade.
 *
 * 308 rather than this repository's usual 307: an http→https upgrade is a fact about the
 * deployment rather than a store's current configuration, and preserving the method matters for
 * a Server Action POST that arrives before the edge has caught it.
 */
export function httpsRedirectUrl(
  url: URL,
  headers: Headers,
  config = edgeConfigFromEnv(),
): URL | null {
  if (!config.forceHttps) return null;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto !== "http") return null;
  const https = new URL(url);
  https.protocol = "https:";
  return https;
}

/**
 * Response headers applied to everything the proxy answers.
 *
 * Small on purpose. What is here is true of every page the platform serves; what is not:
 *
 * - **No `X-Frame-Options` / `frame-ancestors`.** The platform theme editor renders a store in
 *   an iframe (`/platform/preview/[slug]`, driven by postMessage) and the content editor does
 *   the same. A blanket DENY would break both, and a correct allowance is per-path work.
 * - **No CSP.** Each storefront injects the owner's own GA4 and Meta snippets
 *   (lib/analytics.tsx) and the templates ship inline styles; a useful policy needs per-request
 *   nonces threaded through 13 templates. Recorded in KNOWN_GAPS.md rather than shipped
 *   half-done — the `/uploads/*` sandbox CSP in next.config.ts is the one place it is already
 *   enforced.
 */
export function securityHeaders(config = edgeConfigFromEnv()): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    // A storefront's URL names the store and the product. Full URLs do not leave for a
    // third-party origin; the origin alone does.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Nothing in the platform asks for any of these, and a store's own injected tags should not
    // be able to either.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  // Absent unless somebody set EDGE_HSTS_MAX_AGE deliberately (D74: on last, after the pilot
  // has served a week; P7-16 records the date).
  if (config.hstsMaxAge > 0) {
    headers["Strict-Transport-Security"] =
      `max-age=${config.hstsMaxAge}; includeSubDomains; preload`;
  }
  return headers;
}
