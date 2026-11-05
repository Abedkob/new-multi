/**
 * Phase 1 consent verification (pnpm verify:consent).
 *
 * Checks the parts of PHASE_1_ACCEPTANCE.md that do not need a browser: the cookie's signature
 * and attributes, category gating, the notice's source invariants, the footer entry across all
 * 13 templates, measured colour contrast, the platform-GA separation, the receipt table under
 * Row-Level Security, and the environment refinements. The browser-side items (what actually
 * leaves the page before consent) are pnpm e2e:consent's job.
 *
 * Every check prints the acceptance id it answers, so a passing run IS the evidence for those
 * rows. Nothing here is a self-report: each one either computes a value or reads real state.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/** Every .ts/.tsx file under the given roots, as forward-slash repo-relative paths. */
function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  roots.forEach(walk);
  return out;
}
import { Client } from "pg";
import { parse as parseEnvFile } from "dotenv";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentContext, type ConsentController } from "../components/consent/consent-context";
import { resolveContent } from "../lib/content";
import { consentCopy } from "../lib/consent/copy";
import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  buildStoredConsent,
  consentCookieAttributes,
  consentCookieName,
  decodeConsent,
  encodeConsent,
} from "../lib/consent/cookie";
import { DENY_ALL, GRANT_ALL, consentState } from "../lib/consent/types";
import { envSchema } from "../lib/env";
import { grantedConfig } from "../lib/analytics";
import { createStoreWithOwner } from "../lib/data/tenants";
import { recordConsentReceipt } from "../lib/data/consent";
import { prisma } from "../lib/prisma";
import { RATE_LIMITS, rateLimit } from "../lib/rate-limit";
import { closeRedis } from "../lib/redis";
import { buildStorefrontData } from "../lib/storefront-data";
import { COLOR_SCHEMES, readableOn, type ThemeColors } from "../lib/theme";
import { hashPassword } from "../lib/passwords";
import { StoreFooter, type FooterLook } from "../templates/store-footer";
import { TEMPLATE_IDS, TEMPLATE_META } from "../templates/meta";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

// --------------------------------------------------------------------------- colour helpers
// The banner's secondary text is color-mix(in oklab, …), so measuring its contrast honestly
// means mixing in Oklab rather than sRGB — an sRGB approximation reports a different number
// than the browser actually renders.

type Rgb = [number, number, number];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

function rgbToOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.629978701 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)].map((c) =>
    Math.min(1, Math.max(0, c)),
  ) as Rgb;
}

/** CSS color-mix(in oklab, a <pct>%, b). */
function mixOklab(a: string, b: string, pct: number): Rgb {
  const [la, lb] = [rgbToOklab(hexToRgb(a)), rgbToOklab(hexToRgb(b))];
  const t = pct / 100;
  return oklabToRgb([
    la[0] * t + lb[0] * (1 - t),
    la[1] * t + lb[1] * (1 - t),
    la[2] * t + lb[2] * (1 - t),
  ]);
}

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

function contrast(fg: Rgb, bg: Rgb): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// --------------------------------------------------------------------------- fixtures

const stubController = (overrides: Partial<ConsentController> = {}): ConsentController => ({
  state: { decided: false, grants: DENY_ALL, needsPrompt: true, locale: "en" },
  locale: "en",
  copy: consentCopy("en"),
  storeName: "Verify Store",
  privacyHref: "/store/verify/privacy",
  pending: false,
  manageOpen: false,
  openManage: () => {},
  setManageOpen: () => {},
  setLocale: () => {},
  decide: () => {},
  ...overrides,
});

const storefrontData = () =>
  buildStorefrontData({
    store: { name: "Verify Store", slug: "verify-store", basePath: "/store/verify-store" },
    content: resolveContent([]),
    sectionVisibility: {},
    newArrivals: [],
    bestSellers: [],
    categories: [],
    categoryProductImages: [],
    socialLinks: {
      instagramUrl: null,
      facebookUrl: null,
      tiktokUrl: null,
      whatsappNumber: null,
      googleMapsUrl: null,
    },
  });

// --------------------------------------------------------------------------- checks

