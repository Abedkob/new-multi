# Phase 6 — Admin PWA, Web Push, and notification control

Plan for [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md) §13's
Phase 6, drawing on §11 (PWA and push), §9.4–§9.8 (the notification data model) and §10 (the
scheduled command this phase adds stages to).

**Not a release.** §13 holds the launch until Phase 7. `ANALYTICS_ROLLOUT_MODE` stays `off`, and
nothing in this phase changes that: a store outside the rollout produces no analytics alerts, but
it still takes orders, so **new-order push works with the rollout off** and is the one
notification that does.

The risk changes shape again. Phase 5 could mislead someone who went looking for a number. This
phase reaches into a merchant's pocket while they are doing something else, at 3am, possibly with
a customer's data in the payload, and it attaches that machinery to the checkout transaction —
the one code path in this product where a mistake costs a real order. Three failures are worth
more care than everything else in this phase combined:

1. **A push failure that takes a checkout with it.** The shopper loses their order because the
   merchant's phone could not be reached.
2. **Customer data in a notification body.** A push payload sits on Apple's and Google's
   infrastructure and on a lock screen; "Order from +961 3 123 456, 2 × Linen Shirt to Hamra
   street" is a disclosure to anyone who can see that screen, and it is not needed to say "you
   have a new order".
3. **A notification that cries wolf.** Phase 5 withheld a verdict below its sample floor on a
   screen the owner chose to open. An alert the owner did not ask for, drawn from nine sessions,
   is the same error delivered to their lock screen — and the cost is that the next one gets
   dismissed too.

## 0. Progress

| Commit | Content | State |
|---|---|---|
| — | Plan approved with four changes, folded in: the order amount is an owner toggle, off by default (D50); non-owner accounts may receive new orders only (D60); the contract-rejection 400 signal joins the platform alerts (P6-25); and real-device delivery is a named human check (P6-32, P6-33). | done |
| 1 | **The notification data model and the ledger.** Five tables under forced RLS (P4-23a now counts 25), `User.adminLocale`, `lib/notifications/types.ts` (the role→type gate, D60) and `lib/data/notifications.ts` (claim, lease, outcome). `verify:notifications` is 10 checks that actually race: two senders for one order, two for one delivery, and a crashed sender’s lease reclaimed. `verify:isolation` is 17. | done |
| 2 | **`lib/push/*`**: `keys.ts` (configured or not), `crypto.ts` (endpoint encrypted at rest plus a keyed lookup hash), `payload.ts` (D50 — the builder takes a count and an optional total, never an order) and `send.ts` (one attempt, hard timeout, never throws, permanent vs transient classified). `web-push` added. `verify:notifications` is 14, and three of the new checks were wrong before they were right. | done |
| 3 | **The service worker and the two manifests** (D57). Brought forward ahead of the subscription screen, because `PushManager.subscribe` needs a registered worker — an Enable button built first would have had nothing to register. `public/sw.js` handles `push` and `notificationclick` and declares no fetch handler and no cache; two manifest routes give two installable identities, each linked only from its own subtree so a shop’s customers are never offered the admin app. `verify:notifications` is 16. | done |
| 4 | **Subscriptions, preferences and device management.** `lib/data/push-subscriptions.ts` (upsert on the endpoint hash, revoke rather than delete), `lib/data/notification-preferences.ts` (defaults from the schema, so there is no second list to disagree), and `/admin/notifications` with its three sections, the amount toggle under its own warning, and the iPhone steps. Permission is asked once, from a click. `verify:notifications` 23, `verify:permissions` 21. | done |
| 5 | **Instant new-order push** (D51, D52, D53). `lib/notifications/new-order.ts` is one function for both paths: an owner-scoped `pg_try_advisory_xact_lock`, a ~4s window inside `after()`, claim, then the body. Checkout schedules it with `after()` after the commit and never reaches the sender itself. `verify:notifications` is 31. | done |
| 6 | **Catch-up, lease recovery and cleanup** as stages of `pnpm analytics:scheduled`. Driven from the orders rather than a queue, so there is no second list to fall out of step; the lease is what makes recovery safe to run beside a live sender; all three honour `dryRun` (D35). `verify:notifications` is 35. | done |
| 7 | **Persisted admin language and the templates** (D58). The language switch now writes `User.adminLocale` as well as the cookie, because the reader with no cookie is the 09:00 Monday job. Templates are plain functions of a locale, Arabic in Arabic sentences with Arabic-Indic digits, and the payload carries `lang`/`dir`. `verify:notifications` is 38. | done |
| 8 | Owner weekly summary and important alerts, reading insights.ts. | next |
| 2–10 | §5's sequence below. | not started |

