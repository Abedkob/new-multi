/**
 * Phase 2 ingestion verification (pnpm verify:ingestion).
 *
 * Covers the PHASE_2_PLAN.md checklist that does not need a browser: what the endpoint accepts
 * and refuses, how identity and sessions behave, what the tables may hold, tenant isolation
 * under the restricted role, presence, and the custom-domain path. The browser-side items
 * (nothing leaving the page before consent, checkout under load) belong to pnpm e2e:analytics.
 *
 * Every check prints the acceptance id it answers, so a passing run is the evidence for those
 * rows.
 *
 * Needs a server started with ANALYTICS_ROLLOUT_MODE=all, and the same ANALYTICS_SIGNING_SECRET
 * as that server, since this script mints tokens and consent cookies the way the app does:
 *
 *   BASE_URL=http://localhost:3200 pnpm verify:ingestion
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { parse as parseEnvFile } from "dotenv";
import { prisma } from "../lib/prisma";
import { createCategory } from "../lib/data/categories";
import { createProduct } from "../lib/data/products";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import {
  ANALYTICS_SCHEMA_VERSION,
  MAX_BATCH_EVENTS,
  analyticsEventsPathForSlug,
  analyticsPresencePathForSlug,
  type AnalyticsEventInput,
} from "../lib/analytics/contract";
import { clampOccurredAt } from "../lib/analytics/ingest";
import { sessionCookieName, visitorCookieName } from "../lib/analytics/identity";
import { activeVisitors, markActive, presenceWindowMs } from "../lib/analytics/presence";
import { mintBootstrapToken } from "../lib/analytics/token";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { DENY_ALL, GRANT_ALL } from "../lib/consent/types";
import { closeRedis } from "../lib/redis";
import { RATE_LIMITS, rateLimit } from "../lib/rate-limit";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

async function makeStore(label: string) {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Ingest ${label} ${run}`,
    ownerName: label,
    ownerEmail: `ingest-${label}-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: `${label} Ltd`,
      privacyEmail: `privacy-${label}-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-ingestion",
      jointControllerVersion: "2026-11",
    },
  });
  const category = await createCategory(tenant.id, { name: "Things", parentId: null });
  const product = await createProduct(tenant.id, {
    name: `${label} Item`,
    description: "x",
    basePriceCents: 1000,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: category.id,
    variants: [{ attributes: {}, stock: 10, priceCentsOverride: null, imageUrl: null }],
  });
  return {
    tenant,
    user,
    product,
    variantId: product.variants[0].id,
    consentCookie: `${consentCookieName(tenant.id)}=${encodeConsent(
      buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
    )}`,
    endpoint: `${BASE}${analyticsEventsPathForSlug(tenant.slug)}`,
    presence: `${BASE}${analyticsPresencePathForSlug(tenant.slug)}`,
  };
}

const event = (over: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput => ({
  eventId: randomUUID(),
  type: "PAGE_VIEW",
  occurredAt: Date.now(),
  pageKind: "home",
  ...over,
});

const envelope = (tenantId: string, events: AnalyticsEventInput[], over: object = {}) => ({
  schemaVersion: ANALYTICS_SCHEMA_VERSION,
  sentAt: Date.now(),
  token: mintBootstrapToken(tenantId),
  events,
  ...over,
});

type SendResult = { status: number; cookies: string[] };

async function send(
  url: string,
  body: unknown,
  cookie: string,
  headers: Record<string, string> = {},
): Promise<SendResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, cookies: response.headers.getSetCookie?.() ?? [] };
}

/** Wait for the write that a 202 does not wait for. */
const settle = () => new Promise((r) => setTimeout(r, 400));

const cookieValue = (cookies: string[], name: string) =>
  cookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0].split("=").slice(1).join("=") ?? null;

const cookieAttrs = (cookies: string[], name: string) =>
  cookies.find((c) => c.startsWith(`${name}=`)) ?? "";

