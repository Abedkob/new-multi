/**
 * Phase 5 verification: the owner's Google and Meta connections (pnpm verify:integrations —
 * P5-16 to P5-18e).
 *
 * Needs a running server, because the half that matters is what reaches the page:
 *
 *   BASE_URL=http://localhost:3200 pnpm verify:integrations
 *
 * The two claims worth the trouble of a real request:
 *
 *   - A verification token is in the storefront's head **for a visitor who declined cookies**,
 *     and on the store's own domain as well as the shared host. It proves domain ownership and
 *     watches nobody, so withholding it until consent would break verification for a share of
 *     visitors while protecting none of them (D40a).
 *   - What an owner pastes is reduced to an id. Nothing of the snippet — no tag, no script, no
 *     quote — is in the database or on the page.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner, updateTenantIntegrations } from "../lib/data/tenants";
import {
  diffIntegrations,
  formatIntegrationDetail,
  lastIntegrationChanges,
  parseIntegrationFields,
  recordIntegrationChange,
} from "../lib/analytics/audit";
import { grantedConfig } from "../lib/analytics";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { DENY_ALL, GRANT_ALL } from "../lib/consent/types";
import { INTEGRATION_GUIDES } from "../lib/integrations-guide";
import { extractIntegrationValue, type IntegrationKey } from "../lib/integrations";
import { analyticsSettingsSchema, ownerIntegrationsSchema } from "../lib/validation";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

// What Google and Meta actually hand people, abbreviated only where it repeats itself.
const GTAG_SNIPPET = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7QF2MLD9XZ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7QF2MLD9XZ');
</script>`;

const FBQ_SNIPPET = `<script>
  !function(f,b,e,v,n,t,s){...}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '417283950671234');
  fbq('track', 'PageView');
</script>`;

const META_DOMAIN_TAG = '<meta name="facebook-domain-verification" content="abc123def456ghi789" />';
const SEARCH_CONSOLE_TAG =
  '<meta name="google-site-verification" content="Xy7_pQ-Rt9ZkLm4nOpQrStUvWxYz01234567890aB" />';

/** No markup, no script, no quotes: an id, or it was not extracted. */
function assertIsBareId(value: string, where: string) {
  for (const forbidden of ["<", ">", "script", "fbq", "gtag", '"', "'", " "]) {
    assert.ok(
      !value.includes(forbidden),
      `${where}: ${JSON.stringify(value)} still contains ${JSON.stringify(forbidden)}`,
    );
  }
}

