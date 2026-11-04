/**
 * How an owner sets each integration up, and how they check it worked (D40).
 *
 * The *structure* is here; the *sentences* are in `lib/i18n/dictionaries`, as keys. That split
 * is the point: `ar.ts` is typed `Record<DictionaryKey, string>`, so a step added here without
 * an Arabic translation is a compile error rather than an English sentence shipped to an Arabic
 * storefront owner. Keeping the prose in this file would have made the Arabic optional.
 *
 * Every guide ends in a way to check the result, because the failure mode of this whole screen
 * is an owner who pastes an id, sees "Saved", and believes they are measuring something. A
 * saved id proves the field was filled in, nothing more.
 */
import type { IntegrationKey } from "@/lib/integrations";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";

/** A tool the owner opens to confirm the tag is live, with what to look for in it. */
export type IntegrationCheck = {
  /** Shown as the link text. */
  tool: string;
  url: string;
  /** Dictionary key for "what you should see". */
  expectKey: DictionaryKey;
};

export type IntegrationGuide = {
  key: IntegrationKey;
  labelKey: DictionaryKey;
  /** One line on what this does for the owner, in their words, not the vendor's. */
  purposeKey: DictionaryKey;
  /** Ordered steps. Each is a dictionary key. */
  stepKeys: readonly DictionaryKey[];
  /** The field's placeholder: what a pasted value looks like. */
  placeholder: string;
  check: IntegrationCheck;
  /**
   * Whether the tag waits for advertising consent. True for the measurement tags (§2.2); false
   * for the two verification tokens, which prove who owns a domain and watch nobody (D40a).
   */
  needsAdvertisingConsent: boolean;
};

const PIXEL_HELPER: IntegrationCheck = {
  tool: "Meta Pixel Helper",
  url: "https://www.facebook.com/business/help/198406697184603",
  expectKey: "integrations.check.pixelHelper",
};

const TAG_ASSISTANT: IntegrationCheck = {
  tool: "Google Tag Assistant",
  url: "https://tagassistant.google.com/",
  expectKey: "integrations.check.tagAssistant",
};

export const INTEGRATION_GUIDES: readonly IntegrationGuide[] = [
  {
    key: "gaMeasurementId",
    labelKey: "integrations.ga.label",
    purposeKey: "integrations.ga.purpose",
    stepKeys: [
      "integrations.ga.step1",
      "integrations.ga.step2",
      "integrations.ga.step3",
      "integrations.ga.step4",
    ],
    placeholder: "G-ABC123XYZ",
    check: TAG_ASSISTANT,
    needsAdvertisingConsent: true,
  },
  {
    key: "metaPixelId",
    labelKey: "integrations.pixel.label",
    purposeKey: "integrations.pixel.purpose",
    stepKeys: [
      "integrations.pixel.step1",
      "integrations.pixel.step2",
      "integrations.pixel.step3",
      "integrations.pixel.step4",
    ],
    placeholder: "123456789012345",
    check: PIXEL_HELPER,
    needsAdvertisingConsent: true,
  },
  {
    key: "googleAdsId",
    labelKey: "integrations.ads.label",
    purposeKey: "integrations.ads.purpose",
    stepKeys: ["integrations.ads.step1", "integrations.ads.step2", "integrations.ads.step3"],
    placeholder: "AW-123456789",
    check: TAG_ASSISTANT,
    needsAdvertisingConsent: true,
  },
  {
    key: "googleAdsPurchaseLabel",
    labelKey: "integrations.adsLabel.label",
    purposeKey: "integrations.adsLabel.purpose",
    stepKeys: ["integrations.adsLabel.step1", "integrations.adsLabel.step2"],
    placeholder: "AbC-dEfGhIjK",
    check: TAG_ASSISTANT,
    needsAdvertisingConsent: true,
  },
  {
    key: "metaDomainVerification",
    labelKey: "integrations.metaDomain.label",
    purposeKey: "integrations.metaDomain.purpose",
    // Step 3 is the one owners get wrong, and it is why this field exists at all: Meta verifies
    // a DOMAIN. The token Meta shows for shop.example.com does nothing on /store/shop.
    stepKeys: [
      "integrations.metaDomain.step1",
      "integrations.metaDomain.step2",
      "integrations.metaDomain.step3",
      "integrations.metaDomain.step4",
    ],
    placeholder: '<meta name="facebook-domain-verification" content="..." />',
    check: {
      tool: "Meta Business settings",
      url: "https://business.facebook.com/settings/owned-domains",
      expectKey: "integrations.check.metaDomain",
    },
    needsAdvertisingConsent: false,
  },
  {
    key: "googleSiteVerification",
    labelKey: "integrations.searchConsole.label",
    purposeKey: "integrations.searchConsole.purpose",
    stepKeys: [
      "integrations.searchConsole.step1",
      "integrations.searchConsole.step2",
      "integrations.searchConsole.step3",
    ],
    placeholder: '<meta name="google-site-verification" content="..." />',
    check: {
      tool: "Google Search Console",
      url: "https://search.google.com/search-console",
      expectKey: "integrations.check.searchConsole",
    },
    needsAdvertisingConsent: false,
  },
];

export const GUIDE_BY_KEY: Record<IntegrationKey, IntegrationGuide> = Object.fromEntries(
  INTEGRATION_GUIDES.map((g) => [g.key, g]),
) as Record<IntegrationKey, IntegrationGuide>;