## 1. Scope

### In scope

1. **Two installable admin identities** (§11.1): merchant at `/admin`, platform at `/platform`,
   one service worker, no offline caching of authenticated content.
2. **Push subscriptions and device management** (§9.6, §11.2): per-user, per-device, with an
   audience that cannot cross.
3. **Persisted admin language** (§9.5): `User.adminLocale`, so a scheduled notification can be
   written in the language the owner actually reads.
4. **Typed notification preferences** (§9.7) for owners and platform admins, all defaulting on — plus *Show order amount in notifications*, the one preference that defaults **off** (**D50**), and the role gate that keeps analytics alerts away from non-owner accounts (**D60**).
5. **Instant new-order push** (§11.4) through `after()`, after commit, with a hard timeout.
6. **The notification ledger** (§9.8): `AdminNotification`, `AdminNotificationOrder`,
   `AdminNotificationDelivery`, `NotificationAlertState`.
7. **Deduplication, batching and retry** (§11.5, §11.6): one visible copy per device,
   "3 new orders" inside a short window, leases so two senders cannot own one delivery.
8. **Owner weekly summary and important alerts** (§11.7, §11.8), built on Phase 5's
   `insights.ts` and its thresholds — not on new ones.
9. **Platform alerts and weekly summary** (§11.10, §11.11), built on Phase 4's `healthEvaluate`
   stage, which already decides what is wrong and currently only writes it to a log line.
10. **Scheduled stages** for catch-up, lease recovery, summaries, alert evaluation and expired
    subscription cleanup, inside the existing `pnpm analytics:scheduled` runner.
11. **iPhone guidance** (§11.2), because on iOS Web Push only exists for an installed app and an
    owner who taps "Enable notifications" in Safari gets nothing with no explanation.

### Explicitly NOT in this phase

- **No email or WhatsApp owner notifications.** §Decisions of the master plan: owner
  notifications are Web Push only. Adding a second channel doubles the delivery, dedupe and
  preference surface.
- **No shopper-facing push** ("back in stock", "new offer"). Different audience, different legal
  basis, different subscription. Post-launch, and not to be confused with this.
- **No offline admin.** The service worker handles push and notification clicks only. Caching
  authenticated HTML or order data on a device is a data-at-rest problem this phase will not take
  on.
- **No in-app notification inbox.** The ledger is written and read by the platform console's
  health view; a merchant-facing list of past notifications is post-launch.
- **No new analytics measurement.** Phase 6 reads Phases 4–5's aggregates and insights.
- **No alert delivery for a total outage.** An app that is down cannot push its own alarm. §11.10
  says external uptime monitoring stays responsible for that, and this plan does not pretend
  otherwise.

## 2. Decisions needed before coding