function extractionChecks() {
  const cases: [IntegrationKey, string, string][] = [
    ["gaMeasurementId", GTAG_SNIPPET, "G-7QF2MLD9XZ"],
    ["gaMeasurementId", "g-7qf2mld9xz", "G-7QF2MLD9XZ"],
    ["googleAdsId", "<script>gtag('config', 'AW-987654321');</script>", "AW-987654321"],
    ["googleAdsId", "AW-987654321/AbC-dEfGhIjK", "AW-987654321"],
    ["googleAdsPurchaseLabel", "AW-987654321/AbC-dEfGhIjK", "AbC-dEfGhIjK"],
    ["metaPixelId", FBQ_SNIPPET, "417283950671234"],
    ["metaPixelId", "417283950671234", "417283950671234"],
    ["metaDomainVerification", META_DOMAIN_TAG, "abc123def456ghi789"],
    ["googleSiteVerification", SEARCH_CONSOLE_TAG, "Xy7_pQ-Rt9ZkLm4nOpQrStUvWxYz01234567890aB"],
  ];
  for (const [key, input, expected] of cases) {
    const value = extractIntegrationValue(key, input);
    assert.equal(value, expected, `${key} from a pasted snippet`);
    assertIsBareId(value, key);
  }
  ok("P5-18c", `${cases.length} pasted snippets each reduce to the bare id`);

  // And through the schema, which is what the forms actually use.
  const parsed = ownerIntegrationsSchema.safeParse({
    gaMeasurementId: GTAG_SNIPPET,
    metaPixelId: FBQ_SNIPPET,
    googleAdsId: "AW-987654321/AbC-dEfGhIjK",
    googleAdsPurchaseLabel: "AW-987654321/AbC-dEfGhIjK",
    metaDomainVerification: META_DOMAIN_TAG,
    googleSiteVerification: SEARCH_CONSOLE_TAG,
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value) assertIsBareId(value, `schema.${key}`);
  }
  assert.equal(parsed.data.gaMeasurementId, "G-7QF2MLD9XZ");
  assert.equal(parsed.data.googleAdsPurchaseLabel, "AbC-dEfGhIjK");
  ok("P5-18c", "the owner's schema stores ids, never the markup or the script");

  // P5-17: refused with the expected shape, not saved and silently dead.
  const refused = analyticsSettingsSchema.safeParse({
    gaMeasurementId: "my analytics account",
    googleAdsId: "",
    googleAdsPurchaseLabel: "",
    metaPixelId: "",
    metaDomainVerification: "",
  });
  assert.ok(!refused.success, "an unparseable value must be refused");
  const message = refused.error.issues.find((i) => i.path[0] === "gaMeasurementId")?.message ?? "";
  assert.match(message, /G-/, `the message must name the expected shape, got: ${message}`);
  // The label without its tag is refused too, because the label alone can be sent nowhere.
  const orphanLabel = analyticsSettingsSchema.safeParse({
    gaMeasurementId: "",
    googleAdsId: "",
    googleAdsPurchaseLabel: "AbC-dEfGhIjK",
    metaPixelId: "",
    metaDomainVerification: "",
  });
  assert.ok(!orphanLabel.success, "a conversion label with no tag id must be refused");
  ok("P5-17", "a malformed value is refused with the expected shape named in the message");

  // An empty field is the off switch, not an error.
  const cleared = ownerIntegrationsSchema.safeParse({
    gaMeasurementId: "",
    googleAdsId: "",
    googleAdsPurchaseLabel: "",
    metaPixelId: "",
    metaDomainVerification: "",
    googleSiteVerification: "",
  });
  assert.ok(cleared.success);
  assert.deepEqual(Object.values(cleared.data), [null, null, null, null, null, null]);
  ok("P5-16", "an empty field clears the integration rather than failing validation");
}

/** P5-16: consent decides which ids exist at all, not merely whether a script tag is drawn. */
function consentChecks() {
  const config = {
    gaId: "G-7QF2MLD9XZ",
    adsId: "AW-987654321",
    adsPurchaseLabel: "AbC-dEfGhIjK",
    metaPixelId: "417283950671234",
  };
  const denied = grantedConfig(config, { analytics: false, advertising: false });
  assert.deepEqual(denied, { gaId: null, adsId: null, adsPurchaseLabel: null, metaPixelId: null });
  const analyticsOnly = grantedConfig(config, { analytics: true, advertising: false });
  assert.equal(analyticsOnly.gaId, config.gaId, "GA4 is measurement, not advertising");
  assert.equal(analyticsOnly.metaPixelId, null, "the pixel is advertising and must stay null");
  assert.equal(analyticsOnly.adsId, null);
  const all = grantedConfig(config, { analytics: true, advertising: true });
  assert.deepEqual(all, config);
  ok("P5-16", "refusing advertising nulls the pixel and Ads ids, so their events are inert too");
}

