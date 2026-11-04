/**
 * The ingestion path: §7.5's thirteen steps, in order, as one function.
 *
 * It lives here rather than in the route handler so the whole path can be exercised without
 * HTTP — the route is a thin shell that turns a Request into these inputs and the result into
 * a response.
 *
 * Two invariants hold throughout:
 *
 *  1. Nothing is written unless the visitor granted analytics. Consent is checked before any
 *     identifier is minted, so a refusing visitor leaves no trace at all — not even a row
 *     saying they refused (that is the consent receipt's job, and it is not a visitor record).
 *  2. Nothing here may surface to the shopper. Every failure mode ends in "drop it and answer
 *     202". A batch lost to a database hiccup costs a page view; an error shown on a storefront
 *     costs trust.
 *
 * Server-only.
 */

import {
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_AGE_MS,
  type AnalyticsEnvelope,
  type AnalyticsEventInput,
  type AnalyticsEventType,
} from "@/lib/analytics/contract";
import { resolveAttribution, type DeviceClass } from "@/lib/analytics/request";
import { sessionExpired } from "@/lib/analytics/identity";
import { normalizeSearchText } from "@/lib/analytics/search-text";
import { resolveWhatsappValues } from "@/lib/analytics/whatsapp-value";
import { withAnalyticsTenant } from "@/lib/prisma-analytics";

export type IngestTenant = { id: string; slug: string };

/** Only a search event may carry a phrase (§3.6). */
const isSearch = (type: AnalyticsEventType) =>
  type === "SEARCH_SUBMITTED" || type === "SEARCH_RESULT_CLICK";

export type IngestFacts = {
  country: string | null;
  deviceClass: DeviceClass | null;
  /** Signed ids recovered from cookies, or null when this is a first visit. */
  visitorId: string | null;
  sessionId: string | null;
};

export type IngestOutcome = {
  visitorId: string;
  sessionId: string;
  /** Rows actually written, after deduplication and ownership filtering. */
  inserted: number;
  /** Events dropped because their product or variant does not belong to this store. */
  rejectedOwnership: number;
  /** True when a new session row was started for this batch. */
  startedSession: boolean;
};

/**
 * Clamps a client timestamp into a believable window (§7.5 step 5).
 *
 * A clock that is ahead would otherwise write events into the future, where no report would
 * ever show them; a queue restored from a long-suspended tab would backdate today's activity
 * into last week. Both are clamped rather than rejected — the event happened, only its clock
 * is wrong.
 */
export function clampOccurredAt(occurredAt: number, now = Date.now()): Date {
  const earliest = now - MAX_EVENT_AGE_MS;
  const latest = now + MAX_CLOCK_SKEW_MS;
  const bounded = Math.min(Math.max(occurredAt, earliest), latest);
  // Never store a future timestamp, even inside the tolerated skew.
  return new Date(Math.min(bounded, now));
}

/** Product and variant ids referenced by a batch, for the one ownership query. */
function referencedIds(events: AnalyticsEventInput[]) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const event of events) {
    if (event.productId) productIds.add(event.productId);
    if (event.variantId) variantIds.add(event.variantId);
  }
  return { productIds: [...productIds], variantIds: [...variantIds] };
}

/**
 * Writes one batch. Everything happens inside a single transaction on the ingestion pool, so a
 * batch costs one connection from the small analytics allowance rather than several.
 */
