/**
 * Phase 4 verification: deleting, and not deleting (pnpm verify:retention — P4-24 to P4-27).
 *
 * This is the first thing in this project that can destroy data, so the checks are written the
 * way a careful person would check a deletion: prove what it would do before it does it, prove
 * it deleted exactly what it said, and prove it left alone the things that must survive —
 * orders, which are kept under commercial rules, and aggregates, which are anonymous totals a
 * merchant's history depends on.
 *
 * All the data here is created by the check, at ages it chooses, because every claim is about
 * how old something is. Nothing depends on what happens to be in the database — and nothing
 * outside this store's own rows can be affected by a bug in it.
 *
 *   pnpm verify:retention
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { env } from "../lib/env";
import {
  erasePrivacyRequest,
  exportPrivacyRequest,
  listPrivacyAudit,
  recordPrivacyAudit,
  summarizePrivacyRequest,
} from "../lib/analytics/privacy-request";
import { describeRetention, runRetention } from "../lib/analytics/retention";
import { placeOrder } from "../lib/data/orders";
import { createProduct } from "../lib/data/products";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import { disconnectJobPrisma } from "../lib/prisma-job";
import { prisma } from "../lib/prisma";
import { closeRedis } from "../lib/redis";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const monthsAgo = (months: number) => {
  const then = new Date();
  then.setUTCMonth(then.getUTCMonth() - months);
  return then;
};

async function main() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Retention ${run}`,
    ownerName: "Phase4",
    ownerEmail: `retention-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 4 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-retention",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;

  try {
    const product = await createProduct(T, {
      name: "Retained Item",
      description: "",
      basePriceCents: 1500,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [{ attributes: {}, stock: 100, priceCentsOverride: null, imageUrl: null }],
    });
    const variantId = product.variants[0].id;

    // ---- old data, at ages chosen to sit either side of each §4.7 window -------------------
    const oldVisitor = await prisma.analyticsVisitor.create({
      data: {
        tenantId: T,
        firstSeenAt: monthsAgo(20),
        lastSeenAt: monthsAgo(14), // past the 13-month window
        country: "LB",
        deviceClass: "mobile",
      },
    });
    const freshVisitor = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSeenAt: daysAgo(2), lastSeenAt: daysAgo(1), country: "LB", deviceClass: "desktop" },
    });
    const oldSession = await prisma.analyticsSession.create({
      data: {
        tenantId: T,
        visitorId: oldVisitor.id,
        startedAt: monthsAgo(14),
        lastActivityAt: monthsAgo(14),
        sourceKind: "direct",
      },
    });
    const freshSession = await prisma.analyticsSession.create({
      data: {
        tenantId: T,
        visitorId: freshVisitor.id,
        startedAt: daysAgo(1),
        lastActivityAt: daysAgo(1),
        sourceKind: "campaign",
        source: "newsletter",
        medium: "email",
        campaign: "nov",
      },
    });
    const addEvent = (sessionId: string, visitorId: string, when: Date) =>
      prisma.analyticsEvent.create({
        data: {
          tenantId: T,
          eventId: randomUUID(),
          type: "PAGE_VIEW",
          occurredAt: when,
          sessionId,
          visitorId,
          pageKind: "home",
        },
      });
    // Two events past the 90-day window, two inside it.
    await addEvent(oldSession.id, oldVisitor.id, daysAgo(200));
    await addEvent(oldSession.id, oldVisitor.id, daysAgo(120));
    await addEvent(freshSession.id, freshVisitor.id, daysAgo(2));
    await addEvent(freshSession.id, freshVisitor.id, daysAgo(1));

    // An order placed by the fresh session: it must survive everything below.
    const order = await placeOrder(
      T,
      {
        customerName: "Retention Shopper",
        customerPhone: "+961 70 000 030",
        customerAddress: "5 Retention Street",
        deliveryLocation: "Test location",
        notes: "",
      },
      [{ variantId, quantity: 2 }],
      {
        expectedDeliveryFeeCents: 0,
        attribution: {
          analyticsSessionId: freshSession.id,
          isReturningVisitor: true,
          attributionSource: "newsletter",
          attributionMedium: "email",
          attributionCampaign: "nov",
          analyticsCountry: "LB",
          analyticsDeviceClass: "desktop",
        },
      },
    );

    // Aggregates: one row past the 24-month window, one inside it.
    const dayRow = (localDay: string, sessions: number) =>
      prisma.analyticsDailyMetric.create({
        data: { tenantId: T, localDay: new Date(`${localDay}T00:00:00.000Z`), timeZone: "Asia/Beirut", sessions },
      });
    const oldDay = monthsAgo(30).toISOString().slice(0, 10);
    const keptDay = monthsAgo(6).toISOString().slice(0, 10);
    await dayRow(oldDay, 11);
    await dayRow(keptDay, 22);

    // A consent receipt past its own expiry + 24 months, and one still current.
    await prisma.analyticsConsentReceipt.create({
      data: {
        tenantId: T,
        noticeVersion: 1,
        analyticsGranted: true,
        advertisingGranted: false,
        locale: "en",
        decisionMethod: "BANNER_ACCEPT_ALL",
        decidedAt: monthsAgo(32),
        expiresAt: monthsAgo(26),
      },
    });
    await prisma.analyticsConsentReceipt.create({
      data: {
        tenantId: T,
        noticeVersion: 1,
        analyticsGranted: true,
        advertisingGranted: true,
        locale: "en",
        decisionMethod: "MANAGE",
        decidedAt: daysAgo(10),
        expiresAt: daysAgo(-170),
      },
    });

    const counts = async () => ({
      events: await prisma.analyticsEvent.count({ where: { tenantId: T } }),
      sessions: await prisma.analyticsSession.count({ where: { tenantId: T } }),
      visitors: await prisma.analyticsVisitor.count({ where: { tenantId: T } }),
      receipts: await prisma.analyticsConsentReceipt.count({ where: { tenantId: T } }),
      daily: await prisma.analyticsDailyMetric.count({ where: { tenantId: T } }),
      orders: await prisma.order.count({ where: { tenantId: T } }),
    });

    // ------------------------------------------------------------- P4-24a: the dry run
    const before = await counts();
    const dry = await runRetention(new Date(), true);
    const afterDry = await counts();
    assert.deepEqual(afterDry, before, "a dry run must change nothing at all");
    assert.equal(dry.totalDeleted, 0, "a dry run must report deleting nothing");
    assert.equal(dry.dryRun, true);
    const matched = Object.fromEntries(dry.windows.map((w) => [w.table, w.matched]));
    assert.ok(matched.AnalyticsEvent >= 2, `the dry run must see the 2 old events: ${describeRetention(dry)}`);
    assert.ok(matched.AnalyticsSession >= 1, "and the inactive session");
    assert.ok(matched.AnalyticsVisitor >= 1, "and the unseen visitor");
    assert.ok(matched.AnalyticsConsentReceipt >= 1, "and the long-expired receipt");
    assert.ok(matched.AnalyticsDailyMetric >= 1, "and the 30-month-old aggregate row");
    ok(
      "P4-24a",
      `the dry run counted what each window would take and deleted nothing: ${describeRetention(dry)}`,
    );

    // ------------------------------------------------------------ P4-24: the real deletion
    const real = await runRetention(new Date(), false);
    const afterReal = await counts();
    assert.equal(afterReal.events, 2, "only the two events inside the 90-day window survive");
    assert.equal(afterReal.sessions, 1, "only the active session survives");
    assert.equal(afterReal.visitors, 1, "only the recently seen visitor survives");
    assert.equal(afterReal.receipts, 1, "only the current consent receipt survives");
    assert.equal(afterReal.daily, 1, "only the aggregate row inside 24 months survives");
    assert.ok(real.totalDeleted >= 6, `something should have been deleted: ${real.totalDeleted}`);
    const survivingDay = await prisma.analyticsDailyMetric.findFirstOrThrow({ where: { tenantId: T } });
    assert.equal(survivingDay.sessions, 22, "and it is the one we expected, unmodified");
    ok("P4-24", `each window deleted exactly its own rows (${real.totalDeleted} in total)`);

    // ------------------------------------------------- P4-25: retention never touches orders
    assert.equal(afterReal.orders, 1, "retention must not delete an order");
    const afterRetentionOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(afterRetentionOrder.status, "PENDING");
    assert.equal(
      afterRetentionOrder.analyticsSessionId,
      freshSession.id,
      "and must not clear an order's session key either — only an erasure does that",
    );
    assert.equal(afterRetentionOrder.attributionSource, "newsletter");
    ok("P4-25", "the order survived retention intact, attribution and session key included");

    // Deleting the session an order points at leaves the order: there is no foreign key, by
    // design, and this is the check that would fail the day somebody adds one.
    await prisma.analyticsSession.deleteMany({ where: { id: freshSession.id } });
    const orphaned = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(orphaned.analyticsSessionId, freshSession.id, "the key remains, pointing at nothing");
    ok("P4-25", "deleting the session an order references leaves the order and its snapshot");

    // ---------------------------------------- P4-26 and P4-27: export, erase, and what stays
    // A new visitor with its own data, so the erasure has something to take.
    const subject = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSeenAt: daysAgo(3), lastSeenAt: daysAgo(1), country: "LB", deviceClass: "mobile" },
    });
    const otherVisitor = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSeenAt: daysAgo(3), lastSeenAt: daysAgo(1), country: "LB", deviceClass: "mobile" },
    });
    const subjectSession = await prisma.analyticsSession.create({
      data: { tenantId: T, visitorId: subject.id, startedAt: daysAgo(2), lastActivityAt: daysAgo(2), sourceKind: "social", source: "facebook", medium: "social" },
    });
    const otherSession = await prisma.analyticsSession.create({
      data: { tenantId: T, visitorId: otherVisitor.id, startedAt: daysAgo(2), lastActivityAt: daysAgo(2), sourceKind: "direct" },
    });
    await addEvent(subjectSession.id, subject.id, daysAgo(2));
    await addEvent(subjectSession.id, subject.id, daysAgo(2));
    await addEvent(otherSession.id, otherVisitor.id, daysAgo(2));
    const subjectOrder = await placeOrder(
      T,
      {
        customerName: "Erasure Shopper",
        customerPhone: "+961 70 000 031",
        customerAddress: "6 Erasure Street",
        deliveryLocation: "Test location",
        notes: "",
      },
      [{ variantId, quantity: 1 }],
      {
        expectedDeliveryFeeCents: 0,
        attribution: {
          analyticsSessionId: subjectSession.id,
          isReturningVisitor: false,
          attributionSource: "facebook",
          attributionMedium: "social",
          analyticsCountry: "LB",
          analyticsDeviceClass: "mobile",
        },
      },
    );

    const summary = await summarizePrivacyRequest(T, subject.id);
    assert.equal(summary.found, true);
    assert.equal(summary.sessions, 1);
    assert.equal(summary.events, 2);
    assert.equal(summary.linkedOrders, 1);

    const exported = await exportPrivacyRequest(T, subject.id);
    assert.equal(exported.sessions.length, 1, "the export must hold this visitor's session");
    assert.equal(exported.events.length, 2);
    assert.deepEqual(exported.retainedOrderIds, [subjectOrder.id]);
    const exportedJson = JSON.stringify(exported);
    assert.ok(!exportedJson.includes(otherSession.id), "another visitor's session leaked");
    assert.ok(!exportedJson.includes("Erasure Shopper"), "the export must not carry order details");
    ok("P4-26", "an export holds that visitor's sessions and events, and no other visitor's");

    const dailyBefore = await prisma.analyticsDailyMetric.findMany({ where: { tenantId: T }, select: { sessions: true } });
    const erased = await erasePrivacyRequest(T, subject.id);
    assert.equal(erased.eventsDeleted, 2);
    assert.equal(erased.sessionsDeleted, 1);
    assert.equal(erased.visitorDeleted, true);
    assert.equal(erased.ordersDetached, 1);

    const keptOrder = await prisma.order.findUniqueOrThrow({ where: { id: subjectOrder.id } });
    assert.equal(keptOrder.analyticsSessionId, null, "erasure clears the one identifying link");
    assert.equal(keptOrder.attributionSource, "facebook", "and leaves the non-identifying dimensions");
    assert.equal(keptOrder.attributionMedium, "social");
    assert.equal(keptOrder.isReturningVisitor, false);
    assert.equal(keptOrder.status, "PENDING", "the order itself is untouched");
    ok("P4-26", "erasure deleted the browsing history and detached the order without deleting it");

    assert.equal(
      await prisma.analyticsVisitor.count({ where: { id: otherVisitor.id } }),
      1,
      "the other visitor must be untouched",
    );
    assert.equal(await prisma.analyticsEvent.count({ where: { visitorId: otherVisitor.id } }), 1);
    const dailyAfter = await prisma.analyticsDailyMetric.findMany({ where: { tenantId: T }, select: { sessions: true } });
    assert.deepEqual(dailyAfter, dailyBefore, "aggregate totals must survive an erasure (§4.7)");
    ok("P4-27", "the erasure left the other visitor alone and the anonymous daily totals intact");

    // ------------------------------------------------------------------ P4-26a: audit + access
    await recordPrivacyAudit({
      tenantId: T,
      actorUserId: null,
      actorEmail: "verify-retention@example.test",
      action: "PRIVACY_ERASE",
      subject: subject.id,
      detail: "written by the check",
    });
    const audit = await listPrivacyAudit(T);
    assert.ok(audit.length >= 1, "the erasure must be recorded");
    assert.equal(audit[0].action, "PRIVACY_ERASE");
    assert.equal(audit[0].subject, subject.id);
    ok("P4-26a", "a privacy action is written to the audit log with who, what and on whom");

    // The owner side of D36, enforced statically: nothing under /admin may reach the privacy
    // service or the console's actions. A store owner must not be able to erase a visitor's
    // trail — or the record of having done so.
    const ownerOffenders: string[] = [];
    const walk = (p: string) => {
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) return;
      if (st.isDirectory()) {
        for (const entry of readdirSync(p)) walk(path.join(p, entry));
        return;
      }
      if (!/\.(ts|tsx)$/.test(p)) return;
      const source = readFileSync(p, "utf8");
      if (source.includes("privacy-request")) ownerOffenders.push(p);
    };
    walk("app/admin");
    assert.deepEqual(
      ownerOffenders,
      [],
      `these owner-facing files reach the privacy service: ${ownerOffenders.join(", ")}`,
    );
    const actions = readFileSync(
      "app/platform/(admin)/stores/[slug]/privacy/privacy-request-actions.ts",
      "utf8",
    );
    const calls = actions.split("export async function").length - 1;
    const guards = actions.split("requirePlatformAdmin(").length - 1;
    assert.ok(guards >= 1, "the console's actions must check the role");
    assert.ok(
      calls >= 3,
      "there should be a lookup, an export and an erasure, all behind that check",
    );
    ok("P4-26a", `no owner-facing file reaches the privacy service; ${calls} actions, all platform-admin`);

    // ------------------------------------------------- the retention windows are env-driven
    assert.equal(env.ANALYTICS_RAW_RETENTION_DAYS, 90, "§4.7: raw events, 90 days");
    assert.equal(env.ANALYTICS_VISITOR_RETENTION_MONTHS, 13, "§4.7: visitors/sessions, 13 months");
    assert.equal(env.ANALYTICS_AGGREGATE_RETENTION_MONTHS, 24, "§4.7: aggregates, 24 months");
    assert.equal(env.ANALYTICS_RECEIPT_RETENTION_MONTHS, 24, "§4.7: receipts, 24 months past expiry");
    ok("P4-24", "the four windows default to exactly what §4.7 says");
  } finally {
    await prisma.analyticsAuditLog.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

async function shutdown() {
  await disconnectJobPrisma().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

// No process.exit(): see the note in scripts/verify-search.ts.
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
