/**
 * Where a visit came from (§3.5, D23).
 *
 * Phase 2 kept what the page reported — UTM values, a referring hostname, whether an ad-click
 * marker was present — and resolved it in priority order. What it did not do is say what KIND
 * of arrival that was, which is the thing every acquisition report needs: "facebook.com" in a
 * referrer and "facebook" in a utm_source are the same channel to a merchant and two different
 * strings to a database.
 *
 * So classification happens once, here, server-side, and the answer is stored on the session.
 * Two reports can then never disagree about what "direct" means, and Phase 5 never has to
 * re-derive a channel from loose strings — which it would do differently, in each report, by
 * accident.
 *
 * The ladder, highest priority first (§3.5):
 *
 *   1. CAMPAIGN   an explicit utm_source. The merchant said what this is; believe them.
 *   2. PAID       a gclid or fbclid with no UTM. Someone paid for this click even if the link
 *                 was tagged carelessly.
 *   3. SOCIAL     a referrer we recognise as a social network.
 *   4. SEARCH     a referrer we recognise as a search engine — organic, not paid; a paid click
 *                 carries a marker and was caught one rung up.
 *   5. REFERRAL   any other external referrer.
 *   6. DIRECT     nothing to go on. Not a channel, an absence of one, and it is stored as nulls
 *                 rather than as a made-up source called "direct".
 *
 * Two things are deliberately never stored, anywhere: the ad-click id (it identifies a person,
 * while its presence identifies a channel) and the full referring URL (a path can carry a
 * search query, a username, an order number). The hostname is kept; everything else is dropped
 * by the time it reaches here.
 *
 * Pure: no database, no env. The same function runs in the check and in ingestion.
 */

import type { AttributionContext } from "@/lib/analytics/contract";

export const SOURCE_KINDS = ["campaign", "paid", "social", "search", "referral", "direct"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Hosts worth recognising, and the channel name a merchant would use for each.
 *
 * Matched on the registrable tail, so `m.facebook.com`, `l.facebook.com` and `web.facebook.com`
 * are all "facebook" — a merchant should not see their Facebook traffic split across five
 * subdomains Facebook happens to redirect through. Unknown hosts are kept verbatim as a
 * referral: inventing a channel for them would be worse than showing the host.
 */
const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "fb.me": "facebook",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "whatsapp.com": "whatsapp",
  "wa.me": "whatsapp",
  "t.co": "twitter",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "snapchat.com": "snapchat",
  "linkedin.com": "linkedin",
  "lnkd.in": "linkedin",
  "pinterest.com": "pinterest",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "telegram.org": "telegram",
  "t.me": "telegram",
  "reddit.com": "reddit",
  "threads.net": "threads",
};

const SEARCH_HOSTS: Record<string, string> = {
  "google.com": "google",
  "google.co": "google", // google.co.uk and friends, matched on the tail below
  "bing.com": "bing",
  "duckduckgo.com": "duckduckgo",
  "yahoo.com": "yahoo",
  "yandex.com": "yandex",
  "yandex.ru": "yandex",
  "ecosia.org": "ecosia",
  "brave.com": "brave",
  "baidu.com": "baidu",
};

export type ResolvedAttribution = {
  sourceKind: SourceKind;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  /** Hostname only, kept for a report that wants to show the actual referrer. */
  referrerHost: string | null;
  hasAdClick: boolean;
};

export const DIRECT: ResolvedAttribution = {
  sourceKind: "direct",
  source: null,
  medium: null,
  campaign: null,
  content: null,
  referrerHost: null,
  hasAdClick: false,
};

/** Trimmed, length-capped, lowercased for a host; never an empty string. */
const clean = (value: string | undefined, max: number): string | null => {
  const trimmed = value?.trim().slice(0, max);
  return trimmed ? trimmed : null;
};

/** `www.m.facebook.com` → matches `facebook.com`. Returns the channel name, or null. */
function lookupHost(host: string, table: Record<string, string>): string | null {
  const lower = host.toLowerCase().replace(/^www\./, "");
  for (const [suffix, name] of Object.entries(table)) {
    if (lower === suffix || lower.endsWith(`.${suffix}`)) return name;
    // google.co.uk: the table holds "google.co" and the host has a country tail after it.
    if (suffix.endsWith(".co") && (lower === suffix || lower.startsWith(`${suffix}.`))) return name;
    if (suffix.endsWith(".co") && lower.includes(`.${suffix}.`)) return name;
  }
  return null;
}

/** What kind of host this is, independently of the ladder — used by the checks too. */
export function classifyHost(host: string): { kind: "social" | "search" | "referral"; name: string } {
  const social = lookupHost(host, SOCIAL_HOSTS);
  if (social) return { kind: "social", name: social };
  const search = lookupHost(host, SEARCH_HOSTS);
  if (search) return { kind: "search", name: search };
  return { kind: "referral", name: host.toLowerCase().replace(/^www\./, "") };
}

/**
 * The ladder. Takes what the page reported and returns what gets stored.
 *
 * `medium` is only ever invented when the rung implies one and the link did not say: a social
 * referrer is "social", organic search is "organic", a paid click is "cpc". An explicit
 * utm_medium always wins, because the merchant tagging their own link knows better than this
 * table does.
 */
export function resolveAttribution(input: AttributionContext | undefined): ResolvedAttribution {
  if (!input) return DIRECT;

  const source = clean(input.source, 80);
  const medium = clean(input.medium, 80);
  const campaign = clean(input.campaign, 120);
  const content = clean(input.content, 120);
  const referrerHost = clean(input.referrerHost, 255)?.toLowerCase() ?? null;
  const hasAdClick = input.hasAdClick === true;
  const base = { campaign, content, referrerHost, hasAdClick };

  // 1. The merchant tagged the link.
  if (source) return { ...base, sourceKind: "campaign", source, medium };

  // 2. Somebody paid for the click, even if the link was not tagged.
  if (hasAdClick) {
    return { ...base, sourceKind: "paid", source: "ad-click", medium: medium ?? "cpc" };
  }

  // 3-5. A referrer we can make sense of.
  if (referrerHost) {
    const { kind, name } = classifyHost(referrerHost);
    const impliedMedium = kind === "social" ? "social" : kind === "search" ? "organic" : "referral";
    return { ...base, sourceKind: kind, source: name, medium: medium ?? impliedMedium };
  }

  // 6. Nothing to go on. Stored as an absence, not as a channel called "direct".
  return { ...DIRECT, hasAdClick };
}

/** Whether this arrival says anything at all about where the visitor came from (D24). */
export const isDirect = (attribution: ResolvedAttribution) => attribution.sourceKind === "direct";