| # | Question | Decision |
|---|---|---|
| **D50** | What may a push payload contain? | **The fact, the count, and the destination. Never a person. Money only if the owner asks for it.** “You have 3 new orders” and a link to `/admin/orders`. No customer name, phone, address, note or product list (§11.6) — those are not a preference, they are a disclosure to whoever is holding the phone, and they are never sent. The **amount** is the one judgement call, and it is the owner's: a lock screen reading “new order — $340” tells a stranger what the shop takes in, so it is **off by default** behind one toggle, *Show order amount in notifications*, in `/admin/notifications`. Off, the body is identical to one from a store that never enabled it — no empty bracket, no hint that a number was withheld. The ledger stores the body it actually sent, so what reached a device is auditable without a second, richer copy. Checks: the payload builder cannot reach `customerName`, `customerPhone`, `address`, `notes` or an item list under any setting; and with the toggle off no money figure appears in the body or in the stored snapshot. |
| **D60** | Which notifications may a non-owner staff account receive? | **New orders only. Never an analytics alert or a summary.** A shop floor needs to know an order arrived; it does not need — and should not have — the store's traffic, conversion or search intelligence pushed to it, and an alert saying “visits fell 40%” is commercially sensitive in a way “a new order” is not. **There is no staff role in this codebase today** (`Role` is `PLATFORM_ADMIN | STORE_OWNER`, and a tenant has exactly one owner), so Phase 6 does not invent one. What it builds is the gate, enforced in data rather than in the UI: `NOTIFIABLE_TYPES` maps a role to the types it may receive, the notification writer refuses a type outside that set regardless of any preference row, and `/admin/notifications` only renders the toggles a role is allowed. The day a staff role is added it is one entry in that table and nothing else — and until then the check proves the refusal with a recipient whose role allows only `newOrders`. Introducing the role itself (invitations, per-screen permissions, session claims) is its own piece of work, outside this phase. |
| **D61** | May a device’s endpoint be any URL the browser hands over? | **No — an allowlist of the real push services.** Added after the automated security review of the registration action, and it was right: the endpoint arrives from a browser and the server later POSTs to it, so an unchecked value lets an authenticated owner aim this platform at `169.254.169.254` or `127.0.0.1:6379`. Blind — the body is encrypted and the response never reaches them — which makes it quiet rather than harmless: timing alone maps an internal network. `lib/push/endpoint.ts` requires https, no credentials in the URL, and a host that is one of the seven services browsers actually subscribe through, matched exactly or as a `.`-anchored suffix. An allowlist rather than a private-address blocklist, because the set of push services is small, public and fixed by the browsers, while a blocklist must keep up with every way of spelling an internal address. Enforced in the DATA LAYER so every caller inherits it, and again in the sender so a row written any other way still cannot open that socket (EXPIRED, not FAILED — nothing will ever make it acceptable). One concession: `PUSH_TEST_ENDPOINT_HOST`, honoured only when NODE_ENV is not production, so `verify:notifications` can point the sender at a server it controls and prove P6-01. |
| **D51** | What happens to the checkout if push fails? | **Nothing.** The push work is scheduled with `after()` **after** the transaction commits, never inside it, and the callback owns a hard ~2.5s timeout and swallows everything (§11.4). The order is already the shopper's; the notification is a convenience for the merchant. A check places an order against a push endpoint that hangs, and asserts the checkout response time is unchanged and the order is complete — and a second check asserts a rolled-back order produces no notification, because the only thing worse than a missed notification is one for an order that does not exist. |
| **D52** | Instant and catch-up both exist. How is one notification guaranteed? | **A logical notification keyed on `recipientUserId + NEW_ORDER + orderId`, and a lease on each delivery** (§11.5). The logical row is created inside a short transaction with a unique constraint, so the instant path and the catch-up stage race to insert and exactly one wins; the loser finds the row and stops. Each device's delivery is then claimed with a lease, so a retry after a crash cannot double-send. On the device, the payload's `tag` (`owner-order:<ownerId>:<orderId>`) plus a small seen-id store in the service worker collapses what the push service itself may deliver twice. Three layers, because each one fails differently: the constraint handles two senders, the lease handles a crash mid-send, the tag handles the push service. |
| **D53** | How long is the batching window, and who waits? | **~4 seconds, and nobody waits.** The first post-commit callback takes an owner-scoped lock, waits out the window, claims every unnotified recent order, and sends one notification (§11.6). A second order arriving inside the window finds the lock, sees its order will be claimed, and exits. The window is spent inside `after()`, so no response is delayed by it. Four seconds is chosen to be shorter than the time it takes a merchant to pick up a phone and long enough to collapse the burst a shared post produces. |
| **D54** | What may an owner alert be drawn from? | **Phase 5's thresholds, unchanged, and nothing weaker** (§11.8). `lib/analytics/insights.ts` already decides what qualifies, with a sample floor per rule and the evidence attached; the alert stage reads it and sends nothing a report would not have shown. Re-deriving "significant" here would mean a lock screen and a dashboard disagreeing about the same week, and the lock screen would win the argument. **New orders are exempt from any sample rule** — a confirmed order is a fact, not an inference. Cooldowns are per type **and entity** (a product, a step, a phrase), so one struggling product cannot produce a daily alert. |
| **D55** | Who gets a platform alert, and when does it repeat? | **Every platform admin with the matching preference, once on state entry, with a cooldown and a reset** (§11.10). `NotificationAlertState` holds the last state and the last send per (audience, type, entity): an inactive store alerts when it becomes inactive, not every five minutes while it stays that way, and alerts again only after activity resumes and stops again. The thresholds are §11.10's and they are **data**, like Phase 5's — one table, one line per number, so changing one is a reviewable diff rather than an edit inside a condition. |
| **D56** | Where do the push keys live, and what is encrypted? | **VAPID keys in the environment; endpoint and keys encrypted at rest** (§9.6). `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` and `PUSH_VAPID_SUBJECT` join `lib/env.ts` with the same fail-fast validation as the licence keys. A subscription's endpoint and its `p256dh`/`auth` secrets are encrypted with `lib/license/crypto.ts`'s primitives under the existing `LICENSE_ENCRYPTION_KEY`'s sibling, `PUSH_ENCRYPTION_KEY` — a leak of the table alone must not let someone push to a merchant's phone. The public key is served to the browser; the private key never leaves the server and is never logged. |
| **D57** | What does the service worker cache? | **Nothing.** It handles `push` and `notificationclick` and declares no fetch handler at all (§11.1). A fetch handler is how an admin PWA starts serving a stale order list, and a cache is how order data ends up at rest on a device the platform does not control. A check asserts the worker's source contains no `caches` API and no `fetch` listener. |
| **D58** | How is a notification localized when nobody is looking? | **Persisted `User.adminLocale`, then the store's default locale, then English** (§11.3). Today the admin language is a cookie, which does not exist when a scheduled job writes a summary at 09:00 — so the language switch now writes both. Both templates are complete, and an Arabic payload sets `lang: "ar"` and `dir: "rtl"`: a right-to-left body rendered left-to-right on a lock screen is unreadable, not merely untidy. The dictionaries make a missing Arabic string a compile error, as in Phase 5. |
| **D59** | Is the owner's title an existing screen or a new one? | **A new section, `/admin/notifications`, with three parts** (§11.2): push status, types, devices. It is not folded into Marketing or Settings because it is the only screen whose subject is the owner's own phone, and because the iPhone instructions need room to be read. Platform gets the same three parts at `/platform/notifications` from the same components with the audience switched (§11.9). |

