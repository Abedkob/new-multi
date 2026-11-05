/**
 * Phase 6 verification: the notification ledger (pnpm verify:notifications — P6-06, P6-08,
 * P6-09, P6-14, P6-20, D52, D60).
 *
 * This suite exists because the guarantees in `lib/data/notifications.ts` are all about two
 * things happening at once, and that is the one kind of bug that cannot be found by reading the
 * code or by clicking through a screen. A merchant woken twice at 3am, or not at all, is the
 * output of a race nobody reproduced.
 *
 * So the checks below actually race: two claims issued concurrently for one order, two senders
 * claiming one delivery, a lease left behind by a sender that "crashed". Where a race is
 * arranged rather than genuine, the comment says so.
 *
 * Commit 1 of the phase, so there is no sender and no UI yet: nothing here pushes anything.
 * What is proven is the ledger — which is the part that must be right before a sender exists.
 *
 * No server needed.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma, withBypass } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { createProduct } from "../lib/data/products";
import { placeOrder } from "../lib/data/orders";
import {
  LEASE_MS,
  NotificationRefused,
  announcedOrderIds,
  claimDelivery,
  claimOrdersForNotification,
  finalizeBody,
  notificationWithDeliveries,
  queueDeliveries,
  recordDeliveryOutcome,
  type NotificationDraft,
} from "../lib/data/notifications";
import { NOTIFIABLE_TYPES, TYPE_AUDIENCE, mayReceive } from "../lib/notifications/types";
import {
  FORBIDDEN_PAYLOAD_FIELDS,
  assertPayloadIsSafe,
  buildNewOrderPayload,
  newOrderTag,
} from "../lib/push/payload";
import { classifyPushError, sendPush } from "../lib/push/send";
import {
  decryptPushSecret,
  encryptPushSecret,
  endpointHash,
  pushSecretsAvailable,
} from "../lib/push/crypto";
import { pushConfigured, vapidPublicKey } from "../lib/push/keys";
import { createServer, type Socket } from "node:net";
import { createECDH, randomBytes } from "node:crypto";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(6)} ${message}`);
};

const customer = {
  customerName: "Notify Tester",
  customerPhone: "03000000",
  customerAddress: "Somewhere",
  deliveryLocation: "Somewhere",
  notes: "",
};

/**
 * D60 and the audience rule, which are pure and therefore checked without a database.
 *
 * The staff row is the point: there is no staff role in the schema yet, and the gate is built
 * now so that adding one is a single entry rather than an audit of every sender.
 */
function matrixChecks() {
  assert.deepEqual(NOTIFIABLE_TYPES.STAFF, ["NEW_ORDER"], "staff get new orders and nothing else");
  for (const type of NOTIFIABLE_TYPES.STORE_OWNER) {
    assert.equal(TYPE_AUDIENCE[type], "OWNER", `${type} must be an owner type`);
  }
  for (const type of NOTIFIABLE_TYPES.PLATFORM_ADMIN) {
    assert.equal(TYPE_AUDIENCE[type], "PLATFORM", `${type} must be a platform type`);
  }
  // No type may be receivable by both an owner and a platform admin: the two audiences are
  // separate inboxes, and a shared type would be the seam they leak through (P6-19).
  for (const type of NOTIFIABLE_TYPES.STORE_OWNER) {
    assert.ok(
      !NOTIFIABLE_TYPES.PLATFORM_ADMIN.includes(type),
      `${type} is receivable by both audiences`,
    );
  }
  for (const analytics of ["WEEKLY_SUMMARY", "PRODUCT_ALERT", "FUNNEL_ALERT", "SEARCH_ALERT", "TRAFFIC_ALERT"] as const) {
    assert.ok(mayReceive("STORE_OWNER", analytics), `an owner may receive ${analytics}`);
    assert.ok(!mayReceive("STAFF", analytics), `a staff account may NOT receive ${analytics}`);
  }
  // Every type in the enum is placed in exactly one audience — a new type added without a home
  // fails here rather than being silently unsendable.
  const placed = new Set([...NOTIFIABLE_TYPES.STORE_OWNER, ...NOTIFIABLE_TYPES.PLATFORM_ADMIN]);
  for (const type of Object.keys(TYPE_AUDIENCE)) {
    assert.ok(placed.has(type as never), `${type} belongs to no role's list`);
  }
  ok("D60", `${placed.size} types placed, staff limited to NEW_ORDER, no type in both audiences`);

  // The contract-rejection signal must be its own type, not folded into ingestion health: it has
  // its own threshold and its own meaning (P6-25).
  assert.ok(
    TYPE_AUDIENCE.CONTRACT_REJECTION === "PLATFORM",
    "the 400 signal is a platform alert of its own",
  );
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.ok(
    /CONTRACT_REJECTION/.test(schema),
    "and it exists in the enum, so a row can record it",
  );
  ok("P6-25", "the contract-rejection signal is its own notification type");
}

