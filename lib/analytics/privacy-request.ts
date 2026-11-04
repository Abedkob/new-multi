/**
 * Answering "what do you have about me" and "delete it" (§4.7, D28, D36).
 *
 * The identifier is the visitor's own analytics id, which their browser already holds in a
 * signed cookie and which their Cookie settings show them. The consent receipt's `publicRef`
 * is a different thing and cannot do this job: it identifies a DECISION, has no link to a
 * visitor row, and a request quoting it could not resolve the data it was about.
 *
 * What erasure does, and what it deliberately does not:
 *
 *  - **Deletes** the visitor, their sessions and their raw events. That is the browsing history,
 *    and it is the whole of what a shopper is asking about.
 *  - **Detaches, but keeps, their orders.** An order is a commercial record under its own
 *    retention rules, and §4.7 says to preserve it. `forgetOrderAttributionLinks` clears the
 *    session key — the one identifying link — and leaves source, medium, campaign, country,
 *    device class and `isReturningVisitor`, none of which identifies anybody. The merchant's
 *    own history of their sales does not change under them (P3-25).
 *  - **Leaves aggregates alone.** A daily total of 37 sessions is not personal data, §4.7 says
 *    to preserve genuinely anonymous totals, and recomputing the day after an erasure would
 *    silently rewrite a merchant's past.
 *
 * Order of operations matters: the orders are detached FIRST, while the session ids still exist
 * to find them by. Delete the sessions first and the link is gone along with the only way to
 * find what to unlink.
 */

import { withBypass, withTenant } from "@/lib/prisma";
import { recordAnalyticsAudit } from "@/lib/analytics/audit";

export type PrivacyRequestSummary = {
  visitorId: string;
  found: boolean;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  country: string | null;
  deviceClass: string | null;
  sessions: number;
  events: number;
  /** Orders whose attribution currently points at one of this visitor's sessions. */
  linkedOrders: number;
};

/** What an erasure would touch, for the admin to read before doing it. */
export async function summarizePrivacyRequest(
  tenantId: string,
  visitorId: string,
): Promise<PrivacyRequestSummary> {
  return withTenant(tenantId, async (db) => {
    const visitor = await db.analyticsVisitor.findFirst({
      where: { id: visitorId, tenantId },
      select: { id: true, firstSeenAt: true, lastSeenAt: true, country: true, deviceClass: true },
    });
    const sessions = await db.analyticsSession.findMany({
      where: { tenantId, visitorId },
      select: { id: true },
    });
    const events = await db.analyticsEvent.count({ where: { tenantId, visitorId } });
    const linkedOrders = sessions.length
      ? await db.order.count({
          where: { tenantId, analyticsSessionId: { in: sessions.map((s) => s.id) } },
        })
      : 0;

    return {
      visitorId,
      found: !!visitor,
      firstSeenAt: visitor?.firstSeenAt ?? null,
      lastSeenAt: visitor?.lastSeenAt ?? null,
      country: visitor?.country ?? null,
      deviceClass: visitor?.deviceClass ?? null,
      sessions: sessions.length,
      events,
      linkedOrders,
    };
  });
}

export type PrivacyExport = {
  exportedAt: string;
  visitorId: string;
  visitor: {
    firstSeenAt: Date;
    lastSeenAt: Date;
    country: string | null;
    deviceClass: string | null;
    firstSource: string | null;
    firstMedium: string | null;
    firstCampaign: string | null;
  } | null;
  sessions: {
    id: string;
    startedAt: Date;
    lastActivityAt: Date;
    landingPageKind: string | null;
    sourceKind: string | null;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    referrerHost: string | null;
  }[];
  events: {
    type: string;
    occurredAt: Date;
    pageKind: string;
    productId: string | null;
    searchQuery: string | null;
    quantity: number | null;
  }[];
  /** Named, not included: these are the merchant's commercial records, which erasure keeps. */
  retainedOrderIds: string[];
};

/**
 * Everything this store holds about one visitor.
 *
 * Orders are listed by id rather than exported in full: they are the merchant's commercial
 * record and contain the delivery details the shopper gave them directly, which the merchant
 * answers for. What matters here is that the shopper can see an erasure will not remove them.
 */