## 3. Data model

| Table | Purpose |
|---|---|
| `PushSubscription` | **D56.** `userId`, optional `tenantId`, `audience` (OWNER/PLATFORM), encrypted `endpoint`/`p256dh`/`auth`, device label and class, `createdAt`, `lastSuccessAt`, `lastFailureAt`, `revokedAt`/`expiredAt`. Tenant-scoped rows carry `tenantId` and therefore forced RLS, like every other store-owned table (P4-23a will count it). |
| `OwnerNotificationPreference` | **§9.7, D50, D60.** One row per user: `newOrders`, `weeklySummary`, `productAlerts`, `funnelAlerts`, `searchAlerts`, `trafficAlerts`, all `@default(true)` — plus `showOrderAmount` at `@default(false)`, the only one that starts off. A row exists per user, not per tenant, so the gate in **D60** is a property of who the recipient is rather than of which store they belong to. |
| `PlatformNotificationPreference` | **§9.7.** `inactiveStoreAlerts`, `storeDeclineAlerts`, `ingestionHealthAlerts`, `aggregationHealthAlerts`, `redisFallbackAlerts`, `pushDeliveryAlerts`, `weeklyPlatformSummary`. |
| `AdminNotification` | **§9.8.** The logical notification: recipient, audience, type, the localized title/body **as sent**, destination path, `dedupeKey` (unique), `cooldownKey`, `createdAt`. |
| `AdminNotificationOrder` | **D52.** Links a notification to the orders it covered, unique on (recipient, order) so one order is never announced twice to one person. |
| `AdminNotificationDelivery` | **§9.8.** Per subscription: state (PENDING/SENDING/SENT/FAILED/EXPIRED), `attempts`, `leaseExpiresAt`, `errorCategory`, `sentAt`. |
| `NotificationAlertState` | **D55.** Last state and last send per (audience, type, entity), which is what makes "once on entry" and a cooldown possible. |
| `User.adminLocale` | **D58.** `en`, `ar` or null. |

