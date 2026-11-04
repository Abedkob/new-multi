import { NextResponse, type NextRequest } from "next/server";
import { ANALYTICS_SCHEMA_VERSION } from "@/lib/analytics/contract";
import { recordDrop } from "@/lib/analytics/health";
import { decodeIdentity, sessionCookieName } from "@/lib/analytics/identity";
import { markActive } from "@/lib/analytics/presence";
import { rolloutIncludes } from "@/lib/analytics/rollout";
import { verifyBootstrapToken } from "@/lib/analytics/token";
import { consentCookieName, decodeConsent } from "@/lib/consent/cookie";
import { loadTenant } from "@/lib/data/storefront";
import { canServeTenant } from "@/lib/license/status";
import { RATE_LIMITS, clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Presence ping (§7.3). Touches a Redis sorted set and nothing else: never a database write,
 * never an event row.
 *
 * It needs an existing session cookie, so a visitor who has not yet sent any events is not
 * counted as present — being on the page is only visible to us through the measurement they
 * already agreed to.
 *
 * Always 202, like ingestion: there is nothing a shopper could do about a failure here.
 */

const accepted = () =>
  new NextResponse(null, { status: 202, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip = clientIp(req.headers);
  if (!(await rateLimit(`analytics:presence:${ip}`, RATE_LIMITS.analyticsIp)).ok) {
    recordDrop("rate-limit-ip");
    return accepted();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return accepted();
  }
  const token =
    typeof body === "object" && body !== null && "token" in body
      ? String((body as { token: unknown }).token)
      : "";
  const version =
    typeof body === "object" && body !== null && "schemaVersion" in body
      ? (body as { schemaVersion: unknown }).schemaVersion
      : null;
  if (version !== ANALYTICS_SCHEMA_VERSION || !token) return accepted();

  const tenant = await loadTenant(slug);
  if (!tenant || !canServeTenant(tenant)) return accepted();
  if (!verifyBootstrapToken(token, tenant.id).ok) {
    recordDrop("bad-token");
    return accepted();
  }
  if (!rolloutIncludes(tenant)) {
    recordDrop("out-of-rollout");
    return accepted();
  }

  const consent = decodeConsent(req.cookies.get(consentCookieName(tenant.id))?.value);
  if (!consent || consent.v !== tenant.consentNoticeVersion || !consent.grants.analytics) {
    recordDrop("no-consent");
    return accepted();
  }

  const sessionId = decodeIdentity(
    "session",
    req.cookies.get(sessionCookieName(tenant.id))?.value,
  );
  // No session yet means no events have been sent yet. Nothing to mark present.
  if (!sessionId) return accepted();

  await markActive(tenant.id, sessionId);
  return accepted();
}