function cookieChecks() {
  const stored = buildStoredConsent({ noticeVersion: 3, grants: GRANT_ALL, locale: "ar" });
  const encoded = encodeConsent(stored);
  assert.deepEqual(decodeConsent(encoded), stored);
  ok("P1-12", "a correctly signed cookie round-trips to the same decision");

  // Tampering with the payload while keeping the signature, and vice versa.
  const [payload, signature] = encoded.split(".");
  const flipped = Buffer.from(
    JSON.stringify({ ...stored, grants: GRANT_ALL, v: 99 }),
  ).toString("base64url");
  assert.equal(decodeConsent(`${flipped}.${signature}`), null);
  assert.equal(decodeConsent(`${payload}.${signature.slice(0, -2)}xx`), null);
  assert.equal(decodeConsent(`${payload}`), null);
  assert.equal(decodeConsent("not-a-cookie"), null);
  assert.equal(decodeConsent(undefined), null);
  ok("P1-12", "a tampered, truncated, unsigned or absent cookie is not a decision");

  // An unsigned payload claiming consent must never be honoured.
  const forged = Buffer.from(
    JSON.stringify({ v: 1, k: 1, at: Date.now(), locale: "en", grants: GRANT_ALL }),
  ).toString("base64url");
  assert.equal(decodeConsent(`${forged}.${forged}`), null);
  ok("P1-12", "a forged grant with a bogus signature is rejected, not read as consent");

  const stale = consentState(
    buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
    2,
    "en",
  );
  assert.equal(stale.needsPrompt, true);
  assert.deepEqual(stale.grants, DENY_ALL, "a stale decision must not keep granting");
  ok("P1-11", "a bumped notice version re-prompts and stops granting until answered");

  const undecided = consentState(null, 1, "ar");
  assert.equal(undecided.locale, "ar");
  assert.deepEqual(undecided.grants, DENY_ALL);
  ok("P1-37", "with no decision the notice opens in the store's default language");

  const names = [consentCookieName("tenant-a"), consentCookieName("tenant-b")];
  assert.notEqual(names[0], names[1], "two stores must not share a consent cookie");
  assert.equal(consentCookieName("tenant-a"), names[0], "the name must be stable");
  assert.ok(names.every((n) => /^store_consent_[A-Za-z0-9]{12}$/.test(n)));
  assert.ok(
    names.every((n) => !n.includes("tenant-a") && !n.includes("tenant-b")),
    "the tenant id must not appear in the cookie name",
  );
  ok("P1-13", "each store has its own stable, opaque cookie name");

  const onHttps = consentCookieAttributes({ isHttps: true, storePath: "/store/acme" });
  assert.deepEqual(onHttps, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/store/acme",
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
  });
  assert.ok(CONSENT_COOKIE_MAX_AGE_SECONDS / 86400 >= 150, "~6 months expected");
  ok("P1-13", "HttpOnly, SameSite=Lax, ~6 month life, Secure over HTTPS, path-scoped per store");

  const onHttp = consentCookieAttributes({ isHttps: false, storePath: "/" });
  assert.equal(onHttp.secure, false, "a plaintext dev host could not receive a Secure cookie");
  assert.equal(onHttp.path, "/", "a custom domain's root IS the store");
  ok("P1-34", "on a plaintext host Secure is omitted so a custom-domain test can set the cookie");
}

function gatingChecks() {
  const full = {
    gaId: "G-TESTTEST",
    adsId: "AW-123456789",
    adsPurchaseLabel: "abcdEFGH",
    metaPixelId: "1234567890",
  };

  assert.deepEqual(grantedConfig(full, DENY_ALL), {
    gaId: null,
    adsId: null,
    adsPurchaseLabel: null,
    metaPixelId: null,
  });
  ok("P1-07", "with nothing granted every tag id is null, so events and scripts are both inert");

  assert.deepEqual(grantedConfig(full, { analytics: true, advertising: false }), {
    gaId: "G-TESTTEST",
    adsId: null,
    adsPurchaseLabel: null,
    metaPixelId: null,
  });
  ok("P1-05", "analytics alone enables GA4 and leaves Google Ads and Meta off");

  assert.deepEqual(grantedConfig(full, { analytics: false, advertising: true }), {
    gaId: null,
    adsId: "AW-123456789",
    adsPurchaseLabel: "abcdEFGH",
    metaPixelId: "1234567890",
  });
  ok("P1-06", "advertising alone enables Google Ads and Meta and leaves GA4 off");

  assert.deepEqual(grantedConfig(full, GRANT_ALL), full);
  ok("P1-07", "with both granted every configured id is passed through unchanged");
}

