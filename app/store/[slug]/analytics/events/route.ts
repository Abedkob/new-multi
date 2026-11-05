import { after, NextResponse, type NextRequest } from "next/server";
import { MAX_BODY_BYTES, analyticsEnvelopeSchema } from "@/lib/analytics/contract";
import {
  recordAccepted,
  recordAttempt,
  recordDrop,
  recordInvalidEnvelope,
} from "@/lib/analytics/health";
import { flushAnalyticsHealth } from "@/lib/analytics/health-flush";
import { ingestBatch } from "@/lib/analytics/ingest";
import {
  decodeIdentity,
  encodeIdentity,
  identityCookieAttributes,
  sessionCookieMaxAgeSeconds,
  sessionCookieName,
  visitorCookieName,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/analytics/identity";
import { markActive } from "@/lib/analytics/presence";
import { deviceClassFrom } from "@/lib/analytics/request";
import { countryFromTrusted } from "@/lib/edge";
import { rolloutIncludes } from "@/lib/analytics/rollout";
import { verifyBootstrapToken } from "@/lib/analytics/token";
import { consentCookieName, decodeConsent } from "@/lib/consent/cookie";
import { consentCookiePath } from "@/lib/consent/read";
import { loadTenant } from "@/lib/data/storefront";
import { canServeTenant } from "@/lib/license/status";
import { withAnalyticsSlot } from "@/lib/prisma-analytics";
import { RATE_LIMITS, clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * First-party analytics ingestion (§7.5).
 *
 * Answers 202 for everything except input that is structurally wrong. That asymmetry is
 * deliberate: a malformed envelope is a bug worth telling the developer about (400), while an
 * envelope we decline to store — no consent, rate limited, pool busy, database unavailable — is
 * none of a shopper's business and must never become a visible failure on a storefront.
 *
 * Every refusal is counted (lib/analytics/health.ts) and separated into policy and operational,
 * because a batch dropped for honouring consent is the system working and a batch dropped for
 * a full pool is the system struggling. Only the second kind should ever page anyone.
 */

const accepted = () =>
  new NextResponse(null, { status: 202, headers: { "Cache-Control": "no-store" } });
const badRequest = () =>
  NextResponse.json(
    { error: "Invalid analytics envelope." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  recordAttempt();

  // D34: the process that owns the counters is the only one that can write them, so it does —
  // after the response, never awaited, and only when the window is due. A shopper's beacon is
  // answered before any of this runs, and a failure here is swallowed: a health row that could
  // break ingestion would be worse than no health row.
  after(() => {
    void flushAnalyticsHealth();
  });

  // ---- step 4a: an abuse backstop, before any parsing ---------------------------------------
  // Loose on purpose: carrier-grade NAT puts hundreds of real shoppers behind one address, and
  // the meaningful limit is the per-visitor one further down. See RATE_LIMITS.
  const ip = clientIp(req.headers);
  if (!(await rateLimit(`analytics:ip:${ip}`, RATE_LIMITS.analyticsIp)).ok) {
    recordDrop("rate-limit-ip");
    return accepted();
  }

  // ---- step 5a: refuse an oversized body before parsing it -----------------------------------
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    recordInvalidEnvelope();
    return badRequest();
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    recordInvalidEnvelope();
    return badRequest();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    recordInvalidEnvelope();
    return badRequest();
  }
  const envelope = analyticsEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    recordInvalidEnvelope();
    // A 400 is the one answer here that means "our own code sent something wrong", and until
    // now it said so to nobody: the counter rose and the response body was generic. The field
    // that failed is logged (never its value, which came from a browser) because this is the
    // only refusal a developer is supposed to act on.
    console.warn(
      "[analytics] invalid envelope:",
      envelope.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
        .join("; "),
    );
    return badRequest();
  }

  // ---- step 1: resolve the tenant from the route ---------------------------------------------
  const tenant = await loadTenant(slug);
  if (!tenant || !canServeTenant(tenant)) {
    recordDrop("unknown-tenant");
    return accepted();
  }

  // ---- step 2: the tenant-bound bootstrap token ----------------------------------------------
  if (!verifyBootstrapToken(envelope.data.token, tenant.id).ok) {
    recordDrop("bad-token");
    return accepted();
  }

  // Collection is gated by the rollout; consent and the notice are not (Phase 1's D1).
  if (!rolloutIncludes(tenant)) {
    recordDrop("out-of-rollout");
    return accepted();
  }

  // ---- step 3: analytics consent ---------------------------------------------------------------
  // The decisive check. Without a valid, current grant nothing is written and no identifier is
  // minted, so a refusing visitor leaves no trace of having been here.
  const consent = decodeConsent(req.cookies.get(consentCookieName(tenant.id))?.value);
  if (!consent || consent.v !== tenant.consentNoticeVersion || !consent.grants.analytics) {
    recordDrop("no-consent");
    return accepted();
  }

  const facts = {
    country: countryFromTrusted(req.headers),
    deviceClass: deviceClassFrom(req.headers),
    visitorId: decodeIdentity("visitor", req.cookies.get(visitorCookieName(tenant.id))?.value),
    sessionId: decodeIdentity("session", req.cookies.get(sessionCookieName(tenant.id))?.value),
  };

  // ---- step 4b: the limit that actually shapes traffic ----------------------------------------
  // Keyed on the signed visitor cookie, which we minted — fairer than an address shared by a
  // whole carrier, and harder to rotate than one.
  if (facts.visitorId) {
    const perVisitor = await rateLimit(
      `analytics:visitor:${tenant.id}:${facts.visitorId}`,
      RATE_LIMITS.analyticsVisitor,
    );
    if (!perVisitor.ok) {
      recordDrop("rate-limit-visitor");
      return accepted();
    }
  } else {
    // No cookie yet, so this batch may mint a visitor row. Bound identity creation per address
    // rather than leaving it open, but keep it well above what a carrier NAT really produces.
    const minting = await rateLimit(
      `analytics:new-visitor:${tenant.id}:${ip}`,
      RATE_LIMITS.analyticsNewVisitorIp,
    );
    if (!minting.ok) {
      recordDrop("rate-limit-new-visitor");
      return accepted();
    }
  }

  if (!(await rateLimit(`analytics:tenant:${tenant.id}`, RATE_LIMITS.analyticsTenant)).ok) {
    recordDrop("rate-limit-tenant");
    return accepted();
  }

  // ---- steps 7 to 11, under the concurrency ceiling -------------------------------------------
  let outcome;
  try {
    outcome = await withAnalyticsSlot(() => ingestBatch(tenant, envelope.data, facts));
  } catch (error) {
    // Step 13: a database timeout or failure drops the batch. There is no server-side retry,
    // and the shopper never learns this happened.
    recordDrop("database");
    console.error(
      "[analytics] batch dropped:",
      error instanceof Error ? error.message : "unknown error",
    );
    return accepted();
  }
  if (!outcome) {
    recordDrop("concurrency");
    return accepted();
  }
  recordAccepted(outcome.inserted, outcome.rejectedOwnership);

  // ---- step 12: presence, best effort ---------------------------------------------------------
  // Not awaited for correctness, only to keep the handler tidy: a Redis failure here is already
  // bounded (lib/redis.ts) and must never delay the response.
  void markActive(tenant.id, outcome.sessionId).catch(() => {});

  // ---- step 13: answer, carrying the identity forward -----------------------------------------
  const response = accepted();
  const isHttps = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() === "https";
  const storePath = consentCookiePath(tenant);
  response.cookies.set(
    visitorCookieName(tenant.id),
    encodeIdentity("visitor", outcome.visitorId),
    identityCookieAttributes({ isHttps, storePath, maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS }),
  );
  // Re-set on every batch, which is what makes the 30-minute window rolling rather than fixed.
  response.cookies.set(
    sessionCookieName(tenant.id),
    encodeIdentity("session", outcome.sessionId),
    identityCookieAttributes({ isHttps, storePath, maxAge: sessionCookieMaxAgeSeconds() }),
  );
  return response;
}