/**
 * D50, on the builder: a payload cannot carry customer data because it is never handed any.
 *
 * Checked on the TYPE as well as on the output. A check that only looked at a produced string
 * would pass for a builder that accepts an order and happens not to interpolate it today.
 */
function payloadChecks() {
  const source = readFileSync("lib/push/payload.ts", "utf8");
  const facts = /export type NewOrderFacts = \{[\s\S]*?\n};/.exec(source)?.[0] ?? "";
  assert.ok(facts, "NewOrderFacts must be declared");
  for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
    assert.ok(
      !facts.includes(field),
      `NewOrderFacts carries ${field}: the builder must not be able to see customer data`,
    );
  }
  assert.ok(/count: number/.test(facts), "it takes a count");
  assert.ok(/totalCents: number \| null/.test(facts), "and an optional total, nothing else");

  const amountOff = buildNewOrderPayload({
    facts: { count: 3, totalCents: null },
    text: { title: "New orders", body: "You have 3 new orders." },
    recipientUserId: "user-1",
    triggerOrderId: "order-9",
    locale: "en",
  });
  assert.equal(amountOff.body, "You have 3 new orders.");
  assert.equal(amountOff.tag, newOrderTag("user-1", "order-9"));
  assert.equal(amountOff.destination, "/admin/orders");
  assert.equal(amountOff.dir, "ltr");
  assert.ok(!/[$]|\d+[.]\d\d/.test(amountOff.body), "with the amount off no money may appear");

  const arabic = buildNewOrderPayload({
    facts: { count: 1, totalCents: 34_000 },
    text: { title: "طلب جديد", body: "لديك طلب جديد." },
    recipientUserId: "user-1",
    triggerOrderId: "order-9",
    locale: "ar",
  });
  assert.equal(arabic.lang, "ar");
  assert.equal(arabic.dir, "rtl", "an Arabic body must be marked right-to-left (P6-12)");

  // The last gate: a body assembled somewhere else, with a customer's name in it, is refused.
  assert.throws(
    () =>
      assertPayloadIsSafe({ ...amountOff, body: "New order from Rania Haddad" }, [
        "Rania Haddad",
        "03 123 456",
      ]),
    /must not contain customer data/,
    "a payload carrying a customer name must be refused before it is sent",
  );
  // And a short value is not matched, or every body containing "ali" would be refused.
  assert.doesNotThrow(() => assertPayloadIsSafe(amountOff, ["Ali", ""]));
  assert.throws(
    () =>
      buildNewOrderPayload({
        facts: { count: 0, totalCents: null },
        text: { title: "t", body: "b" },
        recipientUserId: "u",
        triggerOrderId: "o",
        locale: "en",
      }),
    /at least one order/,
    "a notification about no orders is a bug, not an empty notification",
  );
  ok(
    "P6-10",
    `the builder cannot see any of ${FORBIDDEN_PAYLOAD_FIELDS.length} customer fields, and money is opt-in`,
  );
}

/** D56: a subscription at rest, and the keyed lookup that avoids decrypting the table. */
function cryptoChecks() {
  if (!pushSecretsAvailable()) {
    // Not a skip of the rule. The rule is that these secrets are encrypted, and with no key
    // nothing can be stored at all — which is what gets asserted instead.
    assert.throws(() => encryptPushSecret("x"), /PUSH_ENCRYPTION_KEY/);
    assert.throws(() => endpointHash("x"), /PUSH_ENCRYPTION_KEY/);
    ok("P6-22", "with no PUSH_ENCRYPTION_KEY a subscription cannot be stored at all");
    return;
  }
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
  const envelope = encryptPushSecret(endpoint);
  assert.ok(!envelope.includes("fcm.googleapis.com"), "the endpoint must not be readable");
  assert.ok(envelope.startsWith("v1:"), "a versioned envelope, like the licence secrets");
  assert.equal(decryptPushSecret(envelope), endpoint);
  assert.notEqual(encryptPushSecret(endpoint), envelope, "a fresh IV every time");
  assert.equal(endpointHash(endpoint), endpointHash(endpoint), "the hash is stable");
  assert.notEqual(endpointHash(endpoint), endpointHash(endpoint + "x"));
  assert.throws(() => decryptPushSecret("v2:a:b:c"), /Unsupported/);
  ok("P6-22", "an endpoint is unreadable at rest and still findable by its keyed hash");
}

