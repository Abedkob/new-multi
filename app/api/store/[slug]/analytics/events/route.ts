import { NextResponse, type NextRequest } from "next/server";
import {
  MAX_BODY_BYTES,
  analyticsEnvelopeSchema,
} from "@/lib/analytics/contract";
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
import { countryFrom, deviceClassFrom } from "@/lib/analytics/request";
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
 * Nothing here is cached, and nothing it returns describes the store's data.
 */

const ACCEPTED = { status: 202 } as const;
const accepted = () => new NextResponse(null, { ...ACCEPTED, headers: { "Cache-Control": "no-store" } });
const badRequest = () =>
  NextResponse.json({ error: "Invalid analytics envelope." }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // ---- step 4 (first half): bound the public surface before doing any work ----------------
  const ip = clientIp(req.headers);
  const perIp = await rateLimit(`analytics:ip:${ip}`, RATE_LIMITS.analyticsIngest);
  if (!perIp.ok) return accepted();

  // ---- step 5 (first half): refuse an oversized body before parsing it ---------------------
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return badRequest();
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return badRequest();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return badRequest();
  }
  const envelope = analyticsEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) return badRequest();

  // ---- step 1: resolve the tenant from the route -------------------------------------------
  const tenant = await loadTenant(slug);
  if (!tenant || !canServeTenant(tenant)) return accepted();

  // ---- step 2: the tenant-bound bootstrap token --------------------------------------------
  if (!verifyBootstrapToken(envelope.data.token, tenant.id).ok) return accepted();

  // Collection is gated by the rollout; consent and the notice are not (that is Phase 1's D1).
  if (!rolloutIncludes(tenant)) return accepted();

  // ---- step 3: analytics consent ------------------------------------------------------------
  // The decisive check. Without a valid, current grant nothing is written and no identifier is
  // minted, so a refusing visitor leaves no trace of having been here.
  const consent = decodeConsent(req.cookies.get(consentCookieName(tenant.id))?.value);
  if (!consent || consent.v !== tenant.consentNoticeVersion || !consent.grants.analytics) {
    return accepted();
  }

  // ---- step 4 (second half): a per-tenant bound as well ------------------------------------
  const perTenant = await rateLimit(`analytics:tenant:${tenant.id}`, RATE_LIMITS.analyticsTenant);
  if (!perTenant.ok) return accepted();

  const facts = {
    country: countryFrom(req.headers),
    deviceClass: deviceClassFrom(req.headers),
    visitorId: decodeIdentity("visitor", req.cookies.get(visitorCookieName(tenant.id))?.value),
    sessionId: decodeIdentity("session", req.cookies.get(sessionCookieName(tenant.id))?.value),
  };

  // ---- steps 7 to 11, under the concurrency ceiling ----------------------------------------
  let outcome;
  try {
    outcome = await withAnalyticsSlot(() => ingestBatch(tenant, envelope.data, facts));
  } catch (error) {
    // Step 13: a database timeout or failure drops the batch. There is no server-side retry,
    // and the shopper never learns this happened.
    console.error(
      "[analytics] batch dropped:",
      error instanceof Error ? error.message : "unknown error",
    );
    return accepted();
  }
  // null means the process-local ceiling turned it away.
  if (!outcome) return accepted();

  // ---- step 12 is Phase 2's presence commit; step 13: answer -------------------------------
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
