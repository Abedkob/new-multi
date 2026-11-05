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
import { adminManifest, platformManifest } from "../lib/push/manifest";
import {
  ensureOwnerPreferences,
  saveOwnerPreferences,
  wantsNotification,
} from "../lib/data/notification-preferences";
import {
  PushEndpointRefused,
  listDevices,
  registerDevice,
  revokeDevice,
} from "../lib/data/push-subscriptions";
import { ALLOWED_PUSH_HOSTS, checkPushEndpoint } from "../lib/push/endpoint";
import { announceNewOrder, BATCH_WINDOW_MS } from "../lib/notifications/new-order";
import { newOrderText } from "../lib/notifications/templates";
import { saveOwnerPreferences as setPreferences } from "../lib/data/notification-preferences";
import { createServer, type Socket } from "node:net";
import { createECDH, randomBytes } from "node:crypto";

/**
 * Where this suite's fixture devices "live".
 *
 * A closed local port, not a real push service. The first version used
 * `https://fcm.googleapis.com/fcm/send/<made-up token>`, which the allowlist accepts — and which
 * meant every delivery check made a real HTTPS request to Google with a token that could not
 * exist. Slow, dependent on the network, and sending this platform's traffic somewhere it has no
 * business going. Port 1 refuses immediately, so a delivery fails in microseconds and is
 * recorded as unreachable, which is exactly the state under test.
 *
 * Allowed only because PUSH_TEST_ENDPOINT_HOST is set and this is not production
 * (lib/push/endpoint.ts).
 */
process.env.PUSH_TEST_ENDPOINT_HOST = "127.0.0.1:1";
const fixtureEndpoint = (name: string) => `https://127.0.0.1:1/push/${name}`;

/**
 * Real subscription keys for the fixture devices.
 *
 * Not "p" and "a", which is what they were at first: web-push rejects a malformed `p256dh`
 * during payload encryption, so every delivery failed before touching the network and was
 * recorded as an "unknown" error. The checks still passed — the deliveries did fail — but they
 * were proving the wrong failure. With a real pair, a send gets as far as the socket and comes
 * back ECONNREFUSED, which is the state the classification is actually about.
 */