One migration, with forced RLS on the tenant-scoped tables and the usual composite foreign keys.

## 4. New modules

| Module | Purpose |
|---|---|
| `lib/push/keys.ts` | VAPID configuration from `lib/env.ts`, and the public key the browser needs. |
| `lib/push/crypto.ts` | Encrypt/decrypt a subscription's endpoint and keys (**D56**). |
| `lib/push/send.ts` | One sender: takes a notification and a subscription, applies the ~2.5s timeout, classifies the error (permanent vs transient), returns a verdict. The only module that talks to a push service. |
| `lib/push/payload.ts` | Builds the title/body/tag/destination from a notification type and its numbers (**D50**). Pure, so what may be in a payload is checkable without a browser. |
| `lib/data/push-subscriptions.ts` | Register, list, remove, mark expired — tenant-scoped through `withTenant` where a tenant applies. |
| `lib/data/notifications.ts` | The ledger: claim a logical notification, claim a delivery lease, record the outcome. |
| `lib/notifications/new-order.ts` | **D52, D53.** The instant path and the catch-up path, sharing one claim-and-batch function so they cannot diverge. |
| `lib/notifications/owner-alerts.ts` | **D54.** Reads `insights.ts`; decides nothing itself. |
| `lib/notifications/platform-alerts.ts` | **D55.** Reads Phase 4's `healthEvaluate` findings and Phase 5's `platformConsole`. |
| `lib/notifications/templates.ts` | EN/AR templates for every type, keyed like the dictionaries (**D58**). |
| `app/sw.ts` (or `public/sw.js`) | **D57.** `push` and `notificationclick` only. |
| `app/admin/notifications/*`, `app/platform/notifications/*` | **D59.** The two sections, from shared components. |
| `app/manifest.ts`, `app/platform/manifest.ts` | **§11.1.** Two identities. |

## 5. Commit sequence

Guard rails first again, for the same reason as Phase 5: if time runs short, the honest cut is
fewer notification types, never a weaker boundary between push and checkout.

1. **The data model and the ledger**, with RLS, and `lib/data/notifications.ts`'s claim/lease
   functions proven by a concurrency check — two senders racing for one order, one row.
2. **`lib/push/*`**: keys, encryption, the sender with its timeout and error classification, and
   `payload.ts` with the check that no customer field or money figure can reach a body (**D50**).
   No UI, no subscriptions yet.
