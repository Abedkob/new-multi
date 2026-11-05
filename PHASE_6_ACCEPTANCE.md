# Phase 6 — Acceptance results

Results for [PHASE_6_PLAN.md](PHASE_6_PLAN.md) §6, run on 2026-11-06.

**All 32 script-provable items pass. Two items (P6-32, P6-33) are checked by a person on real
phones and are not done** — they are the operator's at the pilot, and the plan says so on
purpose.

Phase 6 is not a release. §13 of the master plan holds the launch until Phase 7, and
`ANALYTICS_ROLLOUT_MODE` stays `off`. **New-order push is the one notification that works with
the rollout off**, because an order is not an analytics event.

## Reproducing this

Push must be configured, or the suite takes its "not configured" branches and proves less. Keys
are per deployment; generate a pair and a 32-byte secret (see `.env.example`):

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

```bash
ANALYTICS_ROLLOUT_MODE=all ANALYTICS_HEALTH_FLUSH_MINUTES=0 pnpm dev --port 3200
```

No server needed:

```bash
pnpm verify:notifications && pnpm verify:isolation
```

Server needed:

```bash
BASE_URL=http://localhost:3200 pnpm verify:permissions && BASE_URL=http://localhost:3200 pnpm verify:integrations
```

## Summary of the runs

| Suite | Checks |
|---|---|
| `verify:notifications` | 48 |
| `verify:isolation` | 17 |
| `verify:permissions` | 22 |
| `verify:integrations` | 14 |
| Phases 1–5 regression | templates 96, consent 43, commerce 40, ingestion 24, reports 23, aggregates 20, commerce-analytics 18, e2e-policy 17, insights 14, campaigns 13, acquisition 12, health 11, retention 10, report-ui 9, report-states 9, search 9, social-links 9, platform-console 7, scheduled 6, coupons (all) |

## Push must never cost an order

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-01 | An order placed while the push service hangs completes, with an unchanged response time | PASS | `verify:notifications` — a bare TCP listener that accepts and never speaks stalls the TLS handshake; the sender abandons it in ~610ms with a `timeout` verdict. The checkout path never awaits it at all (P6-03) |
| P6-02 | A rolled-back order produces no notification | PASS | `verify:notifications` — a cancelled order and an order id that never committed each produce nothing |
| P6-03 | No push call inside the order transaction | PASS | `verify:notifications` — static over the checkout path: the call is `after(() => …)` placed after `await placeOrder` returned, the checkout path cannot reach the sender, and `lib/data/orders.ts` imports nothing from `lib/push/*` or `lib/notifications/*` |
| P6-04 | A failure, a timeout and a permanently-expired endpoint are each recorded, and each leaves the order untouched | PASS | `verify:notifications` — timeout, unreachable and unknown are classified; only 404/410 is final, so an unrecognised failure never deletes a merchant's device |

## One order, one notification

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-05 | An order arrives within seconds on a registered device | PASS | `verify:notifications` — one notification, one delivery per device, with the real send attempted and recorded |
| P6-06 | Instant and catch-up, both run against one order, produce one notification | PASS | `verify:notifications` — twice: the same trigger claimed twice, and the catch-up stage followed by the instant path for the same order (one claim, counted) |
| P6-07 | Two concurrent callbacks for two orders produce one "2 new orders" | PASS | `verify:notifications` — a genuine race: two concurrent claims for two orders, exactly one winner, carrying both; and two orders 150ms apart with the real 4s window, the second deferring on the owner's lock |
| P6-08 | A retry after a crash does not double-send | PASS | `verify:notifications` — two senders racing for one delivery produce one winner; an expired lease is reclaimable with its attempt count carried forward; the stage abandons after 5 attempts; and the service worker discards a tag it has already shown |
| P6-09 | Three devices each receive exactly one copy | PASS | `verify:notifications` — three deliveries, and a re-queue adds none |

## What a notification may say

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-10 | No payload contains customer data or money | PASS | `verify:notifications` — the builder's input type is asserted to carry none of 8 customer fields; a real body read back out of the ledger contains none of the fixture's name, phone or address; no money until the toggle is on; and a platform alert carries none either |
| P6-11 | Every type has complete EN and AR templates | PASS | `verify:notifications` — new orders, the weekly summary and 4 owner alerts, called in both languages. `ar.ts` is typed `Record<DictionaryKey, string>`, so a missing screen string is a compile error |
| P6-12 | An Arabic payload sets `lang=ar`/`dir=rtl` and reads as Arabic | PASS | `verify:notifications` — and Arabic-Indic digits, so "لديك ٣ طلبات" is not a Western 3 in Arabic text |
| P6-13 | A scheduled notification uses the persisted language, then the store's, then English | PASS | `verify:notifications` — all three, by clearing each in turn and reading the locale off the ledger row |

