/**
 * Phase 4 verification: where a visit came from (pnpm verify:acquisition — P4-14 to P4-17).
 *
 * Every claim here is proven through the real ingestion endpoint rather than against the pure
 * classifier, because the mistake that matters is not "the ladder is wrong" — it is "the ladder
 * is right and the session row says something else". P4-15 is exactly that mistake, found while
 * writing this phase's plan: the touch was written when the session row was created and never
 * revisited, so a visitor who arrived direct and came back through a campaign link kept
 * `source = null` for the whole half-hour and the campaign was credited to nothing.
 *
 *   BASE_URL=http://localhost:3300 pnpm verify:acquisition
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPathForSlug,
  type AnalyticsEventInput,
  type AttributionContext,
} from "../lib/analytics/contract";
import { classifyHost, resolveAttribution } from "../lib/analytics/attribution";
import { SESSION_COOKIE_PREFIX, VISITOR_COOKIE_PREFIX } from "../lib/analytics/identity";
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
  type: "PAGE_VIEW",
  occurredAt: Date.now(),
  pageKind: "home",
  ...over,
});

function ladderChecks() {
  // --------------------------------------------------------------- P4-14: each rung, in order
  const cases: [string, AttributionContext, string, string][] = [
    [
      "an explicit utm_source wins over everything else",
      { source: "newsletter", medium: "email", campaign: "nov", referrerHost: "facebook.com", hasAdClick: true },
      "campaign",
      "newsletter",
    ],
    [
      "a gclid with no UTM is still a paid click",
      { hasAdClick: true, referrerHost: "google.com" },
      "paid",
      "ad-click",
    ],
    ["a social referrer", { referrerHost: "m.facebook.com" }, "social", "facebook"],
    ["an instagram referrer", { referrerHost: "l.instagram.com" }, "social", "instagram"],
    ["a WhatsApp referrer", { referrerHost: "wa.me" }, "social", "whatsapp"],
    ["organic search", { referrerHost: "www.google.com" }, "search", "google"],
    ["organic search, country domain", { referrerHost: "google.co.uk" }, "search", "google"],
    ["any other referrer", { referrerHost: "blog.example.org" }, "referral", "blog.example.org"],
    ["nothing at all", {}, "direct", ""],
  ];
  for (const [why, context, kind, source] of cases) {
    const resolved = resolveAttribution(context);
    assert.equal(resolved.sourceKind, kind, `${why}: expected ${kind}`);
    assert.equal(resolved.source ?? "", source, `${why}: expected source ${source || "null"}`);
  }
  ok("P4-14", `all ${cases.length} rungs of §3.5's ladder classify as specified`);

  // The implied medium is a convention, and an explicit one always beats it.
  assert.equal(resolveAttribution({ referrerHost: "facebook.com" }).medium, "social");
  assert.equal(resolveAttribution({ referrerHost: "google.com" }).medium, "organic");
  assert.equal(resolveAttribution({ hasAdClick: true }).medium, "cpc");
  assert.equal(
    resolveAttribution({ referrerHost: "facebook.com", medium: "paid-social" }).medium,
    "paid-social",
    "a merchant's own utm_medium must win over our guess",
  );
  assert.equal(resolveAttribution({}).medium, null, "direct has no medium, not a made-up one");
  ok("P4-14", "an implied medium fills a gap and never overrides what the link said");

  // Subdomain folding, so one channel is one row in a report.
  for (const host of ["facebook.com", "www.facebook.com", "m.facebook.com", "l.facebook.com"]) {
    assert.equal(classifyHost(host).name, "facebook", `${host} must fold to one channel`);
  }
  assert.equal(classifyHost("notfacebook.com").name, "notfacebook.com", "a lookalike is not it");
  ok("P4-14", "subdomains fold to one channel and a lookalike host does not");
}

async function storedChecks() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Acquisition ${run}`,
    ownerName: "Phase4",
    ownerEmail: `acquisition-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 4 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-acquisition",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;

  try {
    const consentCookie = `${consentCookieName(T)}=${encodeConsent(
      buildStoredConsent({ noticeVersion: tenant.consentNoticeVersion, grants: GRANT_ALL, locale: "en" }),
    )}`;

    /** Posts a batch and returns the cookies the endpoint set, so the next batch is the same
     *  visitor and the same session — which is what makes P4-15 a real sequence. */
    const post = async (context: AttributionContext | undefined, cookies: string) => {
      const response = await fetch(`${BASE}${analyticsEventsPathForSlug(tenant.slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookies },
        body: JSON.stringify({
          schemaVersion: ANALYTICS_SCHEMA_VERSION,
          sentAt: Date.now(),
          token: mintBootstrapToken(T),
          events: [event(context ? { attributionContext: context } : {})],
        }),
      });
      assert.equal(response.status, 202);
      const set = response.headers.getSetCookie?.() ?? [];
      const identity = set
        .map((c) => c.split(";")[0])
        .filter((c) => c.startsWith(VISITOR_COOKIE_PREFIX) || c.startsWith(SESSION_COOKIE_PREFIX));
      // Give the write a moment; a 202 does not wait for it.
      await new Promise((r) => setTimeout(r, 400));
      return [cookies, ...identity].join("; ");
    };

    const session = () =>
      prisma.analyticsSession.findFirstOrThrow({
        where: { tenantId: T },
        orderBy: { startedAt: "desc" },
      });
    const visitor = () =>
      prisma.analyticsVisitor.findFirstOrThrow({ where: { tenantId: T }, orderBy: { firstSeenAt: "desc" } });

    // ------------------------------------------------- P4-15: a direct visit, then a campaign
    let cookies = await post(undefined, consentCookie);
    const afterDirect = await session();
    assert.equal(afterDirect.sourceKind, "direct");
    assert.equal(afterDirect.source, null, "direct is stored as an absence, not as a source");

    cookies = await post({ source: "newsletter", medium: "email", campaign: "nov" }, cookies);
    const afterCampaign = await session();
    assert.equal(
      afterCampaign.id,
      afterDirect.id,
      "the same visitor within the window must still be the same session",
    );
    assert.equal(
      afterCampaign.source,
      "newsletter",
      "D24: a campaign arriving mid-session must become the session's touch — this is the bug " +
        "this check exists for, where the touch was written once at creation and never revisited",
    );
    assert.equal(afterCampaign.sourceKind, "campaign");
    assert.equal(afterCampaign.campaign, "nov");
    ok("P4-15", "a campaign arriving mid-session becomes the session's last non-direct touch");

    // ...and a later direct page view does not erase it.
    cookies = await post(undefined, cookies);
    const afterSecondDirect = await session();
    assert.equal(afterSecondDirect.id, afterDirect.id);
    assert.equal(
      afterSecondDirect.source,
      "newsletter",
      "a direct page view must never erase the campaign that brought the visitor",
    );
    assert.equal(afterSecondDirect.sourceKind, "campaign");
    ok("P4-15", "a direct visit afterwards leaves the campaign intact: last NON-DIRECT touch");

    // A newer non-direct touch does replace an older one — that is what "last" means.
    cookies = await post({ referrerHost: "m.facebook.com" }, cookies);
    const afterSocial = await session();
    assert.equal(afterSocial.source, "facebook");
    assert.equal(afterSocial.sourceKind, "social");
    assert.equal(afterSocial.medium, "social");
    assert.equal(afterSocial.referrerHost, "m.facebook.com", "the host is kept as reported");
    ok("P4-15", "a newer non-direct touch replaces an older one");

    // ------------------------------------------------------------------- P4-16: first touch
    const v = await visitor();
    assert.equal(
      v.firstSource,
      "newsletter",
      "first touch is the first arrival we could attribute, and it does not move",
    );
    assert.equal(v.firstCampaign, "nov");
    ok("P4-16", "first touch stayed at the newsletter while last touch moved to facebook");

    // ------------------------------------------------- P4-17: no click id, no referring URL
    // The client is not even able to send these — the contract is strict — so what is checked
    // here is that nothing resembling one reached the database by another route.
    const everything = JSON.stringify([
      await prisma.analyticsSession.findMany({ where: { tenantId: T } }),
      await prisma.analyticsVisitor.findMany({ where: { tenantId: T } }),
      await prisma.analyticsEvent.findMany({ where: { tenantId: T } }),
    ]);
    // "/" and "?" are not in this list: they appear in every ISO timestamp and would make the
    // loop pass whatever happened. The hostname rule below is where those are really checked.
    for (const forbidden of ["gclid", "fbclid", "http://", "https://"]) {
      assert.ok(
        !everything.includes(forbidden),
        `something that looks like a URL or a click id reached the database: ${forbidden}`,
      );
    }
    const hosts = (await prisma.analyticsSession.findMany({
      where: { tenantId: T },
      select: { referrerHost: true },
    }))
      .map((s) => s.referrerHost)
      .filter(Boolean) as string[];
    for (const host of hosts) {
      assert.ok(!host.includes("/"), `a referrer host must be a hostname, not a URL: ${host}`);
      assert.ok(!host.includes("?"), `a referrer host must carry no query: ${host}`);
    }
    // A client that tries to send a full URL as the referrer host is refused by the contract.
    const smuggle = await fetch(`${BASE}${analyticsEventsPathForSlug(tenant.slug)}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        sentAt: Date.now(),
        token: mintBootstrapToken(T),
        events: [event({ attributionContext: { referrerHost: "x".repeat(300) } })],
      }),
    });
    assert.equal(smuggle.status, 400, "an over-long referrer host must be refused outright");
    ok("P4-17", "no click id and no referring URL is stored, and an over-long host is refused");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

