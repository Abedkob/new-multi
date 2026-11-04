/**
 * Phase 3 verification: money means one thing (pnpm verify:commerce-analytics).
 *
 * Phase 3 is where events start making commercial claims, so this is where a measurement
 * system earns or loses its credibility: the first number a merchant checks is the one they can
 * compare against their own takings.
 *
 * Everything here is therefore about separation and independence rather than features:
 *
 *   - the only money analytics computes is a WhatsApp click's potential value, and it comes
 *     from canonical pricing, never from anything a browser said;
 *   - that potential value is never summed with revenue, anywhere;
 *   - an order's origin is a snapshot written inside the order's own transaction, and a later
 *     change to the session must not rewrite it;
 *   - and nothing in this subsystem can make an order fail.
 *
 * Every check prints the acceptance id it answers, so a passing run is the evidence for those
 * rows in PHASE_3_ACCEPTANCE.md. The browser-side items (the funnel in order, the WhatsApp
 * button, a real checkout carrying its attribution) belong to pnpm e2e:analytics.
 *
 * Needs a server started with ANALYTICS_ROLLOUT_MODE=all and the same ANALYTICS_SIGNING_SECRET:
 *
 *   BASE_URL=http://localhost:3200 pnpm verify:commerce-analytics
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPathForSlug,
  type AnalyticsEventInput,
} from "../lib/analytics/contract";
import { resolveOrderAttribution } from "../lib/analytics/order-attribution";
import { mintBootstrapToken } from "../lib/analytics/token";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { GRANT_ALL } from "../lib/consent/types";
import { createCoupon } from "../lib/data/coupons";
import { createDiscount, setDiscountAssignmentsForProducts } from "../lib/data/discounts";
import {
  forgetOrderAttributionLinks,
  placeOrder,
  updateOrderStatus,
  type OrderAttributionSnapshot,
} from "../lib/data/orders";
import { createProduct } from "../lib/data/products";
import { createStoreWithOwner, updateTenantDeliverySettings } from "../lib/data/tenants";
import { orderTotal } from "../lib/orders";
import { hashPassword } from "../lib/passwords";
import { closeRedis } from "../lib/redis";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const customer = {
  customerName: "Ada Lovelace",
  customerPhone: "+961 70 000 000",
  customerAddress: "12 Test Street",
  deliveryLocation: "Test location",
  notes: "",
};

const event = (over: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput => ({
  eventId: randomUUID(),
  type: "PAGE_VIEW",
  occurredAt: Date.now(),
  pageKind: "home",
  ...over,
});

/** Wait for the write that a 202 does not wait for. */
const settle = () => new Promise((r) => setTimeout(r, 500));

/**
 * Source files matching a pattern, as git sees them. Several checks here are static: the risk
 * in Phase 3 is not a wrong number today but a module written later that joins things which
 * must stay apart, and a grep is the only test that can fail for code nobody has written yet.
 */
const gitGrepFiles = (pattern: string, paths: string[] = ["*.ts", "*.tsx"]): string[] => {
  const args = paths.map((path) => JSON.stringify(path)).join(" ");
  try {
    // -F: a fixed string, so a pattern like "analyticsEvent." needs no escaping and cannot
    // quietly become a regex that matches more than intended.
    const out = execSync(`git grep -lF ${JSON.stringify(pattern)} -- ${args}`, {
      encoding: "utf8",
    });
    return out.split("\n").filter(Boolean);
  } catch {
    // git grep exits 1 when nothing matches, which is an answer, not a failure.
    return [];
  }
};

const payableOf = (order: {
  items: { priceCentsSnapshot: number; quantity: number }[];
  deliveryFeeCentsSnapshot: number;
  couponDiscountCentsSnapshot: number;
}) => orderTotal(order.items, order.deliveryFeeCentsSnapshot, order.couponDiscountCentsSnapshot);