/**
 * D51, the half a unit check can hold: a push service that hangs costs one timeout and comes
 * back as a verdict rather than as a throw.
 *
 * A real socket, not a mock. The failure this guards against is a promise that never settles
 * inside `after()`, and a mocked transport is exactly where that would be missed.
 */
async function senderChecks() {
  // A bare TCP listener, NOT an http server: web-push always speaks TLS to an endpoint, and an
  // http server answers a TLS ClientHello with an HTTP response, which the client rejects
  // immediately as EPROTO ("wrong version number"). That is a fast failure, not a hang, so the
  // timeout under test never fired. Accepting the socket and saying nothing stalls the
  // handshake, which is what a push service going dark actually looks like.
  // Sockets are tracked so they can be destroyed afterwards. `net.Server` has no
  // closeAllConnections() (that is http.Server), and `close()` waits for open connections — so
  // without this the close callback never fires.
  const sockets = new Set<Socket>();
  const hanging = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", () => resolve()));
  const port = (hanging.address() as { port: number }).port;

  try {
    const payload = buildNewOrderPayload({
      facts: { count: 1, totalCents: null },
      text: { title: "New order", body: "You have a new order." },
      recipientUserId: "u",
      triggerOrderId: "o",
      locale: "en",
    });
    // A REAL P-256 key pair, generated here. The first version of this check used a
    // valid-looking string, and web-push rejected it during payload encryption with "Public key
    // is not valid for specified curve" — before opening a socket. So the check passed, the
    // verdict was a FAILED/unknown, and the hanging server under test was never contacted. A
    // check that cannot reach the thing it is about is worse than no check.
    const subscriber = createECDH("prime256v1");
    subscriber.generateKeys();
    const target = {
      endpoint: `http://127.0.0.1:${port}/push`,
      p256dh: subscriber.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    };

    const started = Date.now();
    const verdict = await sendPush(target, payload, 600);
    const elapsed = Date.now() - started;

    if (!pushConfigured()) {
      assert.equal(
        verdict.state,
        "SKIPPED",
        "with push unconfigured the sender must be a no-op that says so (P6-31)",
      );
      assert.ok(elapsed < 400, `and must not wait on anything, took ${elapsed}ms`);
      assert.equal(vapidPublicKey(), null, "and the browser is offered no key to subscribe with");
      ok("P6-31", `push unconfigured: the sender skips in ${elapsed}ms and never opens a socket`);
    } else {
      assert.equal(verdict.state, "FAILED");
      assert.equal(verdict.state === "FAILED" && verdict.errorCategory, "timeout");
      assert.ok(elapsed < 2_500, `a hanging service must cost the timeout only, took ${elapsed}ms`);
      ok("P6-01", `a push service that hangs is abandoned after ${elapsed}ms with a timeout verdict`);
    }

    // Classification decides whether a merchant's device is deleted or retried, so the default
    // matters: an unrecognised failure must never be read as "this device is gone for good".
    const unknown = classifyPushError(
      Object.assign(new Error("received unexpected response code"), { statusCode: 410 }),
    );
    assert.equal(unknown.state, "FAILED", "an unrecognised error must not expire a device");
    assert.equal(classifyPushError(new Error("push timed out")).errorCategory, "timeout");
    assert.equal(classifyPushError(new Error("connect ECONNREFUSED")).errorCategory, "unreachable");
    assert.equal(classifyPushError("nonsense").errorCategory, "unknown");
    ok("P6-04", "a timeout, an unreachable host and an unknown failure are classified, none final");
  } finally {
    // Sockets first, THEN close. `server.close()` waits for open connections to end, and the
    // connection web-push abandoned when the timeout fired is still open — so the close
    // callback never ran, main() never returned, and the process exited 0 with the database
    // checks silently unrun. A suite that stops early and reports success is the worst
    // possible outcome of a check, so it is worth saying plainly why these two lines exist.
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => hanging.close(() => resolve()));
  }
}