/**
 * P4-35: the link builder is movable, and builds a link the server will classify.
 *
 * "Movable" is a structural property, so it is checked structurally: what would stop Phase 5
 * mounting this component in its Marketing tab is a dependency on the page it is on today.
 * Mounting it at a throwaway second route to prove the same thing would add production code
 * that exists only for a test, and would still not catch the coupling — a component that calls
 * usePathname renders fine at two paths and behaves wrongly at both.
 *
 * The second half is the one that would actually hurt a merchant: the UTM values this produces
 * must be the values lib/analytics/attribution.ts classifies, or a tagged Instagram link lands
 * in a different report row from untagged Instagram traffic and one channel reads as two.
 */
function linkBuilderChecks() {
  const raw = readFileSync("components/analytics/link-builder.tsx", "utf8");
  // Comments are stripped first. The component's own header EXPLAINS that it must not reach for
  // usePathname, and a scan over the prose would match that sentence and fail a component that
  // is correct — a check that cannot tell code from a comment about code is worse than none.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const forbidden = [
    ["usePathname", "the path it is mounted at"],
    ["useRouter", "navigation"],
    ["useSearchParams", "the query it is mounted with"],
    ["use server", "a server action"],
    ["@/lib/data/", "data loading"],
    ["@/lib/prisma", "the database"],
    ["next/navigation", "the router"],
  ] as const;
  for (const [needle, what] of forbidden) {
    assert.ok(
      !source.includes(needle),
      `the link builder reaches for ${what} (${needle}), so Phase 5 cannot move it unchanged`,
    );
  }
  assert.ok(raw.includes('"use client"'), "it is a client component");
  assert.ok(
    /export function LinkBuilder\(\{[\s\S]*?storeUrl[\s\S]*?destinations/.test(source),
    "its inputs must arrive as props: the store URL and the destinations",
  );
  ok("P4-35", `the builder depends on none of ${forbidden.length} things that would pin it to a page`);

  // The route is where the coupling lives, which is the point.
  const page = readFileSync("app/admin/(panel)/analytics/links/page.tsx", "utf8");
  assert.ok(page.includes("getStoreUrl"), "the route resolves the store's own URL");
  assert.ok(page.includes("requireOwner"), "and it is the owner's page");
  assert.ok(page.includes("<LinkBuilder"), "and it mounts the component");
  ok("P4-35", "the route holds the URL resolution and the data loading, the component holds none");

  // Every channel the builder offers must be a channel the ladder recognises, or a merchant's
  // own link splits from their organic traffic from the same place.
  const channels = [...source.matchAll(/source: "([a-z-]*)", medium: "([a-z-]+)"/g)].map((m) => ({
    source: m[1],
    medium: m[2],
  }));
  assert.ok(channels.length >= 5, `expected the channel table, found ${channels.length} entries`);
  for (const channel of channels) {
    if (!channel.source) continue; // the "something else" row, named by the merchant
    const classified = resolveAttribution({ referrerHost: `${channel.source}.com` });
    const tagged = resolveAttribution({ source: channel.source, medium: channel.medium });
    assert.equal(tagged.source, channel.source, `a tagged ${channel.source} link keeps its source`);
    assert.equal(tagged.sourceKind, "campaign", "an explicit utm_source is always a campaign");
    // Where the host is one the ladder knows, the tagged medium must match what it infers, so
    // the two land in one row rather than two.
    if (classified.sourceKind === "social" || classified.sourceKind === "search") {
      assert.equal(
        channel.medium,
        classified.medium,
        `${channel.source}: the builder tags medium "${channel.medium}" while the ladder infers ` +
          `"${classified.medium}" for the same place, so one channel would read as two`,
      );
    }
  }
  ok("P4-35", `all ${channels.length} offered channels tag what the server's ladder classifies`);
}

async function main() {
  ladderChecks();
  linkBuilderChecks();
  await storedChecks();
}

async function shutdown() {
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

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
