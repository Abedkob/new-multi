/**
 * Per-store marketing integrations (GA4, Google Ads, Meta Pixel, site verification tokens).
 *
 * Pure: no env, no Node built-ins — imported by lib/validation.ts (client-reachable), the
 * platform admin actions, and the storefront layout.
 *
 * These values are rendered into inline <script> text and <meta> tags on every storefront page,
 * so they are held to strict formats twice: when the platform admin saves them, and again
 * (storeIntegrations below) right before rendering, so a bad row written any other way can
 * never become script injection.
 */

export const INTEGRATION_FORMATS = {
  gaMeasurementId: /^G-[A-Z0-9]{4,20}$/,
  googleAdsId: /^AW-\d{6,15}$/,
  googleAdsPurchaseLabel: /^[A-Za-z0-9_-]{4,64}$/,
  metaPixelId: /^\d{10,20}$/,
  googleSiteVerification: /^[A-Za-z0-9_-]{10,100}$/,
  metaDomainVerification: /^[A-Za-z0-9]{10,64}$/,
} as const;

export type IntegrationKey = keyof typeof INTEGRATION_FORMATS;

/**
 * People paste whatever the other product shows them: the whole
 * `<meta name="google-site-verification" content="abc..." />` tag, or `AW-123/label` in one
 * string. Pull out the value we actually store.
 */
export function extractMetaContent(input: string): string {
  const match = input.match(/content\s*=\s*["']([^"']+)["']/i);
  return (match ? match[1] : input).trim();
}

/**
 * The id inside whatever an owner pastes (D40).
 *
 * Google and Meta both hand people a block of JavaScript and tell them to add it to their site.
 * An owner follows that instruction here, because it is the instruction they were given — so
 * each of these finds the identifier in the snippet and keeps only that. What is stored is an
 * id; the markup and the script are discarded at the door rather than sanitised later.
 *
 * `INTEGRATION_FORMATS` then has to match, so even a snippet shaped in a way these patterns do
 * not expect cannot smuggle anything through: it is refused with the expected shape instead of
 * being saved and silently dead. `storeIntegrations` re-checks the format again at render time,
 * so a row written by any other route is still held to it.
 */
export const INTEGRATION_EXTRACTORS: Record<IntegrationKey, (input: string) => string> = {
  // gtag('config', 'G-ABC123'), or ...?id=G-ABC123, or the bare id. Matched case-insensitively
  // and then upper-cased: people type their own id in lower case, and the stored format is
  // upper. (Found by verify:integrations — the first version of this refused "g-abc123".)
  gaMeasurementId: (input) => firstMatch(input, /\bG-[A-Za-z0-9]{4,20}\b/i)?.toUpperCase() ?? input,
  // The same snippet carries AW-123456789; a pasted send_to value is "AW-123456789/AbC-dEf".
  googleAdsId: (input) => firstMatch(input, /\bAW-\d{6,15}\b/i)?.toUpperCase() ?? input,
  // The label's own case is significant, so only the AW- part around it is matched loosely.
  googleAdsPurchaseLabel: (input) =>
    firstMatch(input, /\bAW-\d{6,15}\/([A-Za-z0-9_-]{4,64})\b/i, 1) ??
    (input.includes("/") ? input.split("/").pop()!.trim() : input),
  // fbq('init', '123456789012345'), or the dataset id on its own.
  metaPixelId: (input) =>
    firstMatch(input, /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/i, 1) ??
    firstMatch(input, /\b\d{10,20}\b/) ??
    input,
  googleSiteVerification: extractMetaContent,
  metaDomainVerification: extractMetaContent,
};

function firstMatch(input: string, pattern: RegExp, group = 0): string | null {
  const match = input.match(pattern);
  return match ? match[group].trim() : null;
}

/** What an owner pasted, reduced to the id this field stores. */
export function extractIntegrationValue(key: IntegrationKey, input: string): string {
  return INTEGRATION_EXTRACTORS[key](input).trim();
}

/**
 * The ids this visitor's consent actually permits. GA4 is measurement, so it belongs to the
 * `analytics` category; Google Ads and the Meta Pixel are advertising. An ungranted id becomes
 * null, which every path in lib/analytics.tsx already treats as "not configured" — so refusing
 * a category doesn't just hide a script tag, it makes the corresponding events inert too.
 *
 * It lives here, in a plain shared module, rather than in lib/analytics.tsx, because that file
 * is "use client" and the storefront layout has to apply this **on the server**: an id narrowed
 * only in the browser has already been serialized into the page by then.
 */
export function grantedConfig(
  config: AnalyticsConfig,
  grants: { analytics: boolean; advertising: boolean },
): AnalyticsConfig {
  return {
    gaId: grants.analytics ? config.gaId : null,
    adsId: grants.advertising ? config.adsId : null,
    adsPurchaseLabel: grants.advertising ? config.adsPurchaseLabel : null,
    metaPixelId: grants.advertising ? config.metaPixelId : null,
  };
}

/** What the storefront needs, and only that — never the whole tenant row on the client. */
export type AnalyticsConfig = {
  gaId: string | null;
  adsId: string | null;
  adsPurchaseLabel: string | null;
  metaPixelId: string | null;
};

type TenantIntegrations = { [K in IntegrationKey]: string | null };

const valid = (key: IntegrationKey, v: string | null) =>
  v && INTEGRATION_FORMATS[key].test(v) ? v : null;

/** Re-validated at render time; anything off-format is treated as not configured. */
export function storeIntegrations(t: TenantIntegrations) {
  const analytics: AnalyticsConfig = {
    gaId: valid("gaMeasurementId", t.gaMeasurementId),
    adsId: valid("googleAdsId", t.googleAdsId),
    adsPurchaseLabel: valid("googleAdsPurchaseLabel", t.googleAdsPurchaseLabel),
    metaPixelId: valid("metaPixelId", t.metaPixelId),
  };
  return {
    analytics,
    hasAnalytics: !!(analytics.gaId || analytics.adsId || analytics.metaPixelId),
    googleSiteVerification: valid("googleSiteVerification", t.googleSiteVerification),
    metaDomainVerification: valid("metaDomainVerification", t.metaDomainVerification),
  };
}