async function main() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Commerce Analytics ${run}`,
    ownerName: "Phase3",
    ownerEmail: `commerce-analytics-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 3 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-commerce-analytics",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;

  try {
    await updateTenantDeliverySettings(T, { deliveryFeeCents: 500, deliveryNote: "Test delivery" });
    const product = await createProduct(T, {
      name: "Measured Item",
      description: "",
      basePriceCents: 1000,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [{ attributes: {}, stock: 50, priceCentsOverride: null, imageUrl: null }],
    });
    const variantId = product.variants[0].id;
    // An automatic 20% discount, so "the price the shopper saw" and "the base price" differ. A
    // value computed from the wrong one is then visible, rather than coincidentally equal.
    const discount = await createDiscount(T, {
      name: "Automatic 20",
      type: "PERCENTAGE",
      value: 20,
      isEnabled: true,
      startsAt: null,
      endsAt: null,
    });
    await setDiscountAssignmentsForProducts(T, discount.id, [product.id], [product.id]);
    await createCoupon(T, {
      name: "Checkout 10",
      code: "SAVE10",
      scope: "ORDER_SUBTOTAL",
      type: "PERCENTAGE",
      value: 10,
      isEnabled: true,
      startsAt: null,
      endsAt: null,
      isAnnounced: false,
      announcementText: "",
      productIds: [],
    });

    const endpoint = `${BASE}${analyticsEventsPathForSlug(tenant.slug)}`;
    const consentCookie = `${consentCookieName(T)}=${encodeConsent(
      buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
    )}`;
    const post = async (body: AnalyticsEventInput[] | string) =>
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: consentCookie },
          body:
            typeof body === "string"
              ? body
              : JSON.stringify({
                  schemaVersion: ANALYTICS_SCHEMA_VERSION,
                  sentAt: Date.now(),
                  token: mintBootstrapToken(T),
                  events: body,
                }),
        })
      ).status;

    // ------------------------------------------------------------------ the client cannot price
    // A regression of P2-14, re-checked here because Phase 3 is the phase that gives an event a
    // money column: the moment a value exists, who may set it stops being hypothetical.
    const forged = JSON.stringify({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      sentAt: Date.now(),
      token: mintBootstrapToken(T),
      events: [
        {
          ...event({ type: "WHATSAPP_ORDER_CLICK", pageKind: "product", productId: product.id }),
          valueCents: 999_999,
        },
      ],
    });
    assert.equal(await post(forged), 400, "a client-supplied valueCents must be refused");
    ok("P3-02", "an envelope carrying valueCents is refused outright (400), not quietly ignored");

    // ------------------------------------------------------------------ the server prices it
    const click = event({
      type: "WHATSAPP_ORDER_CLICK",
      pageKind: "product",
      productId: product.id,
      variantId,
      quantity: 3,
    });
    const clickStatus = await post([click]);
    assert.equal(clickStatus, 202, `the endpoint should accept the click, got ${clickStatus}`);
    await settle();
    const storedClick = await prisma.analyticsEvent.findFirst({
      where: { tenantId: T, eventId: click.eventId },
    });
    assert.ok(
      storedClick,
      "No event was stored. Is the server running with ANALYTICS_ROLLOUT_MODE=all and the " +
        "same ANALYTICS_SIGNING_SECRET as this script?",
    );
    // 1000 base, 20% off, three of them.
    assert.equal(
      storedClick.valueCents,
      2400,
      `expected the discounted price (800) times 3, got ${storedClick.valueCents}`,
    );
    assert.notEqual(storedClick.valueCents, 3000, "the base price must not be used");
    ok(
      "P3-03",
      "a WhatsApp click is valued server-side from canonical pricing: 3 x 800 (20% off 1000) = " +
        "2400, not 3 x 1000",
    );

    // Everything else stores no money at all.
    assert.equal(
      await post([
        event({ type: "PAGE_VIEW", pageKind: "home" }),
        event({ type: "ADD_TO_CART", pageKind: "product", variantId, quantity: 2 }),
      ]),
      202,
    );
    await settle();
    const valued = await prisma.analyticsEvent.findMany({
      where: { tenantId: T, valueCents: { not: null } },
      select: { type: true },
    });
    assert.deepEqual(
      [...new Set(valued.map((row) => row.type))],
      ["WHATSAPP_ORDER_CLICK"],
      "only a WhatsApp click may carry a value",
    );
    ok("P3-04", `${valued.length} valued row(s), all WHATSAPP_ORDER_CLICK; every other type is null`);

    // ------------------------------------------------------------------ nothing sums the two
    // A static check, because the danger is not a wrong number today but a helper written later
    // that folds potential value into revenue. A module that touches an order's money
    // snapshots must not also touch an event's value.
    const sources = [
      "lib/analytics/ingest.ts",
      "lib/analytics/whatsapp-value.ts",
      "lib/analytics/order-attribution.ts",
      "lib/data/orders.ts",
      "lib/orders.ts",
      "lib/pricing.ts",
    ];
    const orderMoney = /priceCentsSnapshot|deliveryFeeCentsSnapshot|couponDiscountCentsSnapshot/;
    for (const file of sources) {
      // A comment may mention both, and should. Judge the code only.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
      assert.ok(
        !(/valueCents/.test(code) && orderMoney.test(code)),
        `${file} refers to both an event's valueCents and an order's money snapshots; ` +
          "potential value and revenue must not meet in one module",
      );
    }
    ok(
      "P3-04",
      `no module reads both an event's valueCents and an order's money (${sources.length} checked)`,
    );

    // ------------------------------------------------------------------ the order is the source
    const snapshot: OrderAttributionSnapshot = {
      isReturningVisitor: true,
      attributionSource: "newsletter",
      attributionMedium: "email",
      attributionCampaign: "november",
      firstTouchSource: "instagram.com",
      firstTouchMedium: "social",
      firstTouchCampaign: "launch",
      analyticsCountry: "LB",
      analyticsDeviceClass: "mobile",
    };
    const order = await placeOrder(T, customer, [{ variantId, quantity: 2 }], {
      couponCode: "SAVE10",
      attribution: snapshot,
    });
    // 2 x 800 = 1600, +500 delivery, -10% of 1600 = 160 -> 1940.
    const payable = payableOf(order);
    assert.equal(payable, 1940, `the order's own payable total should be 1940, got ${payable}`);
    assert.equal(
      await prisma.analyticsEvent.count({
        where: { tenantId: T, valueCents: { not: null }, type: { not: "WHATSAPP_ORDER_CLICK" } },
      }),
      0,
    );
    ok(
      "P3-01",
      `the order's value comes from the order: 2 x 800 + 500 delivery - 160 coupon = ${payable}, ` +
        "and no analytics row restates it",
    );

    assert.equal(order.attributionSource, "newsletter");
    assert.equal(order.attributionMedium, "email");
    assert.equal(order.attributionCampaign, "november");
    assert.equal(order.firstTouchSource, "instagram.com");
    assert.equal(order.firstTouchMedium, "social");
    assert.equal(order.firstTouchCampaign, "launch");
    assert.equal(order.isReturningVisitor, true);
    assert.equal(order.analyticsCountry, "LB");
    assert.equal(order.analyticsDeviceClass, "mobile");
    ok(
      "P3-14",
      "an order records last touch (source, medium, campaign), first touch (source, medium, " +
        "campaign), returning-or-not, country and device",
    );

    // ------------------------------------------------------------------ no identity on an order
    // The structural half of the privacy rule. An order is kept for years, outside the 13-month
    // analytics retention sweep, so it must carry no durable identifier for a person. "Had they
    // been here before" is a boolean precisely so that it cannot be re-identified.
    const orderColumns = (
      await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'Order'`
    ).map((row) => row.column_name);
    const identifying = orderColumns.filter((c) => /visitorId|eventId/i.test(c));
    assert.deepEqual(identifying, [], `Order must carry no analytics identity: ${identifying}`);
    assert.ok(orderColumns.includes("isReturningVisitor"));
    assert.equal(typeof order.isReturningVisitor, "boolean");
    ok(
      "P3-23",
      "an order has no visitor id and no event id, only a session key and a returning boolean",
    );

    // ------------------------------------------------------------------ nulls are normal
    const plain = await placeOrder(T, customer, [{ variantId, quantity: 1 }]);
    assert.equal(plain.analyticsSessionId, null);
    assert.equal(plain.attributionSource, null);
    assert.equal(plain.analyticsCountry, null);
    assert.equal(plain.status, "PENDING");
    ok("P3-15", "an order placed with no attribution records nulls and completes normally");

    // ------------------------------------------------------------------ written once, in the tx
    const referencing = gitGrepFiles("attributionSource")
      .filter((file) => !file.startsWith("scripts/"))
      .sort();
    assert.deepEqual(
      referencing,
      ["lib/analytics/order-attribution.ts", "lib/data/orders.ts"],
      `attribution is referenced outside the resolver and the order module: ${referencing.join(", ")}`,
    );
    const ordersSource = readFileSync("lib/data/orders.ts", "utf8");
    assert.ok(
      !/order\.update[\s\S]{0,400}attribution(Source|Medium|Campaign)/.test(ordersSource),
      "no order update may write attribution dimensions; they belong to tx.order.create only",
    );
    ok("P3-16", "attribution is written only inside placeOrder's own tx.order.create, never after");

    // An order is reconciled against SESSIONS, never against individual events. A join from an
    // order into the event stream would turn that order into a key for one person's browsing,
    // which is the thing the missing visitor id above exists to prevent. Phase 5's reports are
    // held to the same rule by this check: no module may read both.
    const eventReaders = gitGrepFiles("analyticsEvent.").filter(
      (file) => !file.startsWith("scripts/"),
    );
    // The check is only worth anything if something actually reads the event table.
    assert.ok(
      eventReaders.includes("lib/analytics/ingest.ts"),
      `the event-table search found nothing to compare against: ${eventReaders.join(", ")}`,
    );
    const bothSides = referencing.filter((file) => eventReaders.includes(file));
    assert.deepEqual(
      bothSides,
      [],
      `these modules read both an order's attribution and the event table: ${bothSides.join(", ")}`,
    );
    ok("P3-24", "no module joins orders to individual events; the session is the only key");

    // ------------------------------------------------------------------ a snapshot stays a snapshot
    const visitor = await prisma.analyticsVisitor.create({
      data: { tenantId: T, firstSource: "instagram.com" },
    });
    const session = await prisma.analyticsSession.create({
      data: { tenantId: T, visitorId: visitor.id, source: "newsletter", medium: "email" },
    });
    const attributed = await placeOrder(T, customer, [{ variantId, quantity: 1 }], {
      attribution: {
        analyticsSessionId: session.id,
        isReturningVisitor: false,
        attributionSource: session.source,
        attributionMedium: session.medium,
        firstTouchSource: visitor.firstSource,
      },
    });
    await prisma.analyticsSession.update({
      where: { id: session.id },
      data: { source: "rewritten-later", medium: "paid" },
    });
    const reread = await prisma.order.findUniqueOrThrow({ where: { id: attributed.id } });
    assert.equal(reread.attributionSource, "newsletter", "a later session change rewrote an order");
    assert.equal(reread.attributionMedium, "email");
    ok("P3-17", "changing a session's source afterwards does not rewrite an order already placed");

    // ------------------------------------------------------------------ every event has a session
    const nullable = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'AnalyticsEvent' AND column_name = 'sessionId'`;
    assert.equal(nullable[0]?.is_nullable, "NO", "an event without a session must be impossible");
    const orphans = await prisma.$queryRaw<{ c: number }[]>`
      SELECT count(*)::int c FROM "AnalyticsEvent" e
      LEFT JOIN "AnalyticsSession" s ON s.id = e."sessionId" AND s."tenantId" = e."tenantId"
      WHERE e."tenantId" = ${T} AND s.id IS NULL`;
    assert.equal(orphans[0].c, 0);
    ok("P3-07", "sessionId is NOT NULL and every stored event resolves to a session of this store");

    // ------------------------------------------------------------------ a click is not a sale
    const allOrders = await prisma.order.findMany({ where: { tenantId: T }, include: { items: true } });
    assert.equal(allOrders.length, 3, `expected the three orders placed here, found ${allOrders.length}`);
    const revenue = allOrders.reduce((sum, o) => sum + payableOf(o), 0);
    assert.ok(
      !allOrders.some((o) => payableOf(o) === storedClick.valueCents),
      "a WhatsApp click's potential value must not appear as an order's value",
    );
    ok(
      "P3-13",
      `the WhatsApp click created no order (${allOrders.length} orders, every one placed by ` +
        `checkout) and no revenue (${revenue} cents, none of it the click's ${storedClick.valueCents})`,
    );

    // ------------------------------------------------------------------ cancelling
    const toCancel = allOrders.find((o) => o.id === attributed.id)!;
    await updateOrderStatus(T, toCancel.id, "CANCELLED");
    const afterCancel = await prisma.order.findUniqueOrThrow({
      where: { id: toCancel.id },
      include: { items: true },
    });
    assert.equal(afterCancel.status, "CANCELLED");
    assert.equal(
      afterCancel.attributionSource,
      "newsletter",
      "a cancelled order must keep its origin: it is still a conversion that happened",
    );
    const liveRevenue = (
      await prisma.order.findMany({
        where: { tenantId: T, status: { not: "CANCELLED" } },
        include: { items: true },
      })
    ).reduce((sum, o) => sum + payableOf(o), 0);
    assert.equal(liveRevenue, revenue - payableOf(afterCancel));
    ok(
      "P3-05",
      "a cancelled order keeps its attribution (still a conversion) while leaving value totals: " +
        `${revenue} - ${payableOf(afterCancel)} = ${liveRevenue}`,
    );

    // ------------------------------------------------------------------ erasure clears the key
    // An erasure request, and Phase 4's retention sweep, must be able to remove the thread back
    // to a person without touching the order. The session id IS that thread, so it is the only
    // thing cleared: the dimensions beside it identify nobody, and dropping them would make a
    // merchant's own history change under them.
    const erasureSession = await prisma.analyticsSession.create({
      data: { tenantId: T, visitorId: visitor.id, source: "newsletter", medium: "email" },
    });
    const toErase = await placeOrder(T, customer, [{ variantId, quantity: 1 }], {
      attribution: {
        analyticsSessionId: erasureSession.id,
        isReturningVisitor: true,
        attributionSource: "newsletter",
        attributionMedium: "email",
      },
    });
    const erased = await forgetOrderAttributionLinks(T, [erasureSession.id]);
    assert.equal(erased.count, 1, "the order linked to that session should have been updated");
    const afterErasure = await prisma.order.findUniqueOrThrow({ where: { id: toErase.id } });
    assert.equal(afterErasure.analyticsSessionId, null, "the session key must be gone");
    assert.equal(afterErasure.attributionSource, "newsletter", "the dimensions must remain");
    assert.equal(afterErasure.isReturningVisitor, true);
    assert.equal(afterErasure.status, "PENDING", "erasure must not disturb the order itself");
    ok(
      "P3-25",
      "privacy erasure clears an order's analyticsSessionId and leaves the order and its " +
        "non-identifying dimensions untouched",
    );

    // ------------------------------------------------------------------ one WhatsApp order path
    // The product button is the only control that offers to ORDER over WhatsApp. The storefront
    // shell also has a WhatsApp contact shortcut, and it is deliberately not an order click: it
    // carries no product, no variant and no cart, so pricing it would put a meaningless zero
    // into potential value. If a template ever grows a cart-level "order this cart on WhatsApp",
    // this check fails and that control has to be instrumented.
    // Storefront surfaces only. The admin pages also link to wa.me, but that is the owner
    // messaging a customer about an order they already have, not a shopper ordering.
    const waLinks = gitGrepFiles("wa.me", ["templates/*", "components/*"]).sort();
    assert.deepEqual(
      waLinks,
      ["templates/product-client.tsx"],
      `a new storefront WhatsApp link appeared and may need instrumenting: ${waLinks.join(", ")}`,
    );
    const contactButton = readFileSync("components/whatsapp-contact-button.tsx", "utf8");
    assert.ok(
      !/useCart|productId|variantId/.test(contactButton),
      "the shell's WhatsApp shortcut must stay a contact link, with no cart or product in it",
    );
    for (const view of ["templates/cart-view.tsx", "templates/checkout-view.tsx"]) {
      assert.ok(
        !/whatsapp/i.test(readFileSync(view, "utf8")),
        `${view} now offers WhatsApp: a cart-level order click needs instrumenting`,
      );
    }
    const emitters = gitGrepFiles("WHATSAPP_ORDER_CLICK", ["templates/*", "components/*"]).sort();
    assert.deepEqual(
      emitters,
      ["templates/product-client.tsx"],
      `WHATSAPP_ORDER_CLICK is emitted from more than the product button: ${emitters.join(", ")}`,
    );
    ok(
      "P3-26",
      "the product button is the only WhatsApp order control; the shell's contact shortcut " +
        "carries no cart, so no template has a cart-level WhatsApp order to instrument",
    );

    // ------------------------------------------------------------------ retention cannot take orders
    const fks = await prisma.$queryRaw<{ constraint_name: string }[]>`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'Order' AND tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name IN ('AnalyticsSession', 'AnalyticsVisitor')`;
    assert.deepEqual(fks, [], "a foreign key here would let retention delete or block orders");
    await prisma.analyticsEvent.deleteMany({ where: { tenantId: T } });
    await prisma.analyticsSession.deleteMany({ where: { tenantId: T } });
    await prisma.analyticsVisitor.deleteMany({ where: { tenantId: T } });
    const survived = await prisma.order.findUniqueOrThrow({ where: { id: attributed.id } });
    assert.equal(survived.analyticsSessionId, session.id, "the order kept its reference");
    assert.equal(survived.attributionSource, "newsletter");
    ok("P3-18", "deleting every analytics row leaves the orders and their snapshots intact");

    // ------------------------------------------------------------------ nothing here breaks an order
    // A forced failure, not a simulated one: resolveOrderAttribution runs outside any request,
    // so its first statement (reading cookies) throws. It must still answer "nothing to
    // attribute" rather than propagate, because its caller is about to place an order.
    const failed = await resolveOrderAttribution(tenant);
    assert.equal(failed, undefined, "a failing resolver must return undefined, not throw");
    const afterFailure = await placeOrder(T, customer, [{ variantId, quantity: 1 }], {
      attribution: failed,
    });
    assert.equal(afterFailure.status, "PENDING");
    assert.equal(afterFailure.analyticsSessionId, null);
    ok("P3-20", "when attribution resolution throws, it returns undefined and the order completes");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
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
