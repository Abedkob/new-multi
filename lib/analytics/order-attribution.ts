/**
 * Where an order came from, resolved for the checkout action (§9.1).
 *
 * This is the one place analytics touches money, so it is written defensively on purpose:
 *
 *  1. It is resolved BEFORE the order transaction opens and handed to `placeOrder` as plain
 *     data. The order never waits on the analytics database and never needs a second write
 *     afterwards — no outbox, no post-commit dependency, nothing that can be lost.
 *  2. It never throws. Every failure (no consent, no session, an unreachable analytics pool, a
 *     statement timeout) returns `undefined`, and the order records nulls and completes
 *     normally. An order must never fail, or slow down, because measurement did.
 *  3. It reads through the ingestion pool, which has its own small allowance, a one-second
 *     connection timeout and a 500ms statement timeout. So "the analytics database is
 *     struggling" costs this function a bounded wait and then nothing at all.
 *
 * Server-only (next/headers).
 */

import { cookies, headers } from "next/headers";
import {
  decodeIdentity,
  sessionCookieName,
  visitorCookieName,
} from "@/lib/analytics/identity";
import { countryFrom, deviceClassFrom } from "@/lib/analytics/request";
import { consentCookieName, decodeConsent } from "@/lib/consent/cookie";
import type { OrderAttributionSnapshot } from "@/lib/data/orders";
import { withAnalyticsTenant } from "@/lib/prisma-analytics";

/** The tenant fields this needs; structural, so a `select`ed row fits. */
export type AttributionTenant = { id: string; consentNoticeVersion: number };

/**
 * The snapshot for an order being placed right now, or `undefined` when there is nothing to
 * record. Never rejects.
 *
 * The decisive gate is the same one the ingestion endpoint applies: a current analytics grant.
 * Without it there is no attribution even if stale identity cookies are still in the jar, which
 * is what makes "withdraw consent" mean something for orders too, not only for collection.
 */
export async function resolveOrderAttribution(
  tenant: AttributionTenant,
): Promise<OrderAttributionSnapshot | undefined> {
  try {
    const jar = await cookies();
    const consent = decodeConsent(jar.get(consentCookieName(tenant.id))?.value);
    if (!consent || consent.v !== tenant.consentNoticeVersion || !consent.grants.analytics) {
      return undefined;
    }

    const sessionId = decodeIdentity("session", jar.get(sessionCookieName(tenant.id))?.value);
    const visitorId = decodeIdentity("visitor", jar.get(visitorCookieName(tenant.id))?.value);
    // A granted visitor who has not sent a single batch yet has no identity to attribute.
    if (!sessionId && !visitorId) return undefined;

    const requestHeaders = await headers();

    // One transaction, two small reads, on the ingestion pool. RLS scopes both to this tenant,
    // so a forged cookie naming another store's session resolves to nothing.
    const rows = await withAnalyticsTenant(tenant.id, async (db) => {
      const [session, visitor] = await Promise.all([
        sessionId
          ? db.analyticsSession.findFirst({
              where: { id: sessionId, tenantId: tenant.id },
              select: {
                id: true,
                visitorId: true,
                source: true,
                medium: true,
                campaign: true,
                country: true,
                deviceClass: true,
              },
            })
          : Promise.resolve(null),
        visitorId
          ? db.analyticsVisitor.findFirst({
              where: { id: visitorId, tenantId: tenant.id },
              select: { id: true, firstSource: true },
            })
          : Promise.resolve(null),
      ]);
      return { session, visitor };
    });

    const { session, visitor } = rows;
    if (!session && !visitor) return undefined;

    return {
      analyticsSessionId: session?.id ?? null,
      // The session's own visitor, when there is one: it was recorded by ingestion rather than
      // read from a cookie, so it cannot disagree with the session.
      analyticsVisitorId: session?.visitorId ?? visitor?.id ?? null,
      attributionSource: session?.source ?? null,
      attributionMedium: session?.medium ?? null,
      attributionCampaign: session?.campaign ?? null,
      firstTouchSource: visitor?.firstSource ?? null,
      // Prefer what analytics already recorded for this visit; fall back to this request's own
      // headers so an order still carries a country when the session row predates them.
      analyticsCountry: session?.country ?? countryFrom(requestHeaders),
      analyticsDeviceClass: session?.deviceClass ?? deviceClassFrom(requestHeaders),
    };
  } catch (error) {
    // The order is about to be placed. Whatever went wrong here, it is not the shopper's
    // problem and it is not worth a lost sale.
    console.error(
      "[analytics] order attribution skipped:",
      error instanceof Error ? error.message : "unknown error",
    );
    return undefined;
  }
}