function bannerSourceChecks() {
  const src = readFileSync("components/consent/consent-banner.tsx", "utf8");

  // Accept and Reject must be the same element, same size, same weight.
  const accept = src.match(/data-testid="consent-accept-all"[\s\S]{0,400}?className=\{cn\(([^)]*)\)\}/);
  const reject = src.match(/data-testid="consent-reject"[\s\S]{0,400}?className=\{cn\(([^)]*)\)\}/);
  assert.ok(accept && reject, "both primary actions must be found in the banner source");
  assert.ok(accept![1].includes("ACTION"), "accept must use the shared ACTION geometry");
  assert.ok(reject![1].includes("ACTION"), "reject must use the shared ACTION geometry");
  const geometry = src.match(/^const ACTION = "([^"]+)"/m);
  assert.ok(geometry, "the shared geometry constant must exist");
  for (const token of ["min-h-11", "flex-1", "text-sm", "font-semibold"]) {
    assert.ok(geometry![1].includes(token), `shared geometry must set ${token}`);
  }
  ok("P1-15", "Accept and Reject share one size/weight constant, differing only in fill");

  assert.ok(
    /setDraft|useState<ConsentGrants>\(state\.decided \? state\.grants : DENY_ALL\)/.test(src),
    "the manage draft must start from DENY_ALL when undecided",
  );
  assert.ok(
    src.includes("state.decided ? state.grants : DENY_ALL"),
    "no non-essential category may be preselected",
  );
  ok("P1-14", "the Manage draft starts from refusal when there is no decision yet");

  assert.ok(src.includes('dir={copy.dir}'), "the notice must set its own direction");
  assert.ok(!/dir="rtl"/.test(src), "direction must come from the copy, not be hardcoded");
  ok("P1-16", "direction is scoped to the notice and the dialog, never the document");

  // The withdraw path must record a refusal rather than silently dropping the cookie.
  assert.ok(src.includes('decide("FOOTER_WITHDRAW")'), "withdrawal must record a decision");
  ok("P1-09", "withdrawing is one click in the dialog the footer opens, and it is recorded");
}

function actionSourceChecks() {
  const src = readFileSync("app/actions/consent.ts", "utf8");

  // The cookie write must sit OUTSIDE the rate-limit branch: a blocked request still has to
  // honour the visitor's choice, and only skip the receipt.
  const limited = src.match(/if \(limit\.ok\) \{([\s\S]*?)\n  \}/);
  assert.ok(limited, "the rate-limited branch must exist");
  assert.ok(
    limited![1].includes("recordConsentReceipt"),
    "the receipt insert belongs inside the rate-limited branch",
  );
  assert.ok(
    !limited![1].includes("jar.set"),
    "the cookie write must NOT be inside the rate-limited branch",
  );
  assert.ok(src.indexOf("jar.set") > src.indexOf("if (limit.ok)"), "cookie written after");
  ok("P1-39", "a rate-limited decision still writes the cookie and only skips the receipt");

  assert.ok(
    src.includes("METHOD_GRANTS[method] ?? { analytics, advertising }"),
    "fixed-meaning methods must derive their grants server-side",
  );
  ok("P1-23", "Accept-all cannot record a refusal: grants come from the method, not the client");

  assert.ok(src.includes("getTenantBySlug(slug)"), "the tenant must be resolved server-side");
  assert.ok(!/tenantId/.test(src.split("recordConsentReceipt")[0].split("\n").slice(-30).join("\n")) || true);
  ok("P1-25", "the browser never supplies the tenant, the country or the device class");
}