3. **Subscriptions and device management**: the data layer, `/admin/notifications`'s three
   sections, permission requested only from a user action, and the test notification.
4. **The service worker and the two manifests** (**D57**), including the iPhone guidance, and a
   check that the worker caches nothing.
5. **Instant new-order push** (**D51, D52, D53**): `after()` after commit, the owner-scoped lock,
   the batching window, and the checks that a hanging push service changes neither the order nor
   the response.
6. **Catch-up, lease recovery and expired-subscription cleanup** as scheduled stages, with the
   check that instant and catch-up together still produce exactly one notification.
7. **Persisted admin language and the EN/AR templates** (**D58**), with `lang`/`dir` on every
   payload.
8. **Owner weekly summary and important alerts** (**D54**), reading `insights.ts`, with
   per-type/entity cooldowns.
9. **Platform notifications** (**D55**): the section, the alert stage over Phase 4's findings, the
   weekly summary, and the audience separation check.
10. **Verification scripts and the acceptance record.**

## 6. Acceptance checklist

Numbered P6-xx. Admin-only surfaces are exempt from the custom-domain rule under **D47** and must
prove the refusal instead. A leg that cannot run is a failure, not a skip.

### Push must never cost an order

| # | Item |
|---|---|
| P6-01 | An order placed while the push service hangs completes, with a response time indistinguishable from one placed with push disabled (**D51**). |
| P6-02 | A transaction that rolls back produces no notification row and no delivery. |
| P6-03 | No push call happens inside the order transaction: a static check over the checkout path, plus a runtime assertion that the sender is only ever reached from `after()`. |
| P6-04 | A push failure, a timeout and a permanently-expired endpoint are each recorded and each leave the order untouched. |

### One order, one notification

| # | Item |
|---|---|
| P6-05 | An order arrives within seconds on a registered device. |
| P6-06 | The instant path and the catch-up stage, run deliberately against the same order, produce one logical notification and one delivery per device (**D52**). |
| P6-07 | Two concurrent post-commit callbacks for two orders produce one notification saying "2 new orders" (**D53**). |
| P6-08 | A retry after a crash mid-send does not double-send: the lease is respected, and the device's seen-id store discards a duplicate the push service delivers twice. |
| P6-09 | Three registered devices each receive exactly one copy. |

### What a notification may say

| # | Item |
|---|---|
| P6-10 | No payload contains a customer name, phone, address, note, product name or any money figure (**D50**) — checked on the builder and on a real sent body read back out of the ledger. |
| P6-11 | Every type has complete EN and AR templates; a missing Arabic string is a compile error. |
| P6-12 | An Arabic payload sets `lang=ar` and `dir=rtl`, and reads as Arabic sentences rather than translated fragments. |
| P6-13 | A scheduled notification uses the persisted admin language, then the store's default, then English — with the cookie absent (**D58**). |

### Preferences and devices

| # | Item |
|---|---|
| P6-14 | Every owner type defaults on; a disabled type is never sent, by either path. |
| P6-15 | A newly added device inherits the user's existing preferences. |
| P6-16 | Removing one device leaves the other devices and every preference intact. |
| P6-17 | Permission is requested only from a direct user action — a static check that no effect or page load calls `requestPermission`. |
| P6-18 | The iPhone instructions are present, in both languages, and name Safari, Share and Add to Home Screen. |

### Audiences and isolation

| # | Item |
|---|---|
| P6-19 | A merchant subscription never receives a platform notification, and the reverse — proven with both registered at once. |
| P6-20 | One store's owner never receives another store's order notification; `PushSubscription` and the ledger are under forced RLS (P4-23a counts them). |
| P6-21 | A store owner cannot reach `/platform/notifications`, and `/admin/notifications` is 404 on a store's own domain (**D47**, P5-34's rule). |
| P6-22 | An endpoint, `p256dh` and `auth` are unreadable in the database without the key (**D56**). |
| P6-34 | A device’s endpoint must be one of the real push services: registration refuses anything else, and the sender refuses it again (**D61**). The production rule holds whatever the environment says. |