async function main() {
  matrixChecks();
  payloadChecks();
  cryptoChecks();
  await senderChecks();

  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({
    storeName: `Notify ${run}`,
    ownerName: "N",
    ownerEmail: `notify-${run}@example.test`,
    passwordHash: "x",
  });
  const other = await createStoreWithOwner({
    storeName: `Notify Other ${run}`,
    ownerName: "O",
    ownerEmail: `notify-other-${run}@example.test`,
    passwordHash: "x",
  });
  const T = store.tenant.id;
  const ownerId = store.user.id;

  const draft = (dedupeKey: string): NotificationDraft => ({
    recipientUserId: ownerId,
    recipientRole: "STORE_OWNER",
    audience: "OWNER",
    type: "NEW_ORDER",
    tenantId: T,
    title: "New order",
    body: "You have a new order.",
    destination: "/admin/orders",
    locale: "en",
    dedupeKey,
  });

  try {
    const product = await createProduct(T, {
      name: "Notify Item",
      description: "",
      basePriceCents: 1000,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [{ attributes: {}, stock: 100, priceCentsOverride: null, imageUrl: null }],
    });
    const variantId = product.variants[0].id;
    const place = async () => {
      const order = await placeOrder(T, customer, [{ variantId, quantity: 1 }], {
        expectedDeliveryFeeCents: 0,
      });
      return order.id;
    };

    // ---------------------------------------------------------------------------------------
    // D52: one order, one notification, however many senders try.
    // ---------------------------------------------------------------------------------------
    const orderA = await place();
    const first = await claimOrdersForNotification(draft(`owner-order:${ownerId}:${orderA}`), [orderA]);
    assert.equal(first.kind, "claimed");
    const second = await claimOrdersForNotification(draft(`owner-order:${ownerId}:${orderA}`), [orderA]);
    assert.equal(second.kind, "already-sent", "the same trigger twice must claim nothing");
    assert.equal(
      await prisma.adminNotification.count({ where: { recipientUserId: ownerId } }),
      1,
      "and must leave exactly one notification",
    );
    ok("P6-06", "the same order claimed twice produces one notification");

    // A genuinely concurrent race, with two different trigger orders, which is how the instant
    // path and the catch-up stage actually collide: both see both orders.
    const orderB = await place();
    const orderC = await place();
    const [raceB, raceC] = await Promise.all([
      claimOrdersForNotification(draft(`owner-order:${ownerId}:${orderB}`), [orderB, orderC]),
      claimOrdersForNotification(draft(`owner-order:${ownerId}:${orderC}`), [orderB, orderC]),
    ]);
    const claimedKinds = [raceB.kind, raceC.kind].sort();
    assert.deepEqual(
      claimedKinds,
      ["already-sent", "claimed"],
      `exactly one sender may win, got ${claimedKinds}`,
    );
    const winner = raceB.kind === "claimed" ? raceB : raceC;
    assert.equal(winner.kind, "claimed");
    if (winner.kind !== "claimed") throw new Error("unreachable: one sender must have won");
    assert.deepEqual(
      [...winner.orderIds].sort(),
      [orderB, orderC].sort(),
      "and the winner must carry both orders, so neither is announced later",
    );
    assert.equal(
      await prisma.adminNotificationOrder.count({ where: { recipientUserId: ownerId } }),
      3,
      "three orders, three claims, no duplicates",
    );
    ok("P6-07", "two concurrent senders for two orders produce one notification covering both");

    // The count is known only after the claim, so the body is written second (D53).
    await finalizeBody(winner.notificationId, {
      title: "New orders",
      body: "You have 2 new orders.",
    });
    const finalized = await notificationWithDeliveries(winner.notificationId);
    assert.equal(finalized?.body, "You have 2 new orders.");
    assert.equal(finalized?.orders.length, 2);
    ok("D53", "the body is written once the claim says how many orders it covers");

    const announced = await announcedOrderIds(ownerId, [orderA, orderB, orderC]);
    assert.equal(announced.size, 3, "the catch-up stage must see all three as announced");

    // ---------------------------------------------------------------------------------------
    // P6-09 and P6-08: one delivery per device, and a lease that survives a crash.
    // ---------------------------------------------------------------------------------------
    const subscriptions = await withBypass((db) =>
      Promise.all(
        ["phone", "laptop", "tablet"].map((label, i) =>
          db.pushSubscription.create({
            data: {
              userId: ownerId,
              tenantId: T,
              audience: "OWNER",
              endpointCiphertext: `cipher-${run}-${i}`,
              endpointHash: `hash-${run}-${i}`,
              p256dhCiphertext: "k",
              authCiphertext: "a",
              deviceLabel: label,
            },
            select: { id: true },
          }),
        ),
      ),
    );
    const ids = subscriptions.map((s) => s.id);
    assert.equal(await queueDeliveries(winner.notificationId, T, ids), 3);
    // Queued again, as a retried sender would: no second row for a device already queued.
    assert.equal(await queueDeliveries(winner.notificationId, T, ids), 0);
    const queued = await notificationWithDeliveries(winner.notificationId);
    assert.equal(queued?.deliveries.length, 3, "three devices, three deliveries");
    ok("P6-09", "three registered devices get one delivery each, and a retry adds none");

    const delivery = queued!.deliveries[0];
    const [claimOne, claimTwo] = await Promise.all([
      claimDelivery(delivery.id),
      claimDelivery(delivery.id),
    ]);
    assert.deepEqual(
      [claimOne, claimTwo].sort(),
      [false, true],
      "two senders racing for one delivery: exactly one may own it",
    );
    assert.equal(await claimDelivery(delivery.id), false, "and it stays owned while the lease holds");

    // The sender "crashes": the lease expires and the delivery becomes claimable again, with its
    // attempt count carried forward so a permanently failing device can be given up on.
    const expired = new Date(Date.now() + LEASE_MS + 1_000);
    assert.equal(
      await claimDelivery(delivery.id, expired),
      true,
      "an expired lease must be reclaimable, or a crash loses the notification for good",
    );
    const afterRecovery = await prisma.adminNotificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      select: { attempts: true, state: true },
    });
    assert.equal(afterRecovery.attempts, 2, "each claim counts as an attempt");
    assert.equal(afterRecovery.state, "SENDING");
    ok("P6-08", "one sender owns a delivery; a crashed sender's lease is reclaimed, not duplicated");

    await recordDeliveryOutcome(delivery.id, { state: "SENT" });
    assert.equal(await claimDelivery(delivery.id), false, "a sent delivery is never re-sent");
    await recordDeliveryOutcome(ids[1] ? queued!.deliveries[1].id : delivery.id, {
      state: "EXPIRED",
      errorCategory: "gone",
    });
    const gone = await prisma.adminNotificationDelivery.findUniqueOrThrow({
      where: { id: queued!.deliveries[1].id },
      select: { state: true, errorCategory: true, leaseExpiresAt: true },
    });
    assert.equal(gone.state, "EXPIRED");
    assert.equal(gone.errorCategory, "gone");
    assert.equal(gone.leaseExpiresAt, null, "a finished delivery holds no lease");
    ok("D52", "a sent delivery cannot be claimed again, and a dead endpoint is recorded as gone");

    // ---------------------------------------------------------------------------------------
    // D60, against the database: the writer refuses, whatever the caller believes.
    // ---------------------------------------------------------------------------------------
    await assert.rejects(
      claimOrdersForNotification(
        { ...draft(`staff:${run}`), recipientRole: "STAFF", type: "WEEKLY_SUMMARY" },
        [orderA],
      ),
      NotificationRefused,
      "a staff recipient must not be sent an analytics notification",
    );
    await assert.rejects(
      claimOrdersForNotification(
        { ...draft(`audience:${run}`), audience: "PLATFORM" },
        [orderA],
      ),
      NotificationRefused,
      "an owner type addressed to the platform audience must be refused",
    );
    assert.equal(
      await prisma.adminNotification.count({ where: { dedupeKey: { contains: run } } }),
      0,
      "a refused notification must leave no row at all",
    );
    ok("D60", "the writer refuses a type the recipient's role may not receive, before any row exists");

    // ---------------------------------------------------------------------------------------
    // P6-20: one store's notifications are invisible to another, at the database level.
    // ---------------------------------------------------------------------------------------
    const seen = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "AdminNotification" WHERE "tenantId" = $1`,
      T,
    );
    assert.ok(Number(seen[0].n) >= 1, "the rows exist for the superuser this script runs as");
    // The policy itself is proven in verify:isolation, which runs as the restricted role; what
    // is checked here is that the tables carry the column that policy needs.
    for (const table of [
      "PushSubscription",
      "AdminNotification",
      "AdminNotificationOrder",
      "AdminNotificationDelivery",
      "NotificationAlertState",
    ]) {
      const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'tenantId'`,
        table,
      );
      assert.equal(columns.length, 1, `${table} must carry a tenantId for its policy`);
      const policies = await prisma.$queryRawUnsafe<{ policyname: string }[]>(
        `SELECT policyname FROM pg_policies WHERE tablename = $1`,
        table,
      );
      assert.ok(policies.length >= 1, `${table} must have a row-level policy`);
    }
    ok("P6-20", "all 5 notification tables carry a tenantId and a policy (enforced in isolation)");
  } finally {
    await prisma.adminNotification.deleteMany({ where: { recipientUserId: ownerId } });
    for (const s of [store, other]) {
      await prisma.tenant.delete({ where: { id: s.tenant.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: s.user.id } }).catch(() => {});
    }
  }
}

main()
  .then(() => console.log(`\nAll ${checks} notification-ledger checks passed.`))
  .catch((error) => {
    console.error(`\nFAILED: ${error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