async function main() {
  const a = await makeStore("alpha");
  const b = await makeStore("beta");

  try {
    // ---------------------------------------------------------------- the endpoint is reachable
    const live = await send(a.endpoint, envelope(a.tenant.id, [event()]), a.consentCookie);
    assert.equal(live.status, 202, `expected 202, got ${live.status}`);
    await settle();
    assert.ok(
      (await prisma.analyticsEvent.count({ where: { tenantId: a.tenant.id } })) > 0,
      "Nothing stored. Is the server running with ANALYTICS_ROLLOUT_MODE=all and the same " +
        "ANALYTICS_SIGNING_SECRET as this script?",
    );
    ok("P2-06", "a valid batch returns 202 and persists its events");

    // ---------------------------------------------------------------- consent governs writes
    const refusedCookie = `${consentCookieName(b.tenant.id)}=${encodeConsent(
      buildStoredConsent({ noticeVersion: 1, grants: DENY_ALL, locale: "en" }),
    )}`;
    const refused = await send(b.endpoint, envelope(b.tenant.id, [event()]), refusedCookie);
    const noCookie = await send(b.endpoint, envelope(b.tenant.id, [event()]), "");
    await settle();
    assert.equal(refused.status, 202);
    assert.equal(noCookie.status, 202);
    assert.equal(await prisma.analyticsEvent.count({ where: { tenantId: b.tenant.id } }), 0);
    ok("P2-03", "a refusal, and a missing consent cookie, write nothing and still answer 202");

    assert.deepEqual(
      [...refused.cookies, ...noCookie.cookies].filter((c) => c.startsWith("store_")),
      [],
      "no identifier may be minted for a visitor who has not agreed",
    );
    ok("P2-05", "no visitor or session cookie is minted without consent");

    // ---------------------------------------------------------------- the bootstrap token
    const noToken = await send(
      b.endpoint,
      { ...envelope(b.tenant.id, [event()]), token: "not-a-token" },
      b.consentCookie,
    );
    const otherTenantToken = await send(
      b.endpoint,
      { ...envelope(b.tenant.id, [event()]), token: mintBootstrapToken(a.tenant.id) },
      b.consentCookie,
    );
    const expired = await send(
      b.endpoint,
      {
        ...envelope(b.tenant.id, [event()]),
        token: mintBootstrapToken(b.tenant.id, Date.now() - 60 * 60_000),
      },
      b.consentCookie,
    );
    await settle();
    assert.equal(await prisma.analyticsEvent.count({ where: { tenantId: b.tenant.id } }), 0);
    for (const r of [noToken, otherTenantToken, expired]) assert.equal(r.status, 202);
    ok("P2-08", "a malformed, expired, or another store's token is refused and writes nothing");

    // ---------------------------------------------------------------- envelope validation
    const tooMany = await send(
      a.endpoint,
      envelope(
        a.tenant.id,
        Array.from({ length: MAX_BATCH_EVENTS + 1 }, () => event()),
      ),
      a.consentCookie,
    );
    assert.equal(tooMany.status, 400, "a batch over the limit must be rejected");
    const huge = await send(
      a.endpoint,
      JSON.stringify({
        ...envelope(a.tenant.id, [event()]),
        token: "x".repeat(40_000),
      }),
      a.consentCookie,
    );
    assert.equal(huge.status, 400, "an oversized body must be rejected");
    ok("P2-09", "an over-long batch and an oversized body are both 400");

    const unknownType = await send(
      a.endpoint,
      envelope(a.tenant.id, [{ ...event(), type: "NOT_A_TYPE" } as unknown as AnalyticsEventInput]),
      a.consentCookie,
    );
    const badShape = await send(a.endpoint, { nope: true }, a.consentCookie);
    assert.equal(unknownType.status, 400);
    assert.equal(badShape.status, 400);
    ok("P2-10", "an unknown event type and a malformed envelope are both 400");

    // The schema is strict, so a field the browser must not control is a rejection rather than
    // something quietly ignored.
    for (const forbidden of [
      { tenantId: b.tenant.id },
      { visitorId: "forged" },
      { sessionId: "forged" },
      { country: "LB" },
      { valueCents: 999_999 },
    ]) {
      const response = await send(
        a.endpoint,
        envelope(a.tenant.id, [{ ...event(), ...forbidden } as AnalyticsEventInput]),
        a.consentCookie,
      );
      assert.equal(
        response.status,
        400,
        `the client must not be able to set ${Object.keys(forbidden)[0]}`,
      );
    }
    ok("P2-14", "tenant, visitor, session, country and money values are all refused from a client");

    // searchQuery is different: the contract allows it because only the browser knows what was
    // typed. Phase 2 discarded it outright; from Phase 4 it is stored, but only ever after the
    // server has normalized and scrubbed it (lib/analytics/search-text.ts) — so what must hold
    // here is the part that never changes: NOTHING a client sends is stored as sent.
    const withSearch = await send(
      a.endpoint,
      envelope(a.tenant.id, [
        event({ type: "SEARCH_SUBMITTED", pageKind: "search", searchQuery: "someone@example.com" }),
      ]),
      a.consentCookie,
    );
    await settle();
    assert.equal(withSearch.status, 202, "the contract accepts search text for Phase 4");
    const searchRows = await prisma.analyticsEvent.findMany({
      where: { tenantId: a.tenant.id, searchQuery: { not: null } },
      select: { searchQuery: true },
    });
    assert.deepEqual(
      searchRows.map((r) => r.searchQuery),
      ["[redacted]"],
      "an email address typed into a search box must be stored as [redacted], never as itself",
    );
    assert.equal(
      await prisma.analyticsEvent.count({
        where: { tenantId: a.tenant.id, searchQuery: { contains: "someone" } },
      }),
      0,
      "the raw text a client sent must appear nowhere",
    );
    ok("P2-14", "client-supplied search text is scrubbed server-side, never stored as sent");

    // ---------------------------------------------------------------- cross-store ownership
    const before = await prisma.analyticsEvent.count({ where: { tenantId: a.tenant.id } });
    const foreign = await send(
      a.endpoint,
      envelope(a.tenant.id, [
        event({ type: "PRODUCT_VIEW", pageKind: "product", productId: b.product.id }),
        event({ type: "PRODUCT_VIEW", pageKind: "product", productId: a.product.id }),
      ]),
      a.consentCookie,
    );
    await settle();
    assert.equal(foreign.status, 202);
    const after = await prisma.analyticsEvent.count({ where: { tenantId: a.tenant.id } });
    assert.equal(after - before, 1, "only the event naming its own store's product may be stored");
    assert.equal(
      await prisma.analyticsEvent.count({
        where: { tenantId: a.tenant.id, productId: b.product.id },
      }),
      0,
    );
    ok("P2-11", "an event naming another store's product is dropped while the batch is accepted");

    // ---------------------------------------------------------------- timestamp clamping
    const now = Date.now();
    assert.ok(clampOccurredAt(now + 60 * 60_000, now).getTime() <= now, "future clamped to now");
    assert.ok(
      clampOccurredAt(now - 365 * 86400_000, now).getTime() > now - 7 * 86400_000,
      "an ancient timestamp is pulled into the retention window",
    );
    const far = await send(
      a.endpoint,
      envelope(a.tenant.id, [event({ occurredAt: now + 86400_000 })]),
      a.consentCookie,
    );
    await settle();
    assert.equal(far.status, 202);
    const future = await prisma.analyticsEvent.count({
      where: { tenantId: a.tenant.id, occurredAt: { gt: new Date(Date.now() + 60_000) } },
    });
    assert.equal(future, 0, "no stored event may sit in the future");
    ok("P2-12", "client clocks are clamped: nothing is stored in the future or before retention");

    // ---------------------------------------------------------------- identity and sessions
    const firstVisit = await send(
      a.endpoint,
      envelope(a.tenant.id, [
        event({
          pageKind: "product",
          attributionContext: {
            source: "instagram",
            medium: "social",
            campaign: "eid",
            referrerHost: "l.instagram.com",
            hasAdClick: true,
          },
        }),
      ]),
      a.consentCookie,
    );
    await settle();
    const visitorCookie = cookieAttrs(firstVisit.cookies, visitorCookieName(a.tenant.id));
    const sessionCookie = cookieAttrs(firstVisit.cookies, sessionCookieName(a.tenant.id));
    assert.ok(visitorCookie && sessionCookie, "both identity cookies must be set");
    for (const [label, raw] of [
      ["visitor", visitorCookie],
      ["session", sessionCookie],
    ] as const) {
      assert.match(raw, /HttpOnly/i, `${label} cookie must be HttpOnly`);
      assert.match(raw, /SameSite=Lax/i, `${label} cookie must be SameSite=Lax`);
      assert.match(
        raw,
        new RegExp(`Path=/store/${a.tenant.slug}`, "i"),
        `${label} cookie must be scoped to this store`,
      );
    }
    ok("P2-16", "visitor and session cookies are HttpOnly, Lax and scoped to the store's path");

    const identity = [
      `${visitorCookieName(a.tenant.id)}=${cookieValue(firstVisit.cookies, visitorCookieName(a.tenant.id))}`,
      `${sessionCookieName(a.tenant.id)}=${cookieValue(firstVisit.cookies, sessionCookieName(a.tenant.id))}`,
    ].join("; ");

    const session = await prisma.analyticsSession.findFirstOrThrow({
      where: { tenantId: a.tenant.id },
      orderBy: { startedAt: "desc" },
    });
    assert.equal(session.source, "instagram");
    assert.equal(session.medium, "social");
    assert.equal(session.campaign, "eid");
    assert.equal(session.landingPageKind, "product");
    assert.equal(session.hasAdClick, true);
    ok("P2-20", "the session carries its landing page and last non-direct source");

    const sessionColumns = Object.keys(session);
    assert.ok(
      !sessionColumns.some((c) => /gclid|fbclid|click/i.test(c) && c !== "hasAdClick"),
      "an ad click must be a boolean, never an id",
    );
    ok("P2-21", "an ad click is recorded as a marker only; no click id exists to store");

    // Scoped to THIS visitor: every cookieless batch earlier in this run minted its own
    // visitor and session, so a tenant-wide count would be measuring the test's own setup.
    const visitorId = session.visitorId;
    const sessionsOfVisitor = () =>
      prisma.analyticsSession.count({ where: { tenantId: a.tenant.id, visitorId } });

    // Same identity again: same visitor, same session.
    const second = await send(
      a.endpoint,
      envelope(a.tenant.id, [event()]),
      `${a.consentCookie}; ${identity}`,
    );
    await settle();
    assert.equal(second.status, 202);
    assert.equal(await sessionsOfVisitor(), 1, "a second batch must not start a second session");
    ok("P2-18", "activity inside the window continues the same session");

    // Age the session past the inactivity window, then send again.
    await prisma.analyticsSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date(Date.now() - 31 * 60_000) },
    });
    const third = await send(
      a.endpoint,
      envelope(a.tenant.id, [event()]),
      `${a.consentCookie}; ${identity}`,
    );
    await settle();
    assert.equal(third.status, 202);
    assert.equal(await sessionsOfVisitor(), 2, "a gap past the window must start a new session");
    assert.equal(
      await prisma.analyticsVisitor.count({ where: { tenantId: a.tenant.id, id: visitorId } }),
      1,
      "the returning visitor keeps their one visitor row",
    );
    ok("P2-18", "a gap past the inactivity window starts a new session");
    ok("P2-19", "a returning visitor keeps one visitor row and gains a second session");

    // ---------------------------------------------------------------- cross-store identity
    const bFirst = await send(b.endpoint, envelope(b.tenant.id, [event()]), b.consentCookie);
    await settle();
    const aVisitorId = cookieValue(firstVisit.cookies, visitorCookieName(a.tenant.id));
    const bVisitorId = cookieValue(bFirst.cookies, visitorCookieName(b.tenant.id));
    assert.ok(aVisitorId && bVisitorId);
    assert.notEqual(
      visitorCookieName(a.tenant.id),
      visitorCookieName(b.tenant.id),
      "each store must have its own cookie name",
    );
    assert.notEqual(aVisitorId, bVisitorId, "the same browser must be two unrelated visitors");
    ok("P2-17", "two stores give the same browser two unrelated identities");

    // ---------------------------------------------------------------- custom domain
    await prisma.tenant.update({
      where: { id: b.tenant.id },
      data: { domain: "ingest-verify.test" },
    });
    const onDomain = await send(b.endpoint, envelope(b.tenant.id, [event()]), b.consentCookie, {
      host: "ingest-verify.test",
    });
    await settle();
    assert.equal(onDomain.status, 202);
    const domainCookie = cookieAttrs(onDomain.cookies, visitorCookieName(b.tenant.id));
    assert.match(domainCookie, /Path=\/(;|$)/i, "a custom domain's root IS the store");
    assert.ok(
      !/Path=\/store\//i.test(domainCookie),
      "a store on its own domain must not scope cookies to a path that does not exist there",
    );
    ok("P2-16", "on a custom domain the identity cookies scope to / rather than /store/<slug>");
    await prisma.tenant.update({ where: { id: b.tenant.id }, data: { domain: null } });

    // ---------------------------------------------------------------- what the tables may hold
    const columnsOf = async (table: string) =>
      (
        await prisma.$queryRawUnsafe<{ column_name: string }[]>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`,
        )
      ).map((r) => r.column_name);

    const forbidden = /^(ip|ipAddress|userAgent|referrer|referer|url|path|fullUrl|email|phone)$/i;
    for (const table of ["AnalyticsVisitor", "AnalyticsSession", "AnalyticsEvent"]) {
      const columns = await columnsOf(table);
      const offenders = columns.filter((c) => forbidden.test(c));
      assert.deepEqual(offenders, [], `${table} must not store ${offenders.join(", ")}`);
    }
    ok("P2-24", "no analytics table has a column for an IP, a user agent, a referrer or a URL");

    // ---------------------------------------------------------------- isolation under RLS
    const restricted = parseEnvFile(readFileSync(".env")).APP_DATABASE_URL;
    assert.ok(restricted, "APP_DATABASE_URL must be set to verify RLS");
    const client = new Client({ connectionString: restricted });
    await client.connect();
    try {
      const role = await client.query(
        "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
      );
      assert.equal(role.rows[0].rolsuper, false);
      assert.equal(role.rows[0].rolbypassrls, false);

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [b.tenant.id]);
      const seen = await client.query('select count(*)::int c from "AnalyticsEvent" where "tenantId" = $1', [
        a.tenant.id,
      ]);
      assert.equal(seen.rows[0].c, 0, "store B must not see store A's events");
      await client.query("COMMIT");

      // A composite foreign key makes a cross-tenant link impossible even with direct SQL.
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass', 'on', true)", []);
      await assert.rejects(
        client.query(
          `insert into "AnalyticsSession" ("id","tenantId","visitorId","startedAt","lastActivityAt")
           values ($1, $2, (select id from "AnalyticsVisitor" where "tenantId" = $3 limit 1), now(), now())`,
          [`x-${Date.now()}`, b.tenant.id, a.tenant.id],
        ),
        /foreign key|violates/i,
        "a session must not be able to reference another store's visitor",
      );
      await client.query("ROLLBACK");
      ok("P2-22", "under RLS a store sees none of another's analytics rows");
      ok("P2-23", "a composite foreign key blocks a cross-tenant session to visitor link");
    } finally {
      await client.end();
    }

    // ---------------------------------------------------------------- presence
    const presenceSessionId = (
      await prisma.analyticsSession.findFirstOrThrow({ where: { tenantId: a.tenant.id } })
    ).id;
    const touched = await markActive(a.tenant.id, presenceSessionId);
    const count = await activeVisitors(a.tenant.id);
    if (count.available) {
      assert.ok(touched, "a reachable Redis should accept the touch");
      assert.ok(count.count >= 1, "the session just marked must be counted");
      ok("P2-26", `active-now counted ${count.count} session(s) inside the ${presenceWindowMs() / 60_000}-minute window`);
    } else {
      // Redis unreachable in this environment: then the contract under test is the other one.
      assert.equal(touched, false);
      ok("P2-27", "with Redis unreachable, active-now reports unavailable rather than zero");
    }

    // Whatever Redis is doing, the limiter must still limit.
    const key = `verify-ingestion:${Date.now()}`;
    let blockedAt = 0;
    for (let i = 1; i <= RATE_LIMITS.analyticsVisitor.limit + 1; i++) {
      const result = await rateLimit(key, RATE_LIMITS.analyticsVisitor);
      if (!result.ok && blockedAt === 0) blockedAt = i;
    }
    assert.equal(blockedAt, RATE_LIMITS.analyticsVisitor.limit + 1);
    ok("P2-28", `rate limiting still blocks at ${blockedAt} whether or not Redis is reachable`);

    // ---------------------------------------------------------------- cascade
    const aId = a.tenant.id;
    await prisma.tenant.delete({ where: { id: aId } });
    const leftovers =
      (await prisma.analyticsEvent.count({ where: { tenantId: aId } })) +
      (await prisma.analyticsSession.count({ where: { tenantId: aId } })) +
      (await prisma.analyticsVisitor.count({ where: { tenantId: aId } }));
    assert.equal(leftovers, 0, "deleting a store must take its analytics with it");
    ok("P2-25", "deleting a store cascades its visitors, sessions and events");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [a.tenant.id, b.tenant.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  }
}

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