const fixtureKeys = (() => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
})();

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
    // https, because web-push speaks TLS to an endpoint whatever the URL says, and the host is
    // allowed only because PUSH_TEST_ENDPOINT_HOST is set and this is not production (see
    // lib/push/endpoint.ts). The allowlist refusing this by default is the point of it.
    // Added to the list rather than replacing it: the fixture devices above still need theirs.
    process.env.PUSH_TEST_ENDPOINT_HOST = `127.0.0.1:1,127.0.0.1:${port}`;
    const target = {
      endpoint: `https://127.0.0.1:${port}/push`,
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

/**
 * D57: the service worker caches nothing, and the two identities are separate.
 *
 * Checked on the source, because this is a rule about what the file may CONTAIN. A behavioural
 * check would need a browser, and by the time a stale order list is being served to a merchant
 * the damage is a wrong decision rather than a failing test.
 */
function serviceWorkerChecks() {
  const sw = readFileSync("public/sw.js", "utf8");
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["caches", "CacheStorage", "cache.put", "cache.match"]) {
    assert.ok(
      !code.includes(forbidden),
      `the service worker uses ${forbidden}: authenticated data must not be cached on a device`,
    );
  }
  assert.ok(
    !/addEventListener\(\s*["']fetch["']/.test(code),
    "the service worker must have no fetch handler, or it will serve a stale order list",
  );
  for (const required of ["push", "notificationclick"]) {
    assert.ok(
      new RegExp(`addEventListener\\(\\s*["']${required}["']`).test(code),
      `the service worker must handle ${required}`,
    );
  }
  // The device's half of deduplication (D52): the tag replaces, and a seen tag is discarded.
  assert.ok(code.includes("seen"), "it must keep a small seen-tag store");
  assert.ok(/tag/.test(code), "and set a tag on every notification it shows");
  ok("P6-08", "the service worker handles push and clicks, caches nothing, and discards a repeat");

  // Two identities, each linked only from its own subtree (§11.1).
  const admin = adminManifest();
  const platform = platformManifest();
  assert.equal(admin.start_url, "/admin");
  assert.equal(platform.start_url, "/platform");
  assert.notEqual(admin.id, platform.id, "two apps, two ids, two Home Screen icons");
  assert.equal(admin.scope, "/admin", "scoped so a notification tap opens the installed app");
  const adminLayout = readFileSync("app/admin/layout.tsx", "utf8");
  const rootLayout = readFileSync("app/layout.tsx", "utf8");
  assert.ok(
    adminLayout.includes("/admin/manifest.webmanifest"),
    "the admin manifest must be linked from the admin subtree",
  );
  assert.ok(
    !rootLayout.includes("manifest"),
    "and NOT from the root layout, which would offer a shop's customers the admin app",
  );
  ok("P6-18", "two installable identities, each linked only from its own subtree");
}

/**
 * P6-17: permission is asked for in a click handler and nowhere else.
 *
 * Static, and it has to be. A browser asked without a user gesture either refuses or — worse —
 * burns the one chance the site gets, after which the owner must dig through browser settings to
 * undo it. There is no way to observe that from the server, and by the time anyone notices, the
 * permission is already denied for every future visit.
 */
function permissionChecks() {
  const status = readFileSync("app/admin/(panel)/notifications/push-status.tsx", "utf8");
  const code = status.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("requestPermission"), "the screen must be able to ask");
  // The one call must sit inside the click handler, not in an effect or at module scope.
  const asks = [...code.matchAll(/requestPermission/g)].length;
  assert.equal(asks, 1, `permission must be requested exactly once in the source, found ${asks}`);
  const enableBody = /const enable = async \(\) => \{[\s\S]*?\n  \};/.exec(code)?.[0] ?? "";
  assert.ok(
    enableBody.includes("requestPermission"),
    "the request must be inside the enable click handler",
  );
  assert.ok(
    !/useEffect\([\s\S]*?requestPermission/.test(code),
    "no effect may ask for permission",
  );
  // And the state it displays is READ from the browser rather than copied into React state,
  // so a permission revoked in browser settings does not leave this screen lying.
  assert.ok(
    code.includes("useSyncExternalStore"),
    "install and permission state must be read from the browser, not cached in state",
  );
  ok("P6-17", "permission is requested once, from a click handler, and never from an effect");

  // P6-18: the iPhone steps exist in both languages and name the three things that matter.
  const en = readFileSync("lib/i18n/dictionaries/en.ts", "utf8");
  const ar = readFileSync("lib/i18n/dictionaries/ar.ts", "utf8");
  for (const key of [
    "notifications.iphone.heading",
    "notifications.iphone.step1",
    "notifications.iphone.step2",
    "notifications.iphone.step3",
    "notifications.iphone.step4",
    "notifications.iphone.step5",
  ]) {
    assert.ok(en.includes(`"${key}"`), `${key} missing from en.ts`);
    assert.ok(ar.includes(`"${key}"`), `${key} missing from ar.ts`);
  }
  assert.ok(/Safari/.test(en) && /Share/.test(en) && /Add to Home Screen/.test(en));
  ok("P6-18", "the iPhone steps name Safari, Share and Add to Home Screen, in both languages");
}

/** P6-14 to P6-16: preferences belong to the person, devices do not carry them. */
async function preferenceChecks(userId: string, tenantId: string) {
  const defaults = await ensureOwnerPreferences(userId);
  for (const [field, value] of Object.entries(defaults)) {
    if (field === "showOrderAmount") {
      assert.equal(value, false, "the order amount is the one preference that starts off (D50)");
    } else {
      assert.equal(value, true, `${field} must default on`);
    }
  }
  ok("P6-14", "six notification types default on; the order amount defaults off");

  // A disabled type is never sent, and the role gate still applies on top of the preference.
  await saveOwnerPreferences(userId, { ...defaults, trafficAlerts: false });
  assert.equal(await wantsNotification(userId, "STORE_OWNER", "NEW_ORDER"), true);
  assert.equal(await wantsNotification(userId, "STORE_OWNER", "TRAFFIC_ALERT"), false);
  assert.equal(
    await wantsNotification(userId, "STAFF", "WEEKLY_SUMMARY"),
    false,
    "a role that may not receive a type is refused even with the preference on (D60)",
  );
  assert.equal(
    await wantsNotification(userId, "STORE_OWNER", "INACTIVE_STORE"),
    false,
    "and an owner is not a platform admin",
  );
  ok("P6-14", "a switched-off type is refused, and the role gate applies on top of it");

  // A new device inherits the preferences; removing one changes nothing else.
  const device = async (n: number) =>
    registerDevice({
      userId,
      tenantId,
      audience: "OWNER",
      endpoint: fixtureEndpoint(`dev-${n}-${Date.now()}`),
      ...fixtureKeys,
      deviceLabel: `Device ${n}`,
      deviceClass: "Chrome/Android",
    });
  const first = await device(1);
  const second = await device(2);
  const afterAdding = await ensureOwnerPreferences(userId);
  assert.equal(afterAdding.trafficAlerts, false, "a new device must not reset a preference");
  assert.equal((await listDevices(userId, "OWNER")).length, 2);
  ok("P6-15", "a new device inherits the preferences, including the ones switched off");

  assert.equal(await revokeDevice(userId, first.id), true);
  const remaining = await listDevices(userId, "OWNER");
  assert.equal(remaining.length, 1, "removing one device removes one device");
  assert.equal(remaining[0].id, second.id);
  const afterRemoving = await ensureOwnerPreferences(userId);
  assert.deepEqual(afterRemoving, afterAdding, "and changes no preference");
  assert.equal(await revokeDevice(userId, first.id), false, "removing it twice is not an error");
  // And not somebody else's device, however the id was obtained.
  assert.equal(
    await revokeDevice("someone-else", second.id),
    false,
    "a device can only be removed by the person it belongs to",
  );
  assert.equal((await listDevices(userId, "OWNER")).length, 1);
  ok("P6-16", "removing a device leaves the others and every preference untouched");

  // Re-registering the same endpoint updates the row rather than listing the phone twice, and
  // brings a device the push service had given up on back to life.
  const endpoint = fixtureEndpoint(`stable-${userId}`);
  const again = await registerDevice({
    userId,
    tenantId,
    audience: "OWNER",
    endpoint,
    ...fixtureKeys,
    deviceLabel: "Chrome on Android",
    deviceClass: "Chrome/Android",
  });
  const repeat = await registerDevice({
    userId,
    tenantId,
    audience: "OWNER",
    endpoint,
    ...fixtureKeys,
    deviceLabel: "Chrome on Android",
    deviceClass: "Chrome/Android",
  });
  assert.equal(repeat.id, again.id, "one endpoint is one device, however many times it subscribes");
  ok("D56", "re-subscribing refreshes the device's keys instead of listing the phone twice");
}

/**
 * The endpoint allowlist, at both layers (found by the security review of commit 4).
 *
 * The endpoint arrives from a browser and the server later POSTs to it, so an unchecked value is
 * a request this platform can be made to send anywhere inside its own network. Blind — the body
 * is encrypted and the response never reaches the caller — which makes it quiet, not harmless.
 */
function endpointChecks() {
  // The shapes a crafted registration would actually use.
  const refused = [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:6379/",
    "https://127.0.0.1:6379/",
    "http://[::1]:8080/push",
    "https://fcm.googleapis.com.attacker.test/send/x",
    "https://attacker.test/fcm.googleapis.com",
    "https://user:pass@fcm.googleapis.com/send/x",
    "https://localhost/push",
    "https://10.0.0.5/push",
    "not-a-url",
    "",
  ];
  for (const endpoint of refused) {
    const verdict = checkPushEndpoint(endpoint);
    assert.equal(verdict.ok, false, `${endpoint || "(empty)"} must be refused`);
  }

  // And the real services, including Apple's per-region hosts and a trailing-dot FQDN.
  // The concession for this suite's own fake push service is non-production only: with
  // NODE_ENV=production the same host is refused, which is what keeps it from being a hole.
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.PUSH_TEST_ENDPOINT_HOST = "127.0.0.1:9";
  assert.equal(checkPushEndpoint("https://127.0.0.1:9/push").ok, true, "allowed outside production");
  assert.equal(
    checkPushEndpoint("https://127.0.0.1:6379/push").ok,
    false,
    "and only that port: naming the host alone would open every port on it",
  );
  // Cast because NODE_ENV is typed read-only; it is a plain writable env var at runtime, and
  // defineProperty is what process.env refuses.
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.NODE_ENV = "production";
  assert.equal(
    checkPushEndpoint("https://127.0.0.1:9/push").ok,
    false,
    "and refused in production, however the environment is set",
  );
  mutableEnv.NODE_ENV = previousNodeEnv;
  // Restored, not deleted: the fixture devices registered above live on 127.0.0.1:1.
  process.env.PUSH_TEST_ENDPOINT_HOST = "127.0.0.1:1";

  const accepted = [
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/Q2F0cw",
    "https://api.push.apple.com/3/device/abc",
    "https://db5p.notify.windows.com/w/?token=abc",
    "https://fcm.googleapis.com./fcm/send/abc123",
  ];
  for (const endpoint of accepted) {
    assert.equal(checkPushEndpoint(endpoint).ok, true, `${endpoint} must be accepted`);
  }
  ok(
    "SSRF",
    `${refused.length} crafted endpoints refused, ${accepted.length} real ones accepted from ${ALLOWED_PUSH_HOSTS.length} allowed hosts`,
  );
}

/** The same rule, where it bites: registration refuses, and the sender refuses again. */
async function endpointEnforcementChecks(userId: string, tenantId: string) {
  await assert.rejects(
    registerDevice({
      userId,
      tenantId,
      audience: "OWNER",
      endpoint: "http://169.254.169.254/latest/meta-data/",
      p256dh: "p",
      auth: "a",
      deviceLabel: "crafted",
      deviceClass: "x",
    }),
    PushEndpointRefused,
    "registering an internal address as a device must be refused",
  );
  assert.equal(
    (await listDevices(userId, "OWNER")).some((d) => d.deviceLabel === "crafted"),
    false,
    "and must leave no row behind",
  );

  // Defence in depth: a row written before the rule existed still cannot make the sender open a
  // socket to it. EXPIRED rather than FAILED, because nothing will ever make it acceptable.
  const verdict = await sendPush(
    { endpoint: "http://127.0.0.1:6379/", p256dh: "p", auth: "a" },
    buildNewOrderPayload({
      facts: { count: 1, totalCents: null },
      text: { title: "t", body: "b" },
      recipientUserId: userId,
      triggerOrderId: "o",
      locale: "en",
    }),
    300,
  );
  assert.equal(verdict.state, "EXPIRED", "the sender must refuse the endpoint, not retry it");
  ok("SSRF", "registration and the sender each refuse an endpoint that is not a push service");
}

/**
 * P6-03: no push call can happen inside the order transaction.
 *
 * Static, over the checkout path. The failure it guards against is not a wrong notification: it
 * is a database connection held open across a network round trip to a push service, inside the
 * transaction that deducts stock. A slow push service would then slow down checkout for every
 * shopper, and a hanging one would hold a connection until the pool ran out.
 */
function checkoutCouplingChecks() {
  const checkout = readFileSync("app/store/[slug]/checkout/actions.ts", "utf8");
  const code = checkout.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("after(() => announceNewOrderSafely"), "the notify call must be in after()");
  // It must come after placeOrder returned, not before it and not inside it.
  const placeAt = code.indexOf("await placeOrder(");
  // The CALL, not the import at the top of the file — which is what this matched on its first
  // run, making the assertion pass for the wrong reason in the other direction.
  const notifyAt = code.indexOf("after(() => announceNewOrderSafely");
  assert.ok(placeAt > 0 && notifyAt > placeAt, "the notification must be scheduled after the commit");
  for (const needle of ["sendPush", "@/lib/push/send"]) {
    assert.ok(!code.includes(needle), `the checkout path must not reach the sender (${needle})`);
  }
  // And the order module itself — the transaction — must know nothing about notifications.
  const orders = readFileSync("lib/data/orders.ts", "utf8");
  for (const needle of ["@/lib/push/", "@/lib/notifications/", "announceNewOrder"]) {
    assert.ok(
      !orders.includes(needle),
      `lib/data/orders.ts reaches for ${needle}: nothing in the order transaction may push`,
    );
  }
  ok("P6-03", "the notification is scheduled in after(), after the commit, and never from the transaction");
}

/**
 * The instant path, end to end, against the database (P6-02, P6-05, P6-07, D50, D53).
 *
 * `waitMs: 0` where the batching window is not what is under test, so the suite does not spend
 * four seconds per case proving something else.
 */
async function instantPathChecks(tenantId: string, ownerId: string, place: () => Promise<string>) {
  // A device to send to, and the amount setting off (its default).
  await registerDevice({
    userId: ownerId,
    tenantId,
    audience: "OWNER",
    endpoint: fixtureEndpoint(`instant-${Date.now()}`),
    ...fixtureKeys,
    deviceLabel: "Instant device",
    deviceClass: "Chrome/Android",
  });

  const orderA = await place();
  const first = await announceNewOrder(tenantId, orderA, { waitMs: 0 });
  assert.equal(first.kind, "sent", `expected a notification, got ${JSON.stringify(first)}`);
  if (first.kind !== "sent") throw new Error("unreachable");
  assert.equal(first.orders, 1);
  assert.ok(first.devices >= 1, "it must queue a delivery per device");

  const stored = await notificationWithDeliveries(first.notificationId);
  assert.ok(stored, "the notification must be in the ledger");
  // The fixture's push service is a closed port, so every delivery must be recorded as
  // unreachable — not "unknown". An unknown here means the send failed before the socket, which
  // is what happened while the fixture keys were placeholders.
  for (const delivery of stored.deliveries) {
    assert.equal(delivery.state, "FAILED", "a closed port is a failed delivery");
    assert.equal(
      delivery.errorCategory,
      "unreachable",
      `expected an unreachable delivery, got ${delivery.errorCategory}`,
    );
  }
  // D50, on a real body read back out of the ledger: the fixture's customer data must not be
  // anywhere in what was sent, and with the amount off neither must any money.
  const sent = `${stored.title}\n${stored.body}`;
  for (const value of [customer.customerName, customer.customerPhone, customer.customerAddress]) {
    assert.ok(!sent.includes(value), `the body contains customer data: ${value}`);
  }
  assert.ok(!/[$]\d/.test(sent), `with the amount off no money may appear, got "${sent}"`);
  assert.equal(sent.includes("You have a new order"), true);
  ok("P6-05", "an order produces one notification, queued to every device, with no customer data");

  // Running it again for the same order says nothing new (P6-06 from the instant side).
  const again = await announceNewOrder(tenantId, orderA, { waitMs: 0 });
  assert.equal(again.kind, "nothing", "the same order must not be announced twice");

  // D50 with the toggle ON: the amount appears, and only then.
  const prefs = await ensureOwnerPreferences(ownerId);
  await setPreferences(ownerId, { ...prefs, showOrderAmount: true });
  const orderB = await place();
  const withAmount = await announceNewOrder(tenantId, orderB, { waitMs: 0 });
  assert.equal(withAmount.kind, "sent");
  if (withAmount.kind !== "sent") throw new Error("unreachable");
  const amountBody = await notificationWithDeliveries(withAmount.notificationId);
  assert.ok(/[$]\d/.test(amountBody?.body ?? ""), "with the toggle on the amount must appear");
  for (const value of [customer.customerName, customer.customerPhone]) {
    assert.ok(!(amountBody?.body ?? "").includes(value), "and still no customer data");
  }
  await setPreferences(ownerId, { ...prefs, showOrderAmount: false });
  ok("D50", "the amount appears only with the toggle on; customer data never, either way");

  // P6-07, with the real window: two orders a moment apart become one notification. The second
  // call finds the lock held and defers, and the first claims both.
  const orderC = await place();
  const batched = announceNewOrder(tenantId, orderC, { waitMs: BATCH_WINDOW_MS });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const orderD = await place();
  const second = await announceNewOrder(tenantId, orderD, { waitMs: BATCH_WINDOW_MS });
  const firstResult = await batched;
  assert.equal(second.kind, "deferred", "the second callback must find the owner's lock held");
  assert.equal(firstResult.kind, "sent");
  if (firstResult.kind !== "sent") throw new Error("unreachable");
  assert.equal(firstResult.orders, 2, "and the first must claim both orders");
  const batchBody = await notificationWithDeliveries(firstResult.notificationId);
  assert.equal(batchBody?.body, newOrderText("en", { count: 2, totalCents: null }).body);
  ok("P6-07", "two orders 150ms apart become one notification saying 2, from one lock holder");

  // P6-02: an order that was cancelled is not news, and an id that never committed is nothing.
  const orderE = await place();
  await prisma.order.update({ where: { id: orderE }, data: { status: "CANCELLED" } });
  const cancelled = await announceNewOrder(tenantId, orderE, { waitMs: 0 });
  assert.equal(cancelled.kind, "nothing", "a cancelled order must not be announced");
  const ghost = await announceNewOrder(tenantId, `never-committed-${Date.now()}`, { waitMs: 0 });
  assert.equal(ghost.kind, "nothing", "an order that does not exist must produce nothing");
  ok("P6-02", "a cancelled order and an order that never existed each produce no notification");

  // P6-14 from the sending side: switched off means nothing is written at all.
  await setPreferences(ownerId, { ...prefs, newOrders: false, showOrderAmount: false });
  const orderF = await place();
  const refused = await announceNewOrder(tenantId, orderF, { waitMs: 0 });
  assert.equal(refused.kind, "nothing");
  assert.equal(
    (await announcedOrderIds(ownerId, [orderF])).size,
    0,
    "a switched-off type must leave no ledger row, not an unsent one",
  );
  await setPreferences(ownerId, { ...prefs, newOrders: true, showOrderAmount: false });
  ok("P6-14", "with new orders switched off, nothing is claimed and nothing is written");
}

async function main() {
  matrixChecks();
  serviceWorkerChecks();
  permissionChecks();
  endpointChecks();
  checkoutCouplingChecks();
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

    await preferenceChecks(ownerId, T);
    await endpointEnforcementChecks(ownerId, T);

    await instantPathChecks(T, ownerId, place);

    // ---------------------------------------------------------------------------------------
    // D52: one order, one notification, however many senders try.
    // ---------------------------------------------------------------------------------------
    const orderA = await place();
    const first = await claimOrdersForNotification(draft(`owner-order:${ownerId}:${orderA}`), [orderA]);
    assert.equal(first.kind, "claimed");
    const second = await claimOrdersForNotification(draft(`owner-order:${ownerId}:${orderA}`), [orderA]);
    assert.equal(second.kind, "already-sent", "the same trigger twice must claim nothing");
    // Counted by THIS order's dedupe key, not over the owner's whole trail: the instant-path
    // checks above have already written notifications for this same owner, and a bare count
    // made this assertion depend on what ran before it.
    assert.equal(
      await prisma.adminNotification.count({
        where: { dedupeKey: `owner-order:${ownerId}:${orderA}` },
      }),
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
      await prisma.adminNotificationOrder.count({
        where: { recipientUserId: ownerId, orderId: { in: [orderA, orderB, orderC] } },
      }),
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