/** P5-18b: owner-only, and the owner never supplies the store id. */
function ownerOnlyChecks() {
  const files = [
    "app/admin/(panel)/marketing/layout.tsx",
    "app/admin/(panel)/marketing/integrations/page.tsx",
    "app/admin/(panel)/marketing/integrations/actions.ts",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Phase 7 replaced requireOwner here with a named capability. The claim this check makes is
    // unchanged and still worth making file by file: each of these three verifies the caller
    // itself rather than inheriting a guard from whatever imported it. "integrations:write" is
    // owner-only in lib/permissions.ts, which verify:permissions holds down separately.
    assert.ok(
      /requireCapability\(\s*"(marketing:read|integrations:write)"/.test(source),
      `${file} must verify the caller itself, with an owner-only capability`,
    );
    assert.ok(
      !/formData\.get\(["']tenantId|params.*tenantId/.test(source),
      `${file} must never take a tenant id from the request`,
    );
  }
  // Every guide's field is on the form, and every form field has a guide: a field with no
  // instructions is how an owner pastes the wrong thing.
  const form = readFileSync("app/admin/(panel)/marketing/integrations/integrations-form.tsx", "utf8");
  assert.ok(form.includes("INTEGRATION_GUIDES.map"), "the form must be built from the guides");
  assert.equal(INTEGRATION_GUIDES.length, 6, "all six fields need a guide");
  ok("P5-18b", `${files.length} owner routes verify the role and take no tenant id from the request`);

  // P5-18e: every guide has steps, a check tool, and an Arabic translation of each line. The
  // Arabic is enforced by the type on ar.ts, so what is left to check is that nothing is empty.
  const en = readFileSync("lib/i18n/dictionaries/en.ts", "utf8");
  const ar = readFileSync("lib/i18n/dictionaries/ar.ts", "utf8");
  for (const guide of INTEGRATION_GUIDES) {
    assert.ok(guide.stepKeys.length >= 2, `${guide.key} needs real steps`);
    assert.ok(guide.check.url.startsWith("https://"), `${guide.key} needs a checking tool`);
    for (const key of [guide.labelKey, guide.purposeKey, ...guide.stepKeys, guide.check.expectKey]) {
      assert.ok(en.includes(`"${key}"`), `${key} is missing from en.ts`);
      assert.ok(ar.includes(`"${key}"`), `${key} is missing from ar.ts`);
    }
  }
  assert.ok(
    ar.includes("Meta Pixel Helper") || ar.includes("الإضافة"),
    "the Arabic check text must mention the tool",
  );
  const metaDomainStep = INTEGRATION_GUIDES.find((g) => g.key === "metaDomainVerification")!;
  const stepText = metaDomainStep.stepKeys
    .map((k) => en.slice(en.indexOf(`"${k}"`), en.indexOf("\n", en.indexOf(`"${k}"`))))
    .join(" ");
  assert.match(
    stepText,
    /exact domain|per domain/i,
    "the Meta guide must say verification is per domain — the mistake everyone makes once",
  );
  ok("P5-18e", "all 6 integrations carry EN and AR steps and a tool to check them with");
}

async function auditChecks(tenantId: string) {
  const before = { gaMeasurementId: null, metaPixelId: "111111111111" };
  const after = { gaMeasurementId: "G-7QF2MLD9XZ", metaPixelId: "111111111111" };
  const changes = diffIntegrations(before, after);
  assert.deepEqual(changes, [
    { field: "gaMeasurementId", from: null, to: "G-7QF2MLD9XZ" },
  ]);
  await recordIntegrationChange({
    tenantId,
    actorUserId: null,
    actorEmail: "owner@example.test",
    actorRole: "owner",
    changes,
  });
  const rows = await prisma.analyticsAuditLog.findMany({
    where: { tenantId, action: "INTEGRATION_CHANGE" },
  });
  assert.equal(rows.length, 1, "one write, one row");
  assert.equal(rows[0].subject, "owner", "the row must say who was acting");
  assert.match(rows[0].detail ?? "", /gaMeasurementId: \(none\) -> G-7QF2MLD9XZ/);
  assert.equal(rows[0].actorEmail, "owner@example.test");

  // Nothing changed: no row. A log full of non-events is a log nobody reads.
  await recordIntegrationChange({
    tenantId,
    actorUserId: null,
    actorEmail: "owner@example.test",
    actorRole: "owner",
    changes: diffIntegrations(after, after),
  });
  assert.equal(
    await prisma.analyticsAuditLog.count({ where: { tenantId, action: "INTEGRATION_CHANGE" } }),
    1,
    "re-saving an unchanged form must write nothing",
  );
  ok("P5-18a", "an integration write is logged with actor, field and before/after; a no-op is not");

  // D40b: "last changed by X on Y", per field, from the log — the question a merchant asks when
  // a tag stops reporting. A platform admin changes a different field a moment later, so the
  // check also proves the two fields keep their own actors rather than sharing the newest one.
  await recordIntegrationChange({
    tenantId,
    actorUserId: null,
    actorEmail: "admin@example.test",
    actorRole: "platform-admin",
    changes: diffIntegrations(after, { ...after, metaPixelId: "222222222222" }),
  });
  const provenanceRows = await lastIntegrationChanges(tenantId);
  assert.equal(provenanceRows.gaMeasurementId?.actorLabel, "owner@example.test");
  assert.equal(provenanceRows.gaMeasurementId?.actorRole, "owner");
  assert.equal(provenanceRows.metaPixelId?.actorLabel, "admin@example.test");
  assert.equal(provenanceRows.metaPixelId?.actorRole, "platform-admin");
  assert.ok(provenanceRows.gaMeasurementId?.at instanceof Date, "and when it happened");
  // A field nobody has ever changed has no line at all, rather than "never": five cards saying
  // "never changed" is noise on every new store.
  assert.equal(provenanceRows.googleAdsId, undefined, "an untouched field reports nothing");
  // Changing the same field again moves its line to the newer actor.
  await recordIntegrationChange({
    tenantId,
    actorUserId: null,
    actorEmail: "owner@example.test",
    actorRole: "owner",
    changes: diffIntegrations({ ...after, metaPixelId: "222222222222" }, {
      ...after,
      metaPixelId: "333333333333",
    }),
  });
  const moved = await lastIntegrationChanges(tenantId);
  assert.equal(moved.metaPixelId?.actorLabel, "owner@example.test", "newest write wins");
  ok("D40b", "each field reports its own last actor and time, and the newest write wins");

  // The owner must have no route to the log itself: it is evidence about them, including about
  // their own edits, so they must not be able to read the trail, change it or erase it.
  //
  // ONE narrow window is allowed (D40b): `lastIntegrationChanges`, which answers "who last
  // changed this field, and when" for the screen that edits it. The rule below is therefore not
  // "no audit import under app/admin" but "no BROAD audit read, and the narrow one stays
  // narrow" — a rule that forbade the accessor outright would just be rewritten by the next
  // person who needs the line, and a rule that allowed any import would let the trail in.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (
        /\.tsx?$/.test(path) &&
        /analyticsAuditLog|listAnalyticsAudit|listPrivacyAudit/.test(readFileSync(path, "utf8"))
      ) {
        offenders.push(path);
      }
    }
  };
  walk("app/admin");
  assert.deepEqual(offenders, [], `the owner's own panel must not read the audit log: ${offenders}`);

  // And the window stays a window. Checked on the accessor itself: what it selects, that it
  // returns no values, and that it cannot write.
  const audit = readFileSync("lib/analytics/audit.ts", "utf8");
  const accessor = /export async function lastIntegrationChanges\([\s\S]*?\n}/.exec(audit)?.[0];
  assert.ok(accessor, "lastIntegrationChanges must exist");
  assert.ok(
    accessor.includes('action: "INTEGRATION_CHANGE"'),
    "it must read integration changes only, not privacy requests or console views",
  );
  assert.ok(accessor.includes("tenantId"), "and only for the store asking");
  // Comments stripped first, and matched as CALLS. The bare words caught this check's own
  // first run: the accessor explains that the log snapshots an email "so it survives the
  // account being deleted", and "deleted" is not a write. A check that cannot tell code from a
  // comment about code fails for the wrong reason, which is how a real rule gets deleted.
  const accessorCode = accessor
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const write of [".create(", ".createMany(", ".update(", ".updateMany(", ".delete(", ".deleteMany(", ".upsert("]) {
    assert.ok(!accessorCode.includes(write), `it must not call ${write} — it is a read`);
  }
  // The provenance type carries three fields and no value: `from`/`to` must stay in the log.
  const provenance = /export type FieldProvenance = \{[\s\S]*?\n};/.exec(audit)?.[0] ?? "";
  assert.ok(provenance, "FieldProvenance must be declared");
  for (const forbidden of ["from", "to:", "value", "detail"]) {
    assert.ok(
      !provenance.includes(forbidden),
      `FieldProvenance must not carry ${forbidden}: the owner sees who and when, not what it was`,
    );
  }
  ok(
    "P5-18a",
    "the owner's panel reads no audit trail; its one window returns an actor and a time per field",
  );

  // The format the provenance depends on, round-tripped: the writer and the reader of `detail`
  // are the same module, and this is what keeps them honest.
  const sample = [
    { field: "gaMeasurementId", from: null, to: "G-ABC123" },
    { field: "metaPixelId", from: "111111111111", to: null },
  ];
  assert.deepEqual(
    parseIntegrationFields(formatIntegrationDetail(sample)),
    ["gaMeasurementId", "metaPixelId"],
    "the detail format must round-trip to the fields it recorded",
  );
  assert.deepEqual(parseIntegrationFields(null), [], "no detail is no fields, not a crash");
  ok("D40b", "the audit detail round-trips to its field names, so provenance cannot drift");
}