export async function ingestBatch(
  tenant: IngestTenant,
  envelope: AnalyticsEnvelope,
  facts: IngestFacts,
  now = new Date(),
): Promise<IngestOutcome> {
  return withAnalyticsTenant(tenant.id, async (db) => {
    // ---- step 7: product and variant ownership ------------------------------------------
    // RLS already scopes these reads to this tenant, so anything that comes back is ours and
    // anything missing is not. An event naming something that is not ours is dropped rather
    // than failing the batch: a product deleted mid-session is normal, not an attack, and a
    // 400 would make the tracker retry something that can never succeed.
    const { productIds, variantIds } = referencedIds(envelope.events);
    const [ownedProducts, ownedVariants] = await Promise.all([
      productIds.length
        ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })
        : Promise.resolve([]),
      variantIds.length
        ? db.productVariant.findMany({
            where: { id: { in: variantIds }, product: { tenantId: tenant.id } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    const okProducts = new Set(ownedProducts.map((p) => p.id));
    const okVariants = new Set(ownedVariants.map((v) => v.id));

    const accepted: AnalyticsEventInput[] = [];
    let rejectedOwnership = 0;
    for (const event of envelope.events) {
      const productOk = !event.productId || okProducts.has(event.productId);
      const variantOk = !event.variantId || okVariants.has(event.variantId);
      if (productOk && variantOk) accepted.push(event);
      else rejectedOwnership += 1;
    }

    // ---- step 8: resolve the visitor ------------------------------------------------------
    const attribution = resolveAttribution(envelope.events[0]?.attributionContext);

    const existingVisitor = facts.visitorId
      ? await db.analyticsVisitor.findFirst({
          where: { id: facts.visitorId, tenantId: tenant.id },
          select: { id: true },
        })
      : null;

    const visitor =
      existingVisitor ??
      (await db.analyticsVisitor.create({
        data: {
          tenantId: tenant.id,
          firstSeenAt: now,
          lastSeenAt: now,
          country: facts.country,
          deviceClass: facts.deviceClass,
          // First touch is written once, at creation, and never overwritten.
          firstSource: attribution.source,
          firstMedium: attribution.medium,
          firstCampaign: attribution.campaign,
        },
        select: { id: true },
      }));

    if (existingVisitor) {
      await db.analyticsVisitor.update({
        where: { id: visitor.id },
        data: { lastSeenAt: now },
      });
    }

    // ---- step 8 continued: resolve the session --------------------------------------------
    const existingSession = facts.sessionId
      ? await db.analyticsSession.findFirst({
          where: { id: facts.sessionId, tenantId: tenant.id, visitorId: visitor.id },
          select: { id: true, lastActivityAt: true },
        })
      : null;

    const reuse = existingSession && !sessionExpired(existingSession.lastActivityAt, now);
    const session = reuse
      ? existingSession
      : await db.analyticsSession.create({
          data: {
            tenantId: tenant.id,
            visitorId: visitor.id,
            startedAt: now,
            lastActivityAt: now,
            country: facts.country,
            deviceClass: facts.deviceClass,
            landingPageKind: envelope.events[0]?.pageKind ?? null,
            // Last non-direct touch: only overwrite with something real, so navigating from a
            // campaign link to a direct page view does not erase how the visit started.
            source: attribution.source,
            medium: attribution.medium,
            campaign: attribution.campaign,
            content: attribution.content,
            hasAdClick: attribution.hasAdClick,
          },
          select: { id: true, lastActivityAt: true },
        });

    // ---- step 9: the only server-computed money figure --------------------------------------
    // Resolved from canonical pricing, for WhatsApp clicks only, and only after the ownership
    // filter above — so a forged product id is already gone by the time anything is priced.
    const values = await resolveWhatsappValues(db, tenant.id, accepted, now);

    // ---- steps 10 and 11: insert, then mark the session active ----------------------------
    // skipDuplicates against (tenantId, eventId) is what makes a retried beacon free, and is
    // why the browser keeps no durable retry queue.
    const result = await db.analyticsEvent.createMany({
      data: accepted.map((event) => ({
        tenantId: tenant.id,
        eventId: event.eventId,
        type: event.type,
        occurredAt: clampOccurredAt(event.occurredAt, now.getTime()),
        sessionId: session.id,
        visitorId: visitor.id,
        pageKind: event.pageKind,
        productId: event.productId ?? null,
        variantId: event.variantId ?? null,
        quantity: event.quantity ?? null,
        // §3.6: normalized for grouping, redacted if it looks like somebody's personal data,
        // and only ever for a search event — a stray searchQuery on an ADD_TO_CART is dropped
        // rather than stored, because nothing could have put it there honestly.
        searchQuery: isSearch(event.type) ? normalizeSearchText(event.searchQuery).phrase || null : null,
        resultCount: event.resultCount ?? null,
        // Only a WhatsApp click has one, and only ever from the server's own pricing.
        valueCents: values.get(event.eventId) ?? null,
      })),
      skipDuplicates: true,
    });

    if (reuse) {
      await db.analyticsSession.update({
        where: { id: session.id },
        data: { lastActivityAt: now },
      });
    }

    return {
      visitorId: visitor.id,
      sessionId: session.id,
      inserted: result.count,
      rejectedOwnership,
      startedSession: !reuse,
    };
  });
}
