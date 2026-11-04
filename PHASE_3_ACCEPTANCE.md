# Phase 3 — Acceptance results

Results for [PHASE_3_PLAN.md](PHASE_3_PLAN.md) §7, run on 2026-11-04, with the four changes the
plan review asked for (§"Changes from the reviewed plan" below).

**All 26 items pass: the 22 planned, plus 4 added by the review.** Phase 3 is not a release —
§13 of the master plan holds the launch until Phase 7.

## Reproducing this

Phase 3 makes no performance claims, so a dev server is adequate here, and two suites need one
anyway (see Phase 2's P2-33). Start it with collection on:

```bash
ANALYTICS_ROLLOUT_MODE=all pnpm exec next dev --port 3300
```

```bash
BASE_URL=http://localhost:3300 pnpm verify:commerce-analytics
```

```bash
BASE_URL=http://localhost:3300 pnpm e2e:analytics
```

The Phase 3 browser legs alone, without paying for the saturation run:

```bash
PHASE3_ONLY=1 BASE_URL=http://localhost:3300 pnpm e2e:analytics
```

## Summary of the runs

| Command | Result |
|---|---|
| `pnpm verify:commerce-analytics` | **18 checks passed**, exit 0 |
| `pnpm e2e:analytics` | **21 checks passed**, exit 0 (9 of them Phase 3) |
| `pnpm verify:commerce` | 40/40 |
| `pnpm verify:coupons` | pass |
| `pnpm e2e:checkout` | 20/20, including all 13 templates |
| `pnpm verify:ingestion` | 24/24 |
| `pnpm verify:consent` | 43/43 |
| `pnpm e2e:consent` | 25/25 |
| `pnpm verify:templates` | 96/96 |
| `pnpm verify:isolation` | 12/12, as `app_user` |
| `pnpm verify:social-links` | 9/9 |
| `pnpm typecheck` | clean |
| `pnpm lint` | 9 problems — **identical to the Phase 1 baseline**; Phases 2 and 3 add none |

The order timings in this run (`checkout under saturation 466ms vs 352ms idle`) come from a dev
server and are not capacity figures. Phase 2's production-build numbers stand unchanged.

## Money means one thing

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-01 | An order's value in analytics equals the order's own value, to the cent | PASS | Stronger than asked, because there is no second copy to disagree: analytics stores **no order value at all**. `verify:commerce-analytics` reconciles the order from its own snapshots (2 × 800 + 500 delivery − 160 coupon = **1940**) and asserts no analytics row restates it |
| P3-02 | A client-supplied `valueCents` is still refused | PASS | `verify:commerce-analytics` — 400, not a quiet ignore (regression of P2-14) |
| P3-03 | WhatsApp value is computed server-side from canonical pricing, discounts included | PASS | `verify:commerce-analytics` — a click on a 20%-off product at quantity 3 stored **2400** (3 × 800), not 3000. `e2e:analytics` confirms it from a real click: **2000** for a 2000-cent product |
| P3-04 | Potential value is never added to order value by any shared helper | PASS | Two checks: only `WHATSAPP_ORDER_CLICK` rows carry a value (every other type is null), and no module reads both an event's `valueCents` and an order's money snapshots (6 modules checked) |
| P3-05 | A cancelled order stays a conversion but leaves non-cancelled value totals | PASS | `verify:commerce-analytics` — attribution intact, 4540 − 1300 = 3240 |

## The funnel

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-06 | A full journey emits exactly one of each step, in order | PASS | `e2e:analytics` — `PRODUCT_VIEW ×3 → ADD_TO_CART → CART_VIEW → REMOVE_FROM_CART → PRODUCT_VIEW → ADD_TO_CART → CART_VIEW → CHECKOUT_STARTED`, which is the journey the browser actually took |
| P3-07 | Every event carries the session that produced it | PASS | `verify:commerce-analytics` — `sessionId` is `NOT NULL` and every stored row resolves to a session of that store |
| P3-08 | Refreshing a product page does not multiply distinct sessions | PASS | `e2e:analytics` — three visits, 3 views, 1 session |
| P3-09 | `CHECKOUT_STARTED` fires on arrival with a non-empty cart, not on submit | PASS | `e2e:analytics` — the event is stored while the order count is still 0 |
| P3-10 | Removing an item emits `REMOVE_FROM_CART` once, from any entry point | PASS | `e2e:analytics` — removed from the cart page, added from the product page: exactly one event |

## WhatsApp

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-11 | Clicking Order on WhatsApp records the click with product, variant and quantity | PASS | `e2e:analytics` — a real click, beaconed immediately; product, variant, quantity 1 and a server-computed 2000 |
| P3-12 | The WhatsApp link still opens when analytics is refused or failing | PASS | `e2e:analytics` — consent refused: the link is present, opens, and nothing is sent |
| P3-13 | A WhatsApp click creates no order and no revenue anywhere | PASS | `verify:commerce-analytics` — no order, and no order's value equals the click's |

## Orders carry their origin

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-14 | An order placed in a session records that session, its source and its device | PASS | Three ways: `verify:commerce-analytics` (every dimension written as given), and `e2e:analytics` from a real checkout **on the shared host** (`newsletter` / `nov` / desktop / `isReturningVisitor=false`) **and on a simulated custom domain** (`analytics-e2e.test`, cookies scoped to `/`) |
| P3-15 | An order placed without consent records nulls and succeeds normally | PASS | `verify:commerce-analytics` |
| P3-16 | The snapshot is written in the order's own transaction, not after it | PASS | `verify:commerce-analytics` — attribution is referenced by exactly two modules, and no `order.update` writes it |
| P3-17 | A later session change does not rewrite a past order's attribution | PASS | `verify:commerce-analytics` — the session's source is changed afterwards; the order still says `newsletter` |
| P3-18 | Deleting analytics data (retention) leaves orders intact | PASS | `verify:commerce-analytics` — no foreign key from `Order` to either analytics table, and every analytics row deleted with the orders untouched |

## Commerce independence

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-19 | An order completes when the analytics tables cannot be read | PASS | `e2e:analytics`, by real fault injection: `REVOKE SELECT ON "AnalyticsSession" FROM app_user`, so resolution fails on the live request mid-checkout. The order completed in **533ms** with null attribution; the grant is restored afterwards. See the note below on what "unreachable" can mean here |
| P3-20 | An order completes when attribution resolution throws | PASS | `verify:commerce-analytics` — the resolver is called outside a request so its first statement throws; it returns `undefined`, logs, and the order completes |
| P3-21 | `verify:commerce`, `verify:coupons`, `e2e:checkout` still pass | PASS | 40/40, pass, 20/20 |
| P3-22 | `verify:ingestion`, `verify:consent`, `e2e:analytics` still pass | PASS | 24/24, 43/43, 21/21 |

## Added by the plan review

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-23 | An order carries no analytics identity, only a session key and a boolean | PASS | `verify:commerce-analytics` — no column on `Order` matches `visitorId` or `eventId`, and `isReturningVisitor` is a boolean |
| P3-24 | No module joins orders to individual events; sessions are the only key | PASS | `verify:commerce-analytics` — the set of modules reading an order's attribution and the set reading the event table do not intersect, and the check asserts the event-table search found something, so it cannot pass vacuously. **This is the commitment for Phase 5**: its reports reconcile orders against sessions, and this check fails the day one of them reaches for the event stream |
| P3-25 | Privacy erasure clears `analyticsSessionId` and leaves the order alone | PASS | `verify:commerce-analytics` — `forgetOrderAttributionLinks()` clears the key; source, medium, `isReturningVisitor` and the order's status are untouched |
| P3-26 | The product button is the only WhatsApp order control | PASS | `verify:commerce-analytics` — see "no cart-level WhatsApp order exists" below |

## Changes from the reviewed plan

1. **`analyticsVisitorId` is gone from `Order`**, replaced by `isReturningVisitor` (nullable
   boolean). A visitor id is a durable pseudonymous identifier and an order is kept for years,
   outside the 13-month analytics retention sweep, so keeping one would let a single purchase be
   tied back to a person's whole history with that store. The boolean answers the question a
   merchant actually has and cannot be re-identified. The session id remains the one
   reconciliation key — and it is the one thing erasure clears (P3-25).
2. **`firstTouchMedium` and `firstTouchCampaign` added**, so first-touch and last-touch
   attribution are symmetrical rather than first-touch being source only.
3. **No cart-level WhatsApp order exists to instrument.** The only storefront control that
   offers to *order* over WhatsApp is the product page's button. The shell's floating button is
   a contact shortcut with no product, variant or cart in it, and pricing it would put a
   meaningless zero into potential value; the admin pages also link to `wa.me`, but that is the
   owner messaging a customer about an order they already have. P3-26 asserts all of this and
   fails the day a cart-level order control appears.
4. **P3-14 runs on a simulated custom domain as well**, which is where it earned its keep (see
   below).

## Found and fixed while verifying

1. **Event ids were invalid off localhost, and every batch was silently lost.**
   `crypto.randomUUID` exists only in a **secure context**: localhost counts, https counts, a
   store reached over plain http on its own domain does not. The tracker's fallback there
   produced `<millis>-<random>`, which is not a UUID, so the contract refused the whole batch
   with a 400 and the page's analytics disappeared. The fallback now builds a real v4 UUID from
   `crypto.getRandomValues`, which has no such restriction. Found only by the custom-domain
   P3-14 leg the review asked for — the second time in two phases that custom-domain behaviour
   has hidden a total data loss that every other check called healthy.
2. **A 400 told nobody anything.** It raised a counter and returned a generic body, which is why
   the above took a browser to find. The endpoint now logs which field failed validation (never
   its value, which came from a browser), because a 400 is the one refusal that means our own
   code sent something wrong. This also closes the gap Phase 2 left open in P2-31.
3. **The custom-domain leg's first failure was misdiagnosed.** It skipped itself with "this
   build refuses a Secure cookie over http" while running against `next dev`; the real cause was
   the hostname missing from `allowedDevOrigins`, so `next dev` never served the page its
   JavaScript. The skip message now names both causes.

## A note on P3-19's wording

The plan says "the analytics database is unreachable". In this deployment there is no separate
analytics database: there is one database and **two pools** (`lib/prisma-analytics.ts`), which
is what isolates ingestion from checkout. Making the database unreachable would therefore take
checkout down with it and prove nothing.

So the check injects the fault that can actually happen to this subsystem alone: the role the
server connects as loses the right to read the analytics tables. Attribution resolution then
fails for real, on a live request, in the middle of a checkout — and the order completes with
nulls.
