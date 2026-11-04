/**
 * Turning raw events and real orders into the rows reports read (§10, D25, D33).
 *
 * One rule shapes everything here: **a day is recomputed, never incremented.** Each pass
 * deletes a local day's rows for one store and writes them again from the raw data. That makes
 * late events, retried beacons, cancelled orders and a changed timezone all self-correcting,
 * and it makes the job safe to run twice — which matters, because a scheduled job eventually
 * does run twice.
 *
 * Two deliberate asymmetries:
 *
 *  - **Events are counted in SQL; money is totalled in TypeScript.** Session counts are
 *    `count(distinct ...)` over a day's events, which SQL does far better than a loop. Order
 *    value goes the other way: the orders for one store on one day are a handful of rows, and
 *    totalling them with `lib/orders.ts`'s own `orderTotal` means analytics cannot drift from
 *    what the order page shows. Re-implementing that sum in SQL would be the drift (P3-01).
 *
 *  - **The funnel is counted in SESSIONS, not events** (§3.2). Three product views in one visit
 *    is one session that looked at a product. A merchant reading "200 product views, 4 orders"
 *    and concluding their product page converts at 2% would be wrong by however many times
 *    people refreshed.
 *
 * Every read and write goes through `withJobTenant`, so RLS is what stops one store's numbers
 * ever being written into another's row — not the correctness of the WHERE clauses here.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  localDayOf,
  localDayRange,
  localDayToDate,
  localHourOf,
  type LocalDay,
} from "@/lib/analytics/local-day";
import { REDACTED } from "@/lib/analytics/search-text";
import { orderTotal } from "@/lib/orders";
import { withJobTenant, type JobTx } from "@/lib/prisma-job";

export type AggregateTenant = { id: string; analyticsTimezone: string };

/** What one day's recompute changed, for the run record and the checks. */
export type DayResult = {
  day: LocalDay;
  sessions: number;
  orders: number;
  orderValueCents: number;
  productRows: number;
  searchRows: number;
  acquisitionRows: number;
};

const asDate = localDayToDate;

/**
 * Recompute every aggregate for one store and one local day.
 *
 * Runs in a single transaction, so a report never sees a half-written day: either the old rows
 * or the new ones, never a mixture — which is what a reader would otherwise hit for the few
 * hundred milliseconds between the delete and the insert.
 */