export async function exportPrivacyRequest(
  tenantId: string,
  visitorId: string,
): Promise<PrivacyExport> {
  return withTenant(tenantId, async (db) => {
    const visitor = await db.analyticsVisitor.findFirst({
      where: { id: visitorId, tenantId },
      select: {
        firstSeenAt: true,
        lastSeenAt: true,
        country: true,
        deviceClass: true,
        firstSource: true,
        firstMedium: true,
        firstCampaign: true,
      },
    });
    const sessions = await db.analyticsSession.findMany({
      where: { tenantId, visitorId },
      select: {
        id: true,
        startedAt: true,
        lastActivityAt: true,
        landingPageKind: true,
        sourceKind: true,
        source: true,
        medium: true,
        campaign: true,
        referrerHost: true,
      },
      orderBy: { startedAt: "asc" },
    });
    const events = await db.analyticsEvent.findMany({
      where: { tenantId, visitorId },
      select: {
        type: true,
        occurredAt: true,
        pageKind: true,
        productId: true,
        searchQuery: true,
        quantity: true,
      },
      orderBy: { occurredAt: "asc" },
    });
    const orders = sessions.length
      ? await db.order.findMany({
          where: { tenantId, analyticsSessionId: { in: sessions.map((s) => s.id) } },
          select: { id: true },
        })
      : [];

    return {
      exportedAt: new Date().toISOString(),
      visitorId,
      visitor,
      sessions,
      events,
      retainedOrderIds: orders.map((o) => o.id),
    };
  });
}

export type PrivacyErasure = {
  visitorId: string;
  ordersDetached: number;
  eventsDeleted: number;
  sessionsDeleted: number;
  visitorDeleted: boolean;
};

/** Erases one visitor's browsing history and detaches their orders, keeping both. */
export async function erasePrivacyRequest(
  tenantId: string,
  visitorId: string,
): Promise<PrivacyErasure> {
  return withTenant(tenantId, async (db) => {
    const sessions = await db.analyticsSession.findMany({
      where: { tenantId, visitorId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);

    // First, while the session ids still exist to find them by.
    const detached = sessionIds.length
      ? await db.order.updateMany({
          where: { tenantId, analyticsSessionId: { in: sessionIds } },
          data: { analyticsSessionId: null },
        })
      : { count: 0 };

    const events = await db.analyticsEvent.deleteMany({ where: { tenantId, visitorId } });
    const removedSessions = await db.analyticsSession.deleteMany({
      where: { tenantId, visitorId },
    });
    const removedVisitor = await db.analyticsVisitor.deleteMany({
      where: { id: visitorId, tenantId },
    });

    return {
      visitorId,
      ordersDetached: detached.count,
      eventsDeleted: events.count,
      sessionsDeleted: removedSessions.count,
      visitorDeleted: removedVisitor.count > 0,
    };
  });
}

/**
 * Writes what was done, every time (D36).
 *
 * Outside RLS and outside the tenant's own data, because this is evidence about the store
 * rather than evidence belonging to it — so it goes through the narrow bypass, like every other
 * platform-level write.
 */
/**
 * A privacy-request entry. Delegates to lib/analytics/audit.ts, the single writer for this
 * table — one place that decides how a row is shaped, so two features cannot record the same
 * kind of fact in two different ways.
 */
export async function recordPrivacyAudit(input: {
  tenantId: string | null;
  actorUserId: string | null;
  actorEmail: string;
  action: "PRIVACY_SUMMARY" | "PRIVACY_EXPORT" | "PRIVACY_ERASE";
  subject: string | null;
  detail: string | null;
}): Promise<void> {
  await recordAnalyticsAudit(input);
}

/** The audit trail for one store, newest first — read by the platform console. */
export function listPrivacyAudit(tenantId: string, take = 20) {
  return withBypass((db) =>
    db.analyticsAuditLog.findMany({
      where: { tenantId, action: { startsWith: "PRIVACY_" } },
      orderBy: { at: "desc" },
      take,
    }),
  );
}