## Preferences and devices

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-14 | Every owner type defaults on; a disabled type is never sent | PASS | `verify:notifications` — six on, the order amount off; a switched-off type leaves no ledger row at all, not an unsent one |
| P6-15 | A new device inherits the user's preferences | PASS | `verify:notifications` — including the ones switched off |
| P6-16 | Removing one device leaves the others and every preference intact | PASS | `verify:notifications` — and a device can only be removed by the person it belongs to |
| P6-17 | Permission is requested only from a direct user action | PASS | `verify:notifications` — exactly one `requestPermission` in the shared component, inside the click handler, none in any effect; install and permission state are read through `useSyncExternalStore` rather than cached |
| P6-18 | The iPhone instructions are present in both languages | PASS | `verify:notifications` (the keys and the three things that matter: Safari, Share, Add to Home Screen) and `verify:permissions` (rendered on the owner's screen) |

## Audiences and isolation

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-19 | Merchant and platform notifications never cross | PASS | `verify:notifications` — both audiences registered at once; neither appears in the other's device list; the writer refuses either crossing before a row exists |
| P6-20 | One store never receives another's orders; the tables are under forced RLS | PASS | `verify:isolation` (another store can read neither the notifications nor the devices, and cannot plant a subscription on someone else's store) and `verify:aggregates` P4-23a, now counting 25 protected tables |
| P6-21 | An owner cannot reach `/platform/notifications`; `/admin/*` is 404 on a store's own domain | PASS | `verify:permissions` (the owner is redirected away) and `verify:report-states` P5-34, which already proves `/admin/*` is 404 on a store's own domain over a real socket — the notification routes are under the same prefix and the same proxy rule |
| P6-22 | Endpoint, `p256dh` and `auth` unreadable without the key | PASS | `verify:notifications` — a versioned AES-256-GCM envelope, a fresh IV each time, and an HMAC lookup hash rather than a bare digest |
| P6-34 | A device's endpoint must be a real push service (**D61**) | PASS | `verify:notifications` — 11 crafted endpoints refused (link-local, loopback, a lookalike host, credentials in the URL), 6 real ones accepted; refused at registration AND again in the sender; and the non-production test concession is refused with `NODE_ENV=production` |

## Alerts that are worth waking up for

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-23 | Every owner alert fires at Phase 5's threshold and carries its evidence | PASS | `verify:notifications` — a fixture sitting exactly on §6's line (5 no-result searches) alerts with its number and names the phrase; one search below produces nothing however often the stage runs |
| P6-24 | A per-type/entity cooldown suppresses the repeat | PASS | `verify:notifications` — one alert, then suppression reported for the same subject, still suppressed just inside the window |
| P6-25 | Platform alerts fire under every signal §11.10 names, including the 400 | PASS | `verify:notifications` — ingestion, **contract rejections**, aggregation (lag, a failed run, an expired run lease), push delivery and inactive-store findings all produced by arranging the conditions. The 400 carries its own count and does not appear in the operational drop line. **Redis fallback is reported from the state the client already tracks** — see "what is not covered" |
| P6-26 | An inactive store alerts once on entry, not per run | PASS | `verify:notifications` — the second evaluation sends nothing and reports it as already firing; resolved conditions are cleared each run, which is what re-arms them |
| P6-27 | A failed scheduled run surfaces on the next evaluation | PASS | `verify:notifications` — a `FAILED` run and one stranded with an expired lease both become findings; and the catch-up stage announces an order the instant path missed |
| P6-28 | The summaries resolve 09:00 in the right zone across a DST boundary | PASS | `verify:notifications` — the Mondays after both of Beirut's 2026 clock changes for the owner's summary, and the platform's own zone for the platform summary |

## Regression

| # | Item | Result | Evidence |
|---|---|---|---|
| P6-29 | Phases 1–5's suites all pass, `verify:e2e-policy` included | PASS | Every suite in the table above. `verify:e2e-policy`: 17 checks, 0 failed, 9 suites still owe a custom-domain leg (unchanged) |
| P6-30 | `lint` stays at zero and `typecheck` is clean | PASS | Both clean |
| P6-31 | A checkout with no push configured behaves exactly as today | PASS | `verify:notifications` — with push unconfigured the sender skips in 0ms without opening a socket, the browser is offered no key, and the notification screen says so instead of showing a button that cannot work |

## Checked by a person, not a script

| # | Item | Result |
|---|---|---|
| P6-32 | A real iPhone and a real Android phone each receive a new-order notification, and tapping it opens the right screen | **NOT DONE** — the operator's at the pilot |
| P6-33 | The same two devices receive one notification for several orders seconds apart, and no second copy of one already seen | **NOT DONE** — the operator's at the pilot |