export async function recomputeDay(tenant: AggregateTenant, day: LocalDay): Promise<DayResult> {
  const zone = tenant.analyticsTimezone;
  const { start, end } = localDayRange(day, zone);

  return withJobTenant(tenant.id, async (tx) => {
    const localDay = asDate(day);

    // ---- the funnel, in unique sessions -----------------------------------------------------
    const [funnel] = await tx.$queryRaw<
      {
        sessions: bigint;
        visitors: bigint;
        product_sessions: bigint;
        cart_add_sessions: bigint;
        cart_view_sessions: bigint;
        checkout_sessions: bigint;
        search_sessions: bigint;
        whatsapp_sessions: bigint;
        whatsapp_value: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT
        count(DISTINCT "sessionId")                                               AS sessions,
        count(DISTINCT "visitorId")                                               AS visitors,
        count(DISTINCT CASE WHEN "type" = 'PRODUCT_VIEW'        THEN "sessionId" END) AS product_sessions,
        count(DISTINCT CASE WHEN "type" = 'ADD_TO_CART'         THEN "sessionId" END) AS cart_add_sessions,
        count(DISTINCT CASE WHEN "type" = 'CART_VIEW'           THEN "sessionId" END) AS cart_view_sessions,
        count(DISTINCT CASE WHEN "type" = 'CHECKOUT_STARTED'    THEN "sessionId" END) AS checkout_sessions,
        count(DISTINCT CASE WHEN "type" = 'SEARCH_SUBMITTED'    THEN "sessionId" END) AS search_sessions,
        count(DISTINCT CASE WHEN "type" = 'WHATSAPP_ORDER_CLICK' THEN "sessionId" END) AS whatsapp_sessions,
        sum(CASE WHEN "type" = 'WHATSAPP_ORDER_CLICK' THEN "valueCents" ELSE 0 END)   AS whatsapp_value
      FROM "AnalyticsEvent"
      WHERE "tenantId" = ${tenant.id} AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
    `);

    // A visitor is "new" on the day their first session for this store started — not the day we
    // first saw an event, which would move every time retention deleted older events.
    const [{ new_visitors: newVisitors }] = await tx.$queryRaw<{ new_visitors: bigint }[]>(
      Prisma.sql`
        SELECT count(*) AS new_visitors
        FROM "AnalyticsVisitor"
        WHERE "tenantId" = ${tenant.id} AND "firstSeenAt" >= ${start} AND "firstSeenAt" < ${end}
      `,
    );

    // ---- orders: fetched, then totalled with the app's own helper ---------------------------
    const orders = await tx.order.findMany({
      where: { tenantId: tenant.id, createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        deliveryFeeCentsSnapshot: true,
        couponDiscountCentsSnapshot: true,
        analyticsSessionId: true,
        attributionSource: true,
        attributionMedium: true,
        attributionCampaign: true,
        firstTouchSource: true,
        firstTouchMedium: true,
        firstTouchCampaign: true,
        items: {
          select: {
            quantity: true,
            priceCentsSnapshot: true,
            variantId: true,
            variant: { select: { productId: true } },
          },
        },
      },
    });

    const valueOf = (order: (typeof orders)[number]) =>
      orderTotal(order.items, order.deliveryFeeCentsSnapshot, order.couponDiscountCentsSnapshot);

    // A cancelled order stays a conversion — somebody chose to buy — and leaves the value
    // totals, which is the rule Phase 3 proved for attribution (P3-05) and this is where it
    // becomes a number a merchant reads.
    const live = orders.filter((o) => o.status !== "CANCELLED");
    const cancelled = orders.filter((o) => o.status === "CANCELLED");
    const orderValueCents = live.reduce((sum, o) => sum + valueOf(o), 0);

    // ---- the daily row ----------------------------------------------------------------------
    const daily = {
      timeZone: zone,
      sessions: Number(funnel.sessions),
      visitors: Number(funnel.visitors),
      newVisitors: Number(newVisitors),
      productViewSessions: Number(funnel.product_sessions),
      addToCartSessions: Number(funnel.cart_add_sessions),
      cartViewSessions: Number(funnel.cart_view_sessions),
      checkoutSessions: Number(funnel.checkout_sessions),
      searchSessions: Number(funnel.search_sessions),
      whatsappClickSessions: Number(funnel.whatsapp_sessions),
      whatsappPotentialValueCents: Number(funnel.whatsapp_value ?? 0),
      orders: live.length,
      orderValueCents,
      cancelledOrders: cancelled.length,
      cancelledOrderValueCents: cancelled.reduce((sum, o) => sum + valueOf(o), 0),
      computedAt: new Date(),
    };
    await tx.analyticsDailyMetric.upsert({
      where: { tenantId_localDay: { tenantId: tenant.id, localDay } },
      create: { tenantId: tenant.id, localDay, ...daily },
      update: daily,
    });

    // ---- hours ------------------------------------------------------------------------------
    // The hour is resolved in TypeScript rather than in SQL, because `AT TIME ZONE` would hand
    // Postgres's tz database the decision about where a day begins while every other part of
    // this phase asks the runtime's ICU data. One source of truth for time, even at the cost of
    // a loop (D26, lib/analytics/local-day.ts).
    const sessionStarts = await tx.analyticsSession.findMany({
      where: { tenantId: tenant.id, startedAt: { gte: start, lt: end } },
      select: { id: true, startedAt: true },
    });
    const hourly = new Map<number, { sessions: number; orders: number; orderValueCents: number }>();
    const bucket = (hour: number) => {
      const existing = hourly.get(hour);
      if (existing) return existing;
      const fresh = { sessions: 0, orders: 0, orderValueCents: 0 };
      hourly.set(hour, fresh);
      return fresh;
    };
    for (const session of sessionStarts) bucket(localHourOf(session.startedAt, zone)).sessions += 1;
    for (const order of live) {
      const slot = bucket(localHourOf(order.createdAt, zone));
      slot.orders += 1;
      slot.orderValueCents += valueOf(order);
    }
    await tx.analyticsHourlyMetric.deleteMany({ where: { tenantId: tenant.id, localDay } });
    if (hourly.size > 0) {
      await tx.analyticsHourlyMetric.createMany({
        data: [...hourly].map(([hour, row]) => ({
          tenantId: tenant.id,
          localDay,
          timeZone: zone,
          hour,
          ...row,
        })),
      });
    }

    // ---- products ---------------------------------------------------------------------------
    const productEvents = await tx.$queryRaw<
      {
        productId: string;
        view_sessions: bigint;
        views: bigint;
        cart_sessions: bigint;
        whatsapp_sessions: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        "productId",
        count(DISTINCT CASE WHEN "type" = 'PRODUCT_VIEW' THEN "sessionId" END) AS view_sessions,
        count(CASE WHEN "type" = 'PRODUCT_VIEW' THEN 1 END)                    AS views,
        count(DISTINCT CASE WHEN "type" = 'ADD_TO_CART' THEN "sessionId" END)  AS cart_sessions,
        count(DISTINCT CASE WHEN "type" = 'WHATSAPP_ORDER_CLICK' THEN "sessionId" END) AS whatsapp_sessions
      FROM "AnalyticsEvent"
      WHERE "tenantId" = ${tenant.id}
        AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
        AND "productId" IS NOT NULL
      GROUP BY "productId"
    `);

    type ProductRow = {
      viewSessions: number;
      views: number;
      addToCartSessions: number;
      whatsappClickSessions: number;
      purchasingSessions: number;
      unitsOrdered: number;
      orderValueCents: number;
    };
    const products = new Map<string, ProductRow>();
    const productBucket = (id: string) => {
      const existing = products.get(id);
      if (existing) return existing;
      const fresh: ProductRow = {
        viewSessions: 0,
        views: 0,
        addToCartSessions: 0,
        whatsappClickSessions: 0,
        purchasingSessions: 0,
        unitsOrdered: 0,
        orderValueCents: 0,
      };
      products.set(id, fresh);
      return fresh;
    };
    for (const row of productEvents) {
      const slot = productBucket(row.productId);
      slot.viewSessions = Number(row.view_sessions);
      slot.views = Number(row.views);
      slot.addToCartSessions = Number(row.cart_sessions);
      slot.whatsappClickSessions = Number(row.whatsapp_sessions);
    }
    // An order item snapshots a product NAME, not a product id, so what it sold is reached
    // through its variant. An item whose variant has since been deleted outright can no longer
    // name its product: it is left out rather than guessed at, which is why a product's units
    // can be lower than the orders a merchant remembers if they deleted variants.
    const purchasingSessions = new Map<string, Set<string>>();
    for (const order of live) {
      for (const item of order.items) {
        const productId = item.variant?.productId;
        if (!productId) continue;
        const slot = productBucket(productId);
        slot.unitsOrdered += item.quantity;
        slot.orderValueCents += item.priceCentsSnapshot * item.quantity;
        const key = order.analyticsSessionId;
        if (key) {
          const seen = purchasingSessions.get(productId) ?? new Set<string>();
          seen.add(key);
          purchasingSessions.set(productId, seen);
        }
      }
    }
    for (const [productId, sessions] of purchasingSessions) {
      productBucket(productId).purchasingSessions = sessions.size;
    }
    await tx.analyticsProductDaily.deleteMany({ where: { tenantId: tenant.id, localDay } });
    if (products.size > 0) {
      await tx.analyticsProductDaily.createMany({
        data: [...products].map(([productId, row]) => ({
          tenantId: tenant.id,
          localDay,
          timeZone: zone,
          productId,
          ...row,
        })),
      });
    }

    // ---- searches ---------------------------------------------------------------------------
    const searchRows = await tx.$queryRaw<
      {
        phrase: string;
        searches: bigint;
        sessions: bigint;
        no_results: bigint;
        click_sessions: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        "searchQuery" AS phrase,
        count(CASE WHEN "type" = 'SEARCH_SUBMITTED' THEN 1 END)                   AS searches,
        count(DISTINCT CASE WHEN "type" = 'SEARCH_SUBMITTED' THEN "sessionId" END) AS sessions,
        count(CASE WHEN "type" = 'SEARCH_SUBMITTED' AND "resultCount" = 0 THEN 1 END) AS no_results,
        count(DISTINCT CASE WHEN "type" = 'SEARCH_RESULT_CLICK' THEN "sessionId" END) AS click_sessions
      FROM "AnalyticsEvent"
      WHERE "tenantId" = ${tenant.id}
        AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
        AND "searchQuery" IS NOT NULL
      GROUP BY "searchQuery"
    `);
    await tx.analyticsSearchDaily.deleteMany({ where: { tenantId: tenant.id, localDay } });
    if (searchRows.length > 0) {
      await tx.analyticsSearchDaily.createMany({
        data: searchRows.map((row) => ({
          tenantId: tenant.id,
          localDay,
          timeZone: zone,
          phrase: row.phrase,
          searches: Number(row.searches),
          searchSessions: Number(row.sessions),
          noResultSearches: Number(row.no_results),
          resultClickSessions: Number(row.click_sessions),
          // The one flag a stocking suggestion must honour (P4-12).
          redacted: row.phrase === REDACTED,
        })),
      });
    }

    // ---- acquisition ------------------------------------------------------------------------
    const channels = await tx.$queryRaw<
      {
        sourceKind: string | null;
        source: string | null;
        medium: string | null;
        campaign: string | null;
        sessions: bigint;
      }[]
    >(Prisma.sql`
      SELECT "sourceKind", "source", "medium", "campaign", count(*) AS sessions
      FROM "AnalyticsSession"
      WHERE "tenantId" = ${tenant.id} AND "startedAt" >= ${start} AND "startedAt" < ${end}
      GROUP BY "sourceKind", "source", "medium", "campaign"
    `);

    type ChannelRow = {
      sessions: number;
      lastTouchOrders: number;
      lastTouchOrderValueCents: number;
      firstTouchOrders: number;
      firstTouchOrderValueCents: number;
      whatsappClickSessions: number;
    };
    const key = (kind: string, source: string, medium: string, campaign: string) =>
      [kind, source, medium, campaign].join("\u0000");
    const acquisition = new Map<string, ChannelRow & { parts: [string, string, string, string] }>();
    const channelBucket = (kind: string, source: string, medium: string, campaign: string) => {
      const k = key(kind, source, medium, campaign);
      const existing = acquisition.get(k);
      if (existing) return existing;
      const fresh = {
        parts: [kind, source, medium, campaign] as [string, string, string, string],
        sessions: 0,
        lastTouchOrders: 0,
        lastTouchOrderValueCents: 0,
        firstTouchOrders: 0,
        firstTouchOrderValueCents: 0,
        whatsappClickSessions: 0,
      };
      acquisition.set(k, fresh);
      return fresh;
    };
    for (const row of channels) {
      channelBucket(
        row.sourceKind ?? "direct",
        row.source ?? "",
        row.medium ?? "",
        row.campaign ?? "",
      ).sessions += Number(row.sessions);
    }
    // Orders carry their own snapshot of both touches (Phase 3), so this needs no join back to
    // the sessions — which is the whole point of snapshotting them: an order's channel cannot
    // change when a session is edited or deleted.
    for (const order of live) {
      const value = valueOf(order);
      const last = channelBucket(
        order.attributionSource ? "campaign" : "direct",
        order.attributionSource ?? "",
        order.attributionMedium ?? "",
        order.attributionCampaign ?? "",
      );
      last.lastTouchOrders += 1;
      last.lastTouchOrderValueCents += value;
      const first = channelBucket(
        order.firstTouchSource ? "campaign" : "direct",
        order.firstTouchSource ?? "",
        order.firstTouchMedium ?? "",
        order.firstTouchCampaign ?? "",
      );
      first.firstTouchOrders += 1;
      first.firstTouchOrderValueCents += value;
    }
    await tx.analyticsAcquisitionDaily.deleteMany({ where: { tenantId: tenant.id, localDay } });
    if (acquisition.size > 0) {
      await tx.analyticsAcquisitionDaily.createMany({
        data: [...acquisition.values()].map(({ parts, ...row }) => ({
          tenantId: tenant.id,
          localDay,
          timeZone: zone,
          sourceKind: parts[0],
          source: parts[1],
          medium: parts[2],
          campaign: parts[3],
          ...row,
        })),
      });
    }

    return {
      day,
      sessions: daily.sessions,
      orders: daily.orders,
      orderValueCents: daily.orderValueCents,
      productRows: products.size,
      searchRows: searchRows.length,
      acquisitionRows: acquisition.size,
    };
  });
}

/** Recompute a list of local days for one store, oldest first. */
export async function recomputeDays(
  tenant: AggregateTenant,
  days: readonly LocalDay[],
): Promise<DayResult[]> {
  const results: DayResult[] = [];
  for (const day of [...days].sort()) results.push(await recomputeDay(tenant, day));
  return results;
}

/**
 * The local days an order touched, from the orders whose status changed recently (D33).
 *
 * Cash on delivery means a cancellation routinely lands days after the order was placed, and
 * the ordinary window only recomputes today and yesterday. Without this, a cancellation on
 * Friday leaves Monday's chart permanently wrong, with nothing to explain it. So the sweep asks
 * the orders themselves: an order whose `updatedAt` is in this window drags its OWN day — the
 * day it was created, in the store's zone — back into the queue.
 */
export async function daysTouchedByOrderChanges(
  tenant: AggregateTenant,
  since: Date,
  tx: JobTx,
): Promise<LocalDay[]> {
  const changed = await tx.order.findMany({
    where: { tenantId: tenant.id, updatedAt: { gte: since } },
    select: { createdAt: true },
  });
  const days = new Set<LocalDay>();
  for (const order of changed) days.add(localDayOf(order.createdAt, tenant.analyticsTimezone));
  return [...days].sort();
}
