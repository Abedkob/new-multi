/**
 * What may be derived from a request, and nothing more.
 *
 * This is §4.5 ("never store") made into functions: country from trusted proxy metadata, a
 * three-way device bucket from a user-agent string that is then discarded, a normalized page
 * kind instead of a URL, and campaign dimensions trimmed to fixed lengths.
 *
 * These were written in Phase 1 against `next/headers` for the consent action. They now take a
 * plain `Headers` so a route handler can use them too, and `lib/consent/read.ts` wraps them —
 * one definition rather than two that drift.
 */

import type { PageKind } from "@/lib/analytics/contract";
import { PAGE_KINDS } from "@/lib/analytics/contract";

export type DeviceClass = "mobile" | "tablet" | "desktop";

const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-geo-country"] as const;
/** Cloudflare's placeholders for "unknown" and "Tor exit node" are not countries. */
const NON_COUNTRIES = new Set(["XX", "T1"]);

/**
 * Country out of proxy metadata. Never derived from an IP here: the IP is used for rate limiting
 * while the request is in flight and is not carried any further.
 *
 * **Do not call this directly — use `countryFromTrusted` from `lib/edge.ts`.** Every header
 * below is forgeable by anyone who can reach the origin without going through the edge, so the
 * value is only meaningful once that question has been answered, and `pnpm verify:edge` fails if
 * any file other than `lib/edge.ts` calls this. It stays here, and stays pure, because this
 * module is imported by client components and the gate needs env and node:crypto.
 */
export function countryFrom(headers: Headers): string | null {
  for (const name of COUNTRY_HEADERS) {
    const value = headers.get(name)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && !NON_COUNTRIES.has(value)) return value;
  }
  return null;
}

/**
 * Three buckets, derived and then thrown away. "Is the mobile layout where the problem is?" is
 * a question a merchant should be able to answer; "which device is this person on?" is not.
 */
export function deviceClassFrom(headers: Headers): DeviceClass | null {
  const ua = headers.get("user-agent");
  if (!ua) return null;
  if (/\b(iPad|Tablet)\b/i.test(ua) || (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua))) {
    return "tablet";
  }
  if (/\b(Mobi|iPhone|iPod|Android.*Mobile|Windows Phone)\b/i.test(ua)) return "mobile";
  return "desktop";
}

export const isPageKind = (value: unknown): value is PageKind =>
  typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value);

/** Maps a storefront pathname to its page kind. Used by the tracker; never stored as a URL. */
export function pageKindFromPath(pathname: string, basePath: string): PageKind {
  const rest = (basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname)
    .replace(/\/+$/, "");
  if (rest === "" || rest === "/") return "home";
  const [, first] = rest.split("/");
  switch (first) {
    case "shop":
      return "shop";
    case "category":
      return "category";
    case "products":
      return "product";
    case "cart":
      return "cart";
    case "checkout":
      return "checkout";
    case "search":
      return "search";
    case "privacy":
    case "about":
    case "contact":
    case "faq":
    case "shipping":
      return "page";
    default:
      return "other";
  }
}

/**
 * Attribution moved to lib/analytics/attribution.ts in Phase 4, which classifies the arrival
 * (campaign / paid / social / search / referral / direct) instead of only resolving it. Kept as
 * a re-export so there is one implementation rather than two that drift.
 */
export { resolveAttribution, type ResolvedAttribution } from "@/lib/analytics/attribution";