Neither can be automated honestly: iOS Web Push exists only for a PWA added to the Home Screen,
permission can only be granted by a human tap, and no headless check can prove a notification was
drawn on a lock screen. Record per device: install state, the permission prompt, delivery within
seconds, the Arabic body rendered right-to-left, and where the tap landed.

## Bugs found while building this

Eight. Three were in the checks rather than the code, which is its own kind of finding.

1. **A synchronous export in a `"use server"` module 500'd every storefront page.**
   `lib/redis.ts` is `"use server"`, so every export must be an async function; a sync
   `redisFallbackActive()` made the whole module fail to compile, and the storefront reaches it
   through `lib/rate-limit.ts`. **Neither typecheck nor lint catches this** — `verify:integrations`
   did, by asking for a storefront page.
2. **The alert stage created the load it was meant to notice.** The first Redis check called
   `getRedisClient()`, which costs a 2-second connect attempt and a logged error per evaluation
   and leaves a client retrying in the background. It reads the module's existing fallback state
   now, and the suite went from minutes back to seconds.
3. **Node returns connect failures as an `AggregateError` whose own message is empty**, so every
   refused connection was classified "unknown" instead of "unreachable" — the same shape of
   mistake that cost an afternoon in `lib/redis.ts` during Phase 5. `classifyPushError` unwraps it.
4. **A mixed sync/async throw.** `claimOrdersForNotification` threw synchronously for a refusal
   and returned a promise otherwise. The instant path runs inside `after()`, where a synchronous
   throw escapes differently from a rejection, and the check that awaited it sailed past the sync
   case entirely.
5. **`net.Server.close()` never returned**, because the socket web-push abandoned at the timeout
   was still open — so the suite exited 0 with its database checks silently unrun. A suite that
   stops early and reports success is the worst outcome a check can have.
6. **The hanging-service check was testing nothing.** A valid-*looking* `p256dh` made web-push
   fail during payload encryption, before any socket, so the "timeout" it asserted was a crypto
   error. With a real P-256 pair it still failed fast — web-push always speaks TLS, and an HTTP
   server answers a ClientHello with an HTTP response (EPROTO). A bare TCP listener that says
   nothing is what a push service going dark actually looks like.
7. **The fixtures were making real requests to Google.** Devices registered at
   `fcm.googleapis.com` with made-up tokens, so every delivery check hit a live push service. They
   point at a closed local port now — which forced the test concession to become `host:port`,
   because a host-only allowance for `127.0.0.1` silently made the suite's own
   "127.0.0.1:6379 must be refused" case false.
8. **A check that found an import instead of a call.** "The notification is scheduled after the
   commit" matched `announceNewOrderSafely` at the top of the file, so it passed by looking at the
   import line.

And one finding from outside: the **automated security review flagged the registration action**,
correctly. An authenticated owner could register `http://169.254.169.254/…` as their "device" and
have this platform POST to its own infrastructure. That is now D61's allowlist, enforced in the
data layer and again in the sender.

## What is not covered

- **No real phone has received a notification.** P6-32 and P6-33 are the whole of the
  device-side proof and they are the operator's to do.
- **A Redis fallback that starts and ends between two evaluations is never reported.** The alert
  reads the client's current state rather than a history table; recording start and end would mean
  writing to the database on a path whose premise is that Redis is already unavailable.
- **The manifests point at the platform favicon.** A real icon set is a design task, and a
  manifest naming icons that do not exist fails to install on Android — so it is named here rather
  than faked.
- **No in-app notification inbox.** The ledger is written and read by checks and the platform
  health view; a merchant-facing list of past notifications is post-launch.
- **An app that is down cannot push its own alarm.** §11.10 says external uptime monitoring stays
  responsible for a total outage, and nothing here changes that.
- **Nine e2e suites still owe a custom-domain leg** (`verify:e2e-policy` lists them), due before
  the Phase 7 pilot.

## Before this is switched on

1. Generate VAPID keys and a `PUSH_ENCRYPTION_KEY` per environment (`.env.example` has the
   commands). Without them the app behaves exactly as it did before Phase 6, by design.
2. `PUSH_TEST_ENDPOINT_HOST` must be **unset** in production. It is ignored there anyway, which a
   check proves, but an unset variable needs no trust.
3. The scheduled command now runs five more stages. Re-check the container's graceful shutdown
   window (10–30s) so `after()` callbacks finish, and the §2 connection arithmetic in
   [ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md).
4. New environment variables: `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`,
   `PUSH_VAPID_SUBJECT`, `PUSH_ENCRYPTION_KEY`, `PUSH_TIMEOUT_MS` (2500).