/**
 * A request with a chosen Host header, which is the whole mechanism of the custom-domain leg:
 * `proxy.ts` routes on the host and nothing else, so this reaches the same code a real visitor
 * on the store's own domain reaches.
 *
 * node:http rather than fetch, because `host` is a forbidden header for fetch and undici
 * silently drops it — the first version of this check passed the header, was served the
 * platform's own home page with a 200, and asserted against the wrong document.
 */
function request(
  path: string,
  cookie: string,
  host?: string,
): Promise<{ status: number; body: string }> {
  const target = new URL(`${BASE}${path}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: "GET",
        headers: { ...(cookie ? { cookie } : {}), ...(host ? { host } : {}) },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** The storefront's head, fetched as a visitor — on the shared host and on the store's own. */
async function headChecks(slug: string, domain: string, tenantId: string) {
  const token = {
    metaDomain: "abc123def456ghi789",
    searchConsole: "Xy7_pQ-Rt9ZkLm4nOpQrStUvWxYz01234567890aB",
    pixel: "417283950671234",
  };
  await updateTenantIntegrations(tenantId, {
    metaDomainVerification: token.metaDomain,
    googleSiteVerification: token.searchConsole,
    metaPixelId: token.pixel,
  });

  const declined = `${consentCookieName(tenantId)}=${encodeConsent(
    buildStoredConsent({ noticeVersion: 1, grants: DENY_ALL, locale: "en" }),
  )}`;
  const accepted = `${consentCookieName(tenantId)}=${encodeConsent(
    buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
  )}`;

  const fetchHead = async (path: string, cookie: string, host?: string) => {
    const { status, body } = await request(path, cookie, host);
    assert.equal(status, 200, `${host ?? "shared host"}${path} returned ${status}`);
    return body;
  };

  // The shared host, for a visitor who declined everything.
  const shared = await fetchHead(`/store/${slug}`, declined);
  assert.match(shared, /facebook-domain-verification/, "the Meta token must be in the head");
  assert.ok(shared.includes(token.metaDomain), "with its value");
  assert.ok(shared.includes(token.searchConsole), "and the Search Console token too");
  // And nothing of the paste: the stored value is an id, so the page cannot carry a tag.
  assert.ok(!shared.includes("fbq('init'"), "no pasted script may reach the page");
  ok("P5-18d", "both verification tokens are in the storefront head for a visitor who declined");

  // Consent still governs the measurement tags. Checked on the shared host, before the custom
  // domain exists, because once a store has one the proxy redirects /store/<slug> to it.
  const acceptedHtml = await fetchHead(`/store/${slug}`, accepted);
  assert.ok(
    acceptedHtml.includes(token.pixel),
    "a visitor who accepted advertising must get the pixel id",
  );
  assert.ok(
    !shared.includes(token.pixel),
    "and a visitor who declined must not have the pixel id in their page at all",
  );
  ok("P5-16", "the pixel id reaches a consenting visitor's page and no part of a declining one's");

  // The store's own domain, which is what Meta and Google actually verify (D40a). The policy
  // for browser suites is that a custom-domain leg may not be skipped; the same rule is
  // honoured here with a Host header, which is all the proxy's host routing reads.
  await prisma.tenant.update({ where: { id: tenantId }, data: { domain } });
  const onDomain = await fetchHead("/", declined, domain);
  assert.ok(
    onDomain.includes(token.metaDomain),
    "the Meta token must be present on the store's own domain, which is the one Meta verifies",
  );
  assert.ok(onDomain.includes(token.searchConsole));
  ok("P5-18d", `both tokens are present on the store's own domain (${domain}), not only the shared host`);
}

async function main() {
  extractionChecks();
  consentChecks();
  ownerOnlyChecks();

  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({
    storeName: `Integrations ${run}`,
    ownerName: "I",
    ownerEmail: `integrations-${run}@example.test`,
    passwordHash: "x",
  });
  // The domain is set inside headChecks, after the shared-host leg: once a store has its own
  // domain the proxy redirects /store/<slug> to it, so the two legs cannot share a moment.
  const domain = `integrations-${run}.test`;

  try {
    await auditChecks(store.tenant.id);
    await headChecks(store.tenant.slug, domain, store.tenant.id);
  } finally {
    await prisma.tenant.delete({ where: { id: store.tenant.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: store.user.id } }).catch(() => {});
  }
}

main()
  .then(async () => {
    await prisma.$disconnect().catch(() => {});
    console.log(`\n${checks} checks passed.`);
  })
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => {});
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