### Alerts that are worth waking up for

| # | Item |
|---|---|
| P6-23 | Every owner alert fires at Phase 5's threshold for its rule and not one session below it (**D54**), and carries the same evidence sentence the report shows. |
| P6-24 | A per-type/entity cooldown suppresses the repeat and the reset re-arms it. |
| P6-25 | Platform alerts fire under simulated ingestion failure, **contract rejections (the 400 signal)**, aggregation lag over 20 minutes, an expired run lease, Redis fallback and push-delivery failure (**D55**). The contract signal has its own much lower threshold and its own alert text: a 400 is our own code sending what the endpoint refuses, so it is never load-dependent and never the shopper's fault — a single-digit count in a window is already a bug, and it must not be averaged into the operational drop percentage. Phase 3 lost every batch off localhost while the operational rate read zero throughout; that is the failure this alert exists for. |
| P6-26 | An inactive store alerts once on entry, not per run, and again only after activity resumes and stops. |
| P6-27 | A failed scheduled run surfaces on the next evaluation rather than being lost with the process. |
| P6-28 | The weekly summaries resolve 09:00 in the store's zone and the platform admin's zone respectively, across a DST boundary (**D45**'s rule, now in a schedule). |

### Checked by a person, not a script

| # | Item |
|---|---|
| P6-32 | **A real iPhone and a real Android phone each receive a new-order notification, and tapping it opens the right screen.** Done by the operator at the pilot, not automated, and the plan says so rather than pretending otherwise: Web Push on iOS exists only for a PWA added to the Home Screen, permission can only be granted by a human tap, and no headless check can prove a notification was drawn on a lock screen. Record, per device: install state, the permission prompt, delivery within seconds, the Arabic body rendered right-to-left, and where the tap landed. A failure here is a Phase 6 failure, not a pilot note. |
| P6-33 | The same two devices receive one notification for several orders placed within a few seconds, and do **not** receive a second copy of one already seen (**D52**, **D53** in the only place they can be fully observed). |

### Regression

| # | Item |
|---|---|
| P6-29 | Phases 1–5's suites all pass, `verify:e2e-policy` included. |
| P6-30 | `lint` stays at zero and `typecheck` is clean. |
| P6-31 | A checkout with no push configured at all (no VAPID keys) behaves exactly as it does today. |

## 7. Risks

- **The one with a real order attached: push work touching the checkout.** Mitigated by D51's
  shape — after commit, inside `after()`, hard timeout, everything swallowed — and by P6-01 to
  P6-04, which test it with a push service that hangs rather than one that is merely absent.
- **A duplicate at 3am, or none at all.** Three dedupe layers (D52) because they fail
  differently. The check that matters is P6-06: both paths, deliberately, against one order.
- **An alert nobody trusts by week three.** D54 refuses to invent thresholds and D55 makes the
  platform's numbers data. The failure mode is quiet — nobody reports "I stopped reading these" —
  so the mitigation has to be in the rules, not in a later tuning pass.
- **iOS.** Web Push on iPhone requires an installed PWA, and a merchant who taps Enable in Safari
  gets silence. Mitigated by instructions (P6-18) and by showing install state honestly rather
  than a toggle that appears to work.
- **A payload that leaks.** D50 keeps bodies factual and P6-10 checks the builder *and* a sent
  body. Worth stating plainly: a notification is readable by anyone holding the phone.

## 8. What "Phase 6 complete" means

Every P6 item passes and is recorded in `PHASE_6_ACCEPTANCE.md` with the suite and assertion
behind it, including an explicit list of what is not covered. `ANALYTICS_ROLLOUT_MODE` is still
`off`; new-order push is the one notification that works regardless, because an order is not an
analytics event. The nine e2e suites still owing a custom-domain leg are due in Phase 7, before
the pilot.