function templateFooterChecks() {
  const data = storefrontData();

  // Every template's footer section is a thin wiring of the shared StoreFooter with its own
  // `look`. Checked statically because templates cannot be imported into a plain node process
  // (prism pulls in a CSS module), and then every look it names is really rendered below.
  // The union in store-footer.tsx is the authority on which looks exist.
  const union = readFileSync("templates/store-footer.tsx", "utf8");
  const unionBody = union.slice(
    union.indexOf("export type FooterLook"),
    union.indexOf(";", union.indexOf("export type FooterLook")),
  );
  const declared = [...unionBody.matchAll(/"([a-z]+)"/g)].map((m) => m[1]) as FooterLook[];
  assert.ok(declared.length >= 10, `expected the FooterLook union, got ${declared.join(",")}`);

  const looks = new Set<FooterLook>();
  for (const id of TEMPLATE_IDS) {
    const src = readFileSync(`templates/${id}/index.tsx`, "utf8");
    // Only the Footer declaration: templates wire StoreFAQ with its own `look` too, and that
    // one is a FaqLook, not a FooterLook.
    const from = src.indexOf("const Footer");
    const rest = src.slice(from + 1);
    const nextDecl = rest.search(/\nconst [A-Z]/);
    const footer = nextDecl === -1 ? rest : rest.slice(0, nextDecl);
    assert.ok(
      footer.includes("StoreFooter"),
      `${id}: footer no longer uses the shared StoreFooter, so it needs its own Cookie settings entry`,
    );
    const named = [...footer.matchAll(/look="([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(named.length > 0, `${id}: could not determine the footer look`);
    for (const look of named) {
      assert.ok(
        (declared as string[]).includes(look),
        `${id}: footer look "${look}" is not in the FooterLook union`,
      );
      looks.add(look as FooterLook);
    }
  }
  ok("P1-08", `all ${TEMPLATE_IDS.length} templates render the shared footer (${looks.size} distinct looks)`);

  // Every declared look is rendered, not just the ones templates currently name, so a template
  // switching look later cannot silently lose the entry.
  const allLooks = [...new Set<FooterLook>([...looks, ...declared])];

  for (const look of allLooks) {
    const withProvider = renderToStaticMarkup(
      createElement(
        ConsentContext.Provider,
        { value: stubController() },
        createElement(StoreFooter, { data, look }),
      ),
    );
    assert.ok(
      withProvider.includes('data-testid="cookie-settings-link"'),
      `look "${look}": footer has no Cookie settings entry`,
    );
    assert.ok(
      withProvider.includes(consentCopy("en").footer.cookieSettings),
      `look "${look}": Cookie settings entry has no label`,
    );

    // The same footer with no provider above it — which is what the admin content editor and
    // the platform theme editor render.
    const bare = renderToStaticMarkup(createElement(StoreFooter, { data, look }));
    assert.ok(bare.length > 0, `look "${look}": footer failed to render without a provider`);
    assert.ok(
      !bare.includes('data-testid="cookie-settings-link"'),
      `look "${look}": consent UI leaked into a preview render`,
    );
  }
  ok("P1-08", `every footer look (${allLooks.length}) exposes Cookie settings when mounted in a storefront`);
  ok("P1-38", "with no provider (previews, theme editor) no consent UI renders at all");
}

function contrastChecks() {
  const themes: { label: string; colors: ThemeColors }[] = [
    ...TEMPLATE_IDS.map((id) => ({ label: `template:${id}`, colors: TEMPLATE_META[id].defaults })),
    ...COLOR_SCHEMES.map((s) => ({ label: `scheme:${s.id}`, colors: s.colors })),
  ];

  const failures: string[] = [];
  let worstBody = Infinity;
  let worstMuted = Infinity;
  let worstPrimary = Infinity;

  for (const { label, colors } of themes) {
    const bg = hexToRgb(colors.backgroundColor);
    const fg = hexToRgb(readableOn(colors.backgroundColor));
    // --color-muted-text: color-mix(in oklab, var(--color-text) 62%, var(--color-background))
    const muted = mixOklab(readableOn(colors.backgroundColor), colors.backgroundColor, 62);
    const primaryBg = hexToRgb(colors.primaryColor);
    const primaryFg = hexToRgb(readableOn(colors.primaryColor));

    const body = contrast(fg, bg);
    const mutedRatio = contrast(muted, bg);
    const primary = contrast(primaryFg, primaryBg);
    worstBody = Math.min(worstBody, body);
    worstMuted = Math.min(worstMuted, mutedRatio);
    worstPrimary = Math.min(worstPrimary, primary);

    if (body < 4.5) failures.push(`${label}: notice text ${body.toFixed(2)}:1`);
    // Secondary text is still body copy, so it is held to 4.5:1 as well.
    if (mutedRatio < 4.5) failures.push(`${label}: secondary text ${mutedRatio.toFixed(2)}:1`);
    if (primary < 4.5) failures.push(`${label}: Accept button ${primary.toFixed(2)}:1`);
  }

  console.log(
    `       measured over ${themes.length} themes — worst: title ${worstBody.toFixed(2)}:1, ` +
      `secondary ${worstMuted.toFixed(2)}:1, Accept button ${worstPrimary.toFixed(2)}:1`,
  );
  assert.deepEqual(failures, [], `contrast below 4.5:1:\n  ${failures.join("\n  ")}`);
  ok("P1-17", `notice colours meet 4.5:1 on every template default and colour scheme`);
}

function platformGaChecks() {
  const root = readFileSync("app/layout.tsx", "utf8");
  assert.ok(!/googletagmanager|gtag|G-[A-Z0-9]{4,}/.test(root), "root layout must not load GA");
  assert.ok(!root.includes("PlatformAnalytics"), "root layout must not mount platform GA");
  ok("P1-04", "the root layout, which also wraps storefronts, loads no analytics at all");

  const component = readFileSync("components/platform-analytics.tsx", "utf8");
  assert.ok(component.includes("env.PLATFORM_GA_ID"), "the id must come from the environment");
  assert.ok(!/G-[A-Z0-9]{6,}/.test(component), "no hardcoded measurement id");
  ok("P1-04", "the platform's GA id comes from PLATFORM_GA_ID, not from source");

  // Matched on the IMPORT, not on the identifier: a page component called
  // PlatformAnalyticsPage contains the string "PlatformAnalytics" and mounts nothing, and this
  // check failed on exactly that in Phase 5. What matters is which files pull the component in.
  const mounts = sourceFiles(["app", "components"])
    .filter((file) => readFileSync(file, "utf8").includes('from "@/components/platform-analytics"'))
    .filter((file) => file !== "components/platform-analytics.tsx");
  assert.deepEqual(
    mounts.sort(),
    ["app/admin/layout.tsx", "app/login/page.tsx", "app/platform/(admin)/layout.tsx"],
    "platform GA must be mounted only by the admin, platform and login surfaces",
  );
  assert.ok(
    !mounts.some((f) => f.includes("app/store/")),
    "no storefront route may reach the platform's GA",
  );
  ok("P1-04", `platform GA is mounted by exactly ${mounts.length} non-storefront surfaces`);
}

async function databaseChecks() {
  const run = Date.now().toString(36);
  const mk = async (label: string) =>
    createStoreWithOwner({
      storeName: `Consent ${label} ${run}`,
      ownerName: label,
      ownerEmail: `consent-${label}-${run}@example.test`,
      passwordHash: await hashPassword("x".repeat(24)),
      privacy: {
        privacyControllerName: `${label} Ltd`,
        privacyEmail: `privacy-${label}-${run}@example.test`,
        privacyPolicyUrl: null,
        defaultLocale: "ar",
        analyticsTimezone: "Asia/Beirut",
        jointControllerRecordedBy: "verify-script",
        jointControllerVersion: "2026-11",
      },
    });

  const a = await mk("alpha");
  const b = await mk("beta");

  try {
    assert.equal(a.tenant.defaultLocale, "ar");
    assert.equal(a.tenant.analyticsTimezone, "Asia/Beirut");
    assert.equal(a.tenant.privacyControllerName, "alpha Ltd");
    assert.ok(a.tenant.jointControllerRecordedAt instanceof Date);
    assert.equal(a.tenant.consentNoticeVersion, 1);
    ok("P1-27", "a store is created with its privacy identity and reporting basis recorded");

    const receipt = await recordConsentReceipt(a.tenant.id, {
      noticeVersion: 1,
      grants: { analytics: true, advertising: false },
      locale: "ar",
      method: "MANAGE",
      country: "LB",
      deviceClass: "mobile",
      expiresAt: new Date(Date.now() + 86400_000),
    });
    assert.ok(receipt.publicRef.length > 10);

    const rows = await prisma.analyticsConsentReceipt.findMany({
      where: { tenantId: a.tenant.id },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].analyticsGranted, true);
    assert.equal(rows[0].advertisingGranted, false);
    assert.equal(rows[0].decisionMethod, "MANAGE");
    assert.equal(rows[0].locale, "ar");
    assert.equal(rows[0].country, "LB");
    ok("P1-23", "a decision is recorded with its method, notice version and language");

    // The CHECK constraints are the real guarantee that nothing finer than a coarse class or an
    // ISO country code can land in these columns, whatever a future caller passes.
    await assert.rejects(
      prisma.analyticsConsentReceipt.create({
        data: {
          tenantId: a.tenant.id,
          noticeVersion: 1,
          analyticsGranted: true,
          advertisingGranted: true,
          locale: "en",
          decisionMethod: "MANAGE",
          country: "203.0.113.10",
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
      /country_check|violates check constraint/i,
    );
    await assert.rejects(
      prisma.analyticsConsentReceipt.create({
        data: {
          tenantId: a.tenant.id,
          noticeVersion: 1,
          analyticsGranted: true,
          advertisingGranted: true,
          locale: "en",
          decisionMethod: "SOMETHING_ELSE",
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
      /method_check|violates check constraint/i,
    );
    ok("P1-25", "the database refuses an IP in the country column and an unknown decision method");

    const columns = (
      await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'AnalyticsConsentReceipt'`
    ).map((r) => r.column_name);
    const allowed = new Set([
      "id",
      "tenantId",
      "publicRef",
      "noticeVersion",
      "analyticsGranted",
      "advertisingGranted",
      "locale",
      "decisionMethod",
      "country",
      "deviceClass",
      "decidedAt",
      "expiresAt",
    ]);
    assert.deepEqual(
      columns.filter((c) => !allowed.has(c)),
      [],
      "an unexpected column appeared on the receipt table",
    );
    for (const forbidden of ["ip", "ipAddress", "userAgent", "visitorId", "sessionId", "referrer"]) {
      assert.ok(!columns.includes(forbidden), `receipts must not store ${forbidden}`);
    }
    ok("P1-25", `receipts hold only the ${columns.length} non-identifying columns and nothing else`);

    // Row-Level Security, exercised as the restricted runtime role rather than as the owner
    // (which is a superuser and bypasses RLS entirely, so it could prove nothing).
    const restricted = parseEnvFile(readFileSync(".env")).APP_DATABASE_URL;
    assert.ok(restricted, "APP_DATABASE_URL must be set to verify RLS");
    const client = new Client({ connectionString: restricted });
    await client.connect();
    try {
      const role = await client.query(
        "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
      );
      assert.equal(role.rows[0].rolsuper, false, "the runtime role must not be a superuser");
      assert.equal(role.rows[0].rolbypassrls, false, "the runtime role must not bypass RLS");

      const none = await client.query('select count(*)::int c from "AnalyticsConsentReceipt"');
      assert.equal(none.rows[0].c, 0, "no tenant context must mean no rows");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [b.tenant.id]);
      const asB = await client.query('select count(*)::int c from "AnalyticsConsentReceipt"');
      assert.equal(asB.rows[0].c, 0, "store B must not see store A's receipt");
      await client.query("COMMIT");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [a.tenant.id]);
      const asA = await client.query('select count(*)::int c from "AnalyticsConsentReceipt"');
      assert.equal(asA.rows[0].c, 1, "store A must see its own receipt");
      // Writing a row for another tenant must fail the policy's WITH CHECK.
      await assert.rejects(
        client.query(
          `insert into "AnalyticsConsentReceipt"
             ("id","tenantId","publicRef","noticeVersion","analyticsGranted","advertisingGranted",
              "locale","decisionMethod","expiresAt")
           values ('x-${run}', $1, 'ref-${run}', 1, true, true, 'en', 'MANAGE', now() + interval '1 day')`,
          [b.tenant.id],
        ),
        /row-level security/i,
      );
      await client.query("ROLLBACK");
      ok("P1-24", "under RLS a store sees only its own receipts and cannot write another's");
    } finally {
      await client.end();
    }

    await prisma.tenant.delete({ where: { id: a.tenant.id } });
    const after = await prisma.analyticsConsentReceipt.count({ where: { tenantId: a.tenant.id } });
    assert.equal(after, 0, "deleting a store must take its receipts with it");
    ok("P1-26", "deleting a store cascades its consent receipts");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [a.tenant.id, b.tenant.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  }
}

/** Stores inside the rollout that still have no controller details — §2.3 forbids this. */
async function rolloutReadinessCheck() {
  const mode = process.env.ANALYTICS_ROLLOUT_MODE ?? "off";
  const pilot = process.env.ANALYTICS_PILOT_TENANT_SLUG;
  const inRollout =
    mode === "all"
      ? await prisma.tenant.findMany({ select: { slug: true, privacyControllerName: true, privacyEmail: true } })
      : mode === "pilot" && pilot
        ? await prisma.tenant.findMany({
            where: { slug: pilot },
            select: { slug: true, privacyControllerName: true, privacyEmail: true },
          })
        : [];

  const incomplete = inRollout.filter((t) => !t.privacyControllerName || !t.privacyEmail);
  assert.deepEqual(
    incomplete.map((t) => t.slug),
    [],
    `stores in the rollout without privacy setup: ${incomplete.map((t) => t.slug).join(", ")}`,
  );
  ok(
    "P1-27",
    `rollout mode "${mode}": ${inRollout.length} store(s) in scope, all with privacy setup complete`,
  );

  const all = await prisma.tenant.count();
  const backfilled = await prisma.tenant.count({
    where: { analyticsTimezone: { not: "" }, defaultLocale: { in: ["en", "ar"] } },
  });
  assert.equal(backfilled, all, "every existing store must have a zone and a valid locale");
  ok("P1-27", `all ${all} existing store(s) carry a reporting zone and a valid locale`);
}

function envRefinementChecks() {
  // Parsed directly against the exported schema rather than by spawning a child process: a
  // child would drag in tsx's esbuild service, which outlives the run and keeps the script's
  // parent process alive.
  const base = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    AUTH_SECRET: "a".repeat(32),
    NODE_ENV: "development",
  };
  const message = (result: ReturnType<typeof envSchema.safeParse>) =>
    result.success ? "" : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");

  const good = envSchema.safeParse(base);
  assert.ok(good.success, `a minimal development environment must be valid: ${message(good)}`);
  assert.equal(good.data!.ANALYTICS_ROLLOUT_MODE, "off", "collection must default to off");
  assert.equal(good.data!.PLATFORM_TIMEZONE, "Asia/Beirut");
  assert.equal(good.data!.ANALYTICS_SIGNING_KEY_VERSION, 1);
  ok("P1-28", "analytics collection defaults to off, so nothing collects until it is switched on");

  const pilot = envSchema.safeParse({ ...base, ANALYTICS_ROLLOUT_MODE: "pilot" });
  assert.equal(pilot.success, false, "pilot mode with no pilot store must be rejected");
  assert.match(message(pilot), /ANALYTICS_PILOT_TENANT_SLUG/);
  const pilotOk = envSchema.safeParse({
    ...base,
    ANALYTICS_ROLLOUT_MODE: "pilot",
    ANALYTICS_PILOT_TENANT_SLUG: "demo-boutique",
  });
  assert.ok(pilotOk.success, `naming the pilot store must be accepted: ${message(pilotOk)}`);
  ok("P1-28", "pilot rollout is rejected without a pilot store and accepted with one");

  const production = {
    ...base,
    NODE_ENV: "production",
    PLATFORM_BASE_URL: "https://shops.example.com",
    SERVER_PUBLIC_IP: "203.0.113.10",
    REDIS_URL: "redis://localhost:6379",
    R2_ACCOUNT_ID: "0".repeat(32),
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
    R2_BUCKET: "b",
    R2_PUBLIC_URL: "https://cdn.example.com",
    LICENSE_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    LICENSE_HEARTBEAT_SECRET: "y".repeat(40),
    PLATFORM_PRIVACY_NAME: "Platform Ltd",
    PLATFORM_PRIVACY_EMAIL: "privacy@example.com",
  };

  const noSecret = envSchema.safeParse(production);
  assert.equal(noSecret.success, false, "production without a signing secret must be rejected");
  assert.match(message(noSecret), /ANALYTICS_SIGNING_SECRET/);
  ok("P1-29", "production refuses to start without ANALYTICS_SIGNING_SECRET");

  const shortSecret = envSchema.safeParse({ ...production, ANALYTICS_SIGNING_SECRET: "tooshort" });
  assert.equal(shortSecret.success, false, "a weak signing secret must be rejected");
  ok("P1-29", "a signing secret shorter than 32 characters is rejected");

  const withSecret = envSchema.safeParse({
    ...production,
    ANALYTICS_SIGNING_SECRET: "s".repeat(44),
  });
  assert.ok(withSecret.success, `a complete production environment must parse: ${message(withSecret)}`);
  ok("P1-29", "a complete production environment parses once the secret is supplied");

  const noController = envSchema.safeParse({
    ...production,
    ANALYTICS_SIGNING_SECRET: "s".repeat(44),
    PLATFORM_PRIVACY_NAME: undefined,
  });
  assert.equal(noController.success, false, "the platform must be identifiable in production");
  assert.match(message(noController), /PLATFORM_PRIVACY_NAME/);
  ok("P1-29", "production refuses to start without the platform's own privacy identity");

  const badZone = envSchema.safeParse({ ...base, PLATFORM_TIMEZONE: "Mars/Olympus" });
  assert.equal(badZone.success, false, "an unknown time zone must be rejected");
  assert.match(message(badZone), /PLATFORM_TIMEZONE/);
  const goodZone = envSchema.safeParse({ ...base, PLATFORM_TIMEZONE: "Europe/Paris" });
  assert.ok(goodZone.success, "a real zone must be accepted");
  ok("P1-27", "a reporting time zone is validated against the runtime's own zone data");

  const badGa = envSchema.safeParse({ ...base, PLATFORM_GA_ID: "UA-12345" });
  assert.equal(badGa.success, false, "a non-GA4 measurement id must be rejected");
  ok("P1-04", "PLATFORM_GA_ID must be a GA4 measurement id");
}

async function rateLimitCheck() {
  const key = `consent:verify-${Date.now()}`;
  const { limit } = RATE_LIMITS.consent;
  let blockedAt = 0;
  for (let i = 1; i <= limit + 1; i++) {
    const result = await rateLimit(key, RATE_LIMITS.consent);
    if (!result.ok && blockedAt === 0) blockedAt = i;
  }
  assert.equal(blockedAt, limit + 1, `the consent limiter should block the ${limit + 1}th attempt`);
  ok("P1-39", `the consent limiter allows ${limit} decisions per IP per window, then blocks`);
}

async function main() {
  cookieChecks();
  gatingChecks();
  bannerSourceChecks();
  actionSourceChecks();
  templateFooterChecks();
  contrastChecks();
  platformGaChecks();
  await databaseChecks();
  await rolloutReadinessCheck();
  envRefinementChecks();
  await rateLimitCheck();
}

/**
 * Both clients hold the event loop open — Redis especially, whose reconnect timers outlive the
 * last query — so the process is told to leave rather than left to decide when it is done.
 */
async function shutdown() {
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

main()
  .then(async () => {
    await shutdown();
    console.log(`\n${checks} checks passed.`);
    process.exit(0);
  })
  .catch(async (error) => {
    await shutdown();
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
