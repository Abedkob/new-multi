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
