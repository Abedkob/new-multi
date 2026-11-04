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

import type { AttributionContext, PageKind } from "@/lib/analytics/contract";
import { PAGE_KINDS } from "@/lib/analytics/contract";

export type DeviceClass = "mobile" | "tablet" | "desktop";

const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-geo-country"] as const;
/** Cloudflare's placeholders for "unknown" and "Tor exit node" are not countries. */
const NON_COUNTRIES = new Set(["XX", "T1"]);

/**
 * Country from trusted proxy metadata only. Never derived from an IP here: the IP is used for
 * rate limiting while the request is in flight and is not carried any further.
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

export type ResolvedAttribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  hasAdClick: boolean;
};

const EMPTY_ATTRIBUTION: ResolvedAttribution = {
  source: null,
  medium: null,
  campaign: null,
  content: null,
  hasAdClick: false,
};

/** Keeps a trimmed, length-capped value, or null. Never an empty string. */
const clean = (value: string | undefined, max: number): string | null => {
  const trimmed = value?.trim().slice(0, max);
  return trimmed ? trimmed : null;
};

/**
 * Resolves what the client reported about how the visitor arrived, in the priority order of
 * §3.5: explicit UTM, then a recognised ad-click marker, then a referring host, then direct.
 *
 * The client reports these because only the page can see its own URL and referrer, but nothing
 * it sends is stored verbatim: values are trimmed and capped, the referring host becomes the
 * source rather than a full URL, and an ad-click marker is a boolean — never the click id.
 */
export function resolveAttribution(input: AttributionContext | undefined): ResolvedAttribution {
  if (!input) return EMPTY_ATTRIBUTION;

  const source = clean(input.source, 80);
  const medium = clean(input.medium, 80);
  const campaign = clean(input.campaign, 120);
  const content = clean(input.content, 120);
  const hasAdClick = input.hasAdClick === true;
  const referrerHost = clean(input.referrerHost, 255);

  if (source) return { source, medium, campaign, content, hasAdClick };
  if (hasAdClick) {
    return { source: "ad-click", medium: medium ?? "cpc", campaign, content, hasAdClick };
  }
  if (referrerHost) {
    return { source: referrerHost, medium: medium ?? "referral", campaign, content, hasAdClick };
  }
  // Direct: no source at all, rather than a made-up one.
  return { ...EMPTY_ATTRIBUTION, hasAdClick };
}
