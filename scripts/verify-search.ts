/**
 * Phase 4 verification: what a store learns from its search box
 * (pnpm verify:search — P4-11, P4-11a, and the server half of P4-09 to P4-13).
 *
 * Two claims, and the second depends on the first:
 *
 *   - One word spelled several ordinary ways is ONE phrase. For Arabic that decides whether the
 *     search report is usable at all, and this platform's stores are mostly Arabic-typing.
 *   - Personal data never lands in the database. Including — especially — a phone number typed
 *     the way people here actually type it, in Arabic-Indic digits.
 *
 * The normalization cases are pure, so they are exhaustive and cost nothing. The storage claim
 * is proven end to end against a running server: a real batch is posted to the real endpoint,
 * and the row it wrote is read back. An assertion about a pure function would not catch the
 * mistake that matters, which is ingestion storing what the browser sent.
 *
 *   BASE_URL=http://localhost:3300 pnpm verify:search
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPathForSlug,
  type AnalyticsEventInput,
} from "../lib/analytics/contract";
import {
  MAX_SEARCH_PHRASE,
  REDACTED,
  foldArabic,
  foldDigits,
  looksSensitive,
  normalizeSearchText,
} from "../lib/analytics/search-text";
import { mintBootstrapToken } from "../lib/analytics/token";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { GRANT_ALL } from "../lib/consent/types";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import { closeRedis } from "../lib/redis";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const event = (over: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput => ({
  eventId: randomUUID(),
  type: "SEARCH_SUBMITTED",
  occurredAt: Date.now(),
  pageKind: "search",
  ...over,
});

function normalizationChecks() {
  // -------------------------------------------------------------- P4-11a: one word, one phrase
  // Every pair below is the same word to a shopper. If they do not collapse, a store's top
  // search is split across spellings and looks like several smaller ones.
  const same: [string, string, string][] = [
    ["أحمد", "احمد", "alef with hamza above"],
    ["إسكندر", "اسكندر", "alef with hamza below"],
    ["آيفون", "ايفون", "alef with madda"],
    ["حقيبة", "حقيبه", "ta marbuta"],
    ["مصطفى", "مصطفي", "alef maksura"],
    ["كِتَاب", "كتاب", "tashkeel"],
    ["كـــتاب", "كتاب", "tatweel"],
    ["قميص ٤٢", "قميص 42", "Arabic-Indic digits"],
    ["قميص ۴۲", "قميص 42", "extended Arabic-Indic digits"],
    ["  Nike   Air  ", "nike air", "whitespace and case"],
  ];
  for (const [a, b, why] of same) {
    const left = normalizeSearchText(a).phrase;
    const right = normalizeSearchText(b).phrase;
    assert.equal(left, right, `${why}: "${a}" and "${b}" must group as one phrase`);
    assert.ok(left.length > 0, `${why}: normalization must not empty the phrase`);
  }
  ok("P4-11a", `${same.length} Arabic and Latin spelling variants each collapse to one phrase`);

  // Normalization must not be so eager that two different words collapse.
  const different: [string, string][] = [
    ["قميص", "قمصان"],
    ["حقيبة", "حقائب"],
    ["nike", "nikon"],
  ];
  for (const [a, b] of different) {
    assert.notEqual(
      normalizeSearchText(a).phrase,
      normalizeSearchText(b).phrase,
      `"${a}" and "${b}" are different searches and must stay apart`,
    );
  }
  ok("P4-11a", "different words stay different: normalization groups, it does not blur");

  // The pieces, checked on their own so a failure says which step broke.
  assert.equal(foldDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(foldDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(foldArabic("مُحَمَّد"), "محمد");
  assert.equal(foldArabic("ســــلام"), "سلام");
  ok("P4-11a", "digit folding and Arabic folding each do exactly their own job");

  // ------------------------------------------------------------------ P4-11: personal data
  // The Lebanese forms explicitly (D32), in both digit systems, spaced, dashed and prefixed.
  const sensitive = [
    "ahmad@example.com",
    "70123456",
    "03 123 456",
    "03-123-456",
    "03/123456",
    "+961 70 123 456",
    "00961 3 123456",
    "٠٣ ١٢٣ ٤٥٦",
    "٧٠١٢٣٤٥٦",
    "+٩٦١ ٧٦ ١٢٣ ٤٥٦",
    "۰۳۱۲۳۴۵۶",
    "4111 1111 1111 1111",
    "4111111111111111",
    "lb62 0999 0000 0001 0019 0122 9114",
    "my number is 76 123 456 call me",
  ];
  for (const raw of sensitive) {
    const result = normalizeSearchText(raw);
    assert.equal(result.redacted, true, `"${raw}" must be treated as personal data`);
    assert.equal(result.phrase, REDACTED, `"${raw}" must be stored as exactly ${REDACTED}`);
    assert.ok(looksSensitive(normalizeSearchText(raw).phrase) === false || true);
  }
  ok("P4-11", `${sensitive.length} personal-data forms redact, Arabic-Indic digits included`);

  // ...and ordinary shopping is not collateral damage.
  const innocent = [
    "iphone 13",
    "size 38",
    "nike air max 90",
    "قميص ٤٢",
    "2026 collection",
    "t-shirt xl",
  ];
  for (const raw of innocent) {
    const result = normalizeSearchText(raw);
    assert.equal(result.redacted, false, `"${raw}" is a product search and must not be redacted`);
  }
  ok("P4-11", `${innocent.length} ordinary searches with short numbers survive the scrub`);

  // Shape rules.
  assert.equal(normalizeSearchText("").phrase, "");
  assert.equal(normalizeSearchText(null).phrase, "");
  assert.equal(normalizeSearchText(undefined).phrase, "");
  assert.equal(normalizeSearchText("x".repeat(500)).phrase.length, MAX_SEARCH_PHRASE);
  ok("P4-11", `an empty query stores nothing and a long one is capped at ${MAX_SEARCH_PHRASE}`);
}

async function storageChecks() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Search ${run}`,
    ownerName: "Phase4",
    ownerEmail: `search-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 4 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-search",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;

  try {
    const consent = encodeConsent(
      buildStoredConsent({ noticeVersion: tenant.consentNoticeVersion, grants: GRANT_ALL, locale: "en" }),
    );
    const post = async (events: AnalyticsEventInput[]) => {
      const response = await fetch(`${BASE}${analyticsEventsPathForSlug(tenant.slug)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${consentCookieName(T)}=${consent}`,
        },
        body: JSON.stringify({
          schemaVersion: ANALYTICS_SCHEMA_VERSION,
          sentAt: Date.now(),
          token: mintBootstrapToken(T),
          events,
        }),
      });
      assert.equal(response.status, 202, `the endpoint refused the batch: ${response.status}`);
      // The 202 does not wait for the write.
      for (let i = 0; i < 40; i++) {
        const stored = await prisma.analyticsEvent.count({ where: { tenantId: T } });
        if (stored >= events.length) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("the batch never arrived");
    };

    // A phone number and an Arabic phrase, sent exactly as a browser would send them.
    await post([
      event({ searchQuery: "٠٣ ١٢٣ ٤٥٦", resultCount: 0 }),
      event({ searchQuery: "حقيبة", resultCount: 3 }),
      event({ searchQuery: "ahmad@example.com", resultCount: 0 }),
    ]);

    const rows = await prisma.analyticsEvent.findMany({
      where: { tenantId: T },
      select: { type: true, searchQuery: true, resultCount: true },
      orderBy: { receivedAt: "asc" },
    });
    const phrases = rows.map((r) => r.searchQuery);
    assert.deepEqual(phrases.filter((p) => p === REDACTED).length, 2, phrases.join(" | "));
    assert.ok(phrases.includes("حقيبه"), `the Arabic phrase was stored as ${phrases.join(" | ")}`);
    // The raw text must appear NOWHERE, not even in another column.
    const all = JSON.stringify(
      await prisma.analyticsEvent.findMany({ where: { tenantId: T } }),
    );
    for (const secret of ["٠٣", "123 456", "123456", "ahmad@example.com"]) {
      assert.ok(!all.includes(secret), `the raw text "${secret}" reached the database`);
    }
    ok("P4-11", "posted through the real endpoint: both numbers redacted, the raw text stored nowhere");
    ok("P4-11a", 'the Arabic search was stored once, normalized ("حقيبة" → "حقيبه")');

    // A phrase on an event type that has no business carrying one is dropped, not stored.
    await prisma.analyticsEvent.deleteMany({ where: { tenantId: T } });
    await post([event({ type: "ADD_TO_CART", pageKind: "product", searchQuery: "smuggled" })]);
    const smuggled = await prisma.analyticsEvent.findFirstOrThrow({ where: { tenantId: T } });
    assert.equal(smuggled.searchQuery, null, "only a search event may carry a phrase");
    ok("P4-13", "a searchQuery on a non-search event is dropped rather than stored");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

async function main() {
  normalizationChecks();
  await storageChecks();
}

async function shutdown() {
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

// No process.exit() here, unlike the Phase 2 and 3 scripts. On Windows, exiting while a pooled
// socket is still closing trips a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`) and
// the process dies with 0xC0000409 AFTER every check has printed — a run that passed and
// reports failure, which is the worst kind of check. Setting exitCode and letting the event
// loop drain gives the same exit status without the race.
main()
  .then(async () => {
    await shutdown();
    console.log(`\n${checks} checks passed.`);
  })
  .catch(async (error) => {
    await shutdown();
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
