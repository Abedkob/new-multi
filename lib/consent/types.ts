/**
 * Consent vocabulary shared by the server and the browser.
 *
 * Pure: no env, no node built-ins, no React — this file is imported by client components, by
 * the server action, and by the verification scripts.
 *
 * Three categories, as in STOREFRONT_ANALYTICS_MASTER_PLAN.md §4.3:
 *
 *  - essential:   always active, never asked about (it is what makes the cart and checkout work)
 *  - analytics:   our own first-party measurement, and GA4 where the store has configured it
 *  - advertising: Google Ads and Meta Pixel where the store has configured them
 *
 * Only the last two are ever granted or refused, so they are the only ones modelled here.
 */

export const CONSENT_CATEGORIES = ["analytics", "advertising"] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** What the visitor has allowed. Absent a decision, both are false — refusal is the default. */
export type ConsentGrants = Record<ConsentCategory, boolean>;

export const DENY_ALL: ConsentGrants = { analytics: false, advertising: false };
export const GRANT_ALL: ConsentGrants = { analytics: true, advertising: true };

export const CONSENT_LOCALES = ["en", "ar"] as const;
export type ConsentLocale = (typeof CONSENT_LOCALES)[number];

export const isConsentLocale = (value: unknown): value is ConsentLocale =>
  typeof value === "string" && (CONSENT_LOCALES as readonly string[]).includes(value);

/**
 * How the choice was expressed. Recorded on the receipt so that "did this visitor actually
 * refuse, or had they just not been asked yet?" is answerable later.
 */
export const CONSENT_METHODS = [
  "BANNER_ACCEPT_ALL",
  "BANNER_REJECT",
  "MANAGE",
  "FOOTER_WITHDRAW",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * The grants a method implies, when it implies any. "Accept all" that recorded a refusal (or the
 * reverse) would make every receipt untrustworthy, so the server derives these rather than
 * believing what the browser sent. MANAGE is the only method where the visitor picks per
 * category, so it has no fixed shape.
 */
export const METHOD_GRANTS: Record<ConsentMethod, ConsentGrants | null> = {
  BANNER_ACCEPT_ALL: GRANT_ALL,
  BANNER_REJECT: DENY_ALL,
  FOOTER_WITHDRAW: DENY_ALL,
  MANAGE: null,
};

/** The cookie's payload. Short keys because it is signed and sent on every request. */
export type StoredConsent = {
  /** Tenant.consentNoticeVersion this decision answered. */
  v: number;
  /** ANALYTICS_SIGNING_KEY_VERSION in force when it was signed. */
  k: number;
  grants: ConsentGrants;
  locale: ConsentLocale;
  /** Decided-at, epoch milliseconds. */
  at: number;
  /** The receipt's publicRef, so Cookie settings can show it without a database read. */
  ref?: string;
};

/** What a server component gets after reading the cookie, and what the provider holds. */
export type ConsentState = {
  /** False when there is no valid decision for the current notice version. */
  decided: boolean;
  grants: ConsentGrants;
  /** True when the banner must be shown: never decided, or the notice changed since. */
  needsPrompt: boolean;
  /** Language to open the notice in: the visitor's last choice, else the store's default. */
  locale: ConsentLocale;
  /** Present once a decision exists and carried a receipt reference. */
  publicRef?: string;
};

export function consentState(
  stored: StoredConsent | null,
  noticeVersion: number,
  fallbackLocale: ConsentLocale,
): ConsentState {
  // A decision taken against an older notice is still the visitor's last known language
  // preference, but it is not consent to the current notice.
  const stale = stored !== null && stored.v !== noticeVersion;
  if (!stored || stale) {
    return {
      decided: false,
      grants: DENY_ALL,
      needsPrompt: true,
      locale: stored?.locale ?? fallbackLocale,
    };
  }
  return {
    decided: true,
    grants: stored.grants,
    needsPrompt: false,
    locale: stored.locale,
    publicRef: stored.ref,
  };
}

/** The state a storefront starts from when no cookie has been read yet. */
export const initialConsentState = (locale: ConsentLocale): ConsentState => ({
  decided: false,
  grants: DENY_ALL,
  needsPrompt: true,
  locale,
});
