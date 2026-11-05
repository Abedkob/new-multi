# Phase 5 — Acceptance results

Results for [PHASE_5_PLAN.md](PHASE_5_PLAN.md) §6, run on 2026-11-05.

**All 34 items pass, plus D40b, added after the phase closed.** Phase 5 is not a release: §13 of the master plan holds the launch until
Phase 7, and `ANALYTICS_ROLLOUT_MODE` stays `off` in production
([ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md)).

Phase 5 is read-only over the analytics tables. The only writes it adds are the owner's own
integration ids, saved campaigns, and audit rows.

## Reproducing this

Most of the new suites need a server with collection on. One of them (`verify:health`) needs the
health window at zero, and `next dev` refuses a second instance for the same project, so start it
once with both:

```bash
ANALYTICS_ROLLOUT_MODE=all ANALYTICS_HEALTH_FLUSH_MINUTES=0 pnpm dev --port 3200
```

No server needed:

```bash
pnpm verify:reports && pnpm verify:insights && pnpm verify:campaigns && pnpm verify:isolation
```

Server needed:

```bash
BASE_URL=http://localhost:3200 pnpm verify:report-ui && BASE_URL=http://localhost:3200 pnpm verify:report-states
```

```bash
BASE_URL=http://localhost:3200 pnpm verify:platform-console && BASE_URL=http://localhost:3200 pnpm verify:integrations
```

```bash
BASE_URL=http://localhost:3200 pnpm verify:permissions
```

**Restart the server after any migration.** A `next dev` started before the latest migration
serves route handlers as 404 while pages still render — it looks exactly like a broken feature.

## Summary of the runs

| Suite | Checks |
|---|---|
| `verify:reports` | 23 |
| `verify:insights` | 14 |
| `verify:integrations` | 12 |
| `verify:campaigns` | 13 |
| `verify:report-ui` | 9 |
| `verify:report-states` | 9 |
| `verify:platform-console` | 7 |
| `verify:isolation` | 16 |
| `verify:permissions` | 19 |
| `verify:aggregates` | 20 |
| Phases 1–4 regression | templates 96, commerce 40, consent 43, ingestion 24, commerce-analytics 18, acquisition 12, search 9, retention 10, health 11, scheduled 6, social-links 9, coupons (all), e2e-policy 17 |

## The reports cannot mislead

| # | Item | Result | Evidence |
|---|---|---|---|
| P5-01 | No module under the report routes reads `AnalyticsEvent` (**D41**) | PASS | `verify:reports` — the import walk reaches every module reachable from `report.ts` and every consumer of it; `verify:platform-console` runs the same walk over the console's 11 modules |
| P5-02 | 3 sessions reads 3, with no trend judgment | PASS | `verify:reports` (the arithmetic) and `verify:report-ui` (the rendered digit, and no "Growing"/"Declining" on the page) |
| P5-03 | Order value and WhatsApp potential value never in one total | PASS | `verify:report-ui` asserts the page contains $123.00 and $777.00 and **not** $900.00; `verify:campaigns` asserts no screen adds the two fields; P4-22 still covers the modules |
| P5-04 | A day reconciles with its aggregate row | PASS | `verify:reports` — the 7-day series reconciles with the totals beside it and a day with no row renders as a zero rather than a gap |
| P5-05 | "Last 7 days" is seven store-local days, across 23- and 25-hour days (**D45**) | PASS | `verify:reports` (167h and 169h weeks in Asia/Beirut); `verify:report-ui` (the heatmap shows only recorded hours) |
| P5-06 | A funnel step with zero sessions is shown, with its drop-off (**D46**) | PASS | `verify:report-ui` — all 6 website steps render and the empty checkout step reads 0 with 0.0% |
| P5-07 | A deleted product keeps its historical name (**D44**) | PASS | `verify:report-ui` — a product row whose product no longer exists shows "Linen Shirt" and is labelled as gone |

## Insights

| # | Item | Result | Evidence |
|---|---|---|---|
| P5-08 | Each insight fires at its threshold and not one session below | PASS | `verify:insights` — every §6 threshold at the line, one below and one above |
| P5-09 | Every insight carries the evidence that produced it | PASS | `verify:insights` (structure) and `verify:report-ui` (2 insights rendered, each with its evidence line) |
| P5-10 | Nothing qualifying says so, and offers no weaker guess | PASS | `verify:insights`; the empty state is `insight.none`, asserted by `verify:report-ui`'s branch |
| P5-11 | No insight asserts a cause; the top-product line names its measure | PASS | `verify:insights`. The measure is a structural field on the insight (`subject.measure`), added in Phase 5 so the line can be written in Arabic — the English `evidence` string is dev-facing and is never shipped |

## Marketing

| # | Item | Result | Evidence |
|---|---|---|---|
| P5-12 | One section holds campaigns, links, integrations and results (**D38**) | PASS | `verify:campaigns` — all four tabs exist and lead to real pages; the nav points at the section; the Phase 4 path redirects |
| P5-13 | A saved campaign appears in Campaigns before any traffic, with zeros (**D39**) | PASS | `verify:campaigns` (3 checks) and `verify:permissions` (the tab through a real owner session) |
| P5-14 | A campaign that exists only in the data still appears | PASS | `verify:campaigns` — a campaign nobody saved is listed with its real 12 visits; the report layer cannot see the saved-campaign table at all |
| P5-15 | `LinkBuilder` is mounted in Marketing unchanged; the Phase 4 route redirects | PASS | `verify:acquisition` (P4-35's forbidden-coupling list, plus the redirect) and `verify:campaigns` (the save arrives as a prop, and one slug rule is shared with the server) |
| P5-16 | An owner sets their own ids, and they take effect only with consent (**D40**) | PASS | `verify:integrations` — a declining visitor's HTML contains no advertising id, a consenting one's does |
| P5-17 | A malformed id is refused with the expected shape | PASS | `verify:integrations` |
| P5-18 | A platform admin can see, edit and clear every store's ids, each write audited | PASS | `verify:integrations` |
| P5-18a | Exactly one audit row per integration write, owner's included; the trail unreadable by the owner | PASS | `verify:integrations` — a no-op save leaves no row; no route under `app/admin` reads the log; and the one narrow accessor (**D40b**) is checked to select nothing but an actor and a time, and to call no write |
| D40b | Each integration id says who last changed it and when, in both screens that edit it | PASS | `verify:integrations` (per-field actor and role, newest write wins, untouched fields report nothing, and the `detail` format round-trips) and `verify:permissions` (the line rendered for an owner after a platform admin's change, and absent before any change) |
| P5-18b | Integrations is owner-only, including every action | PASS | `verify:permissions` — the static guard now follows one level of same-file indirection and prints each case |
| P5-18c | A pasted tag or snippet stores the id alone | PASS | `verify:integrations` — the column is read back and asserted free of `<`, `script` and `fbq` |
| P5-18d | Verification tags render with consent declined, on the shared host **and** the store's own domain (**D40a**) | PASS | `verify:integrations` — the custom-domain leg uses `node:http` with a chosen Host header, because `fetch` drops that header silently |
| P5-18e | Step-by-step setup text in English and Arabic, naming the tool that checks it | PASS | `verify:integrations`; `ar.ts` is typed `Record<DictionaryKey, string>`, so a missing Arabic string is a compile error |
| P5-19 | Results answers which source brought visitors, orders and WhatsApp clicks, kept apart (**D48**) | PASS | `verify:campaigns` (the columns and the unknown-vs-zero rule) and `verify:report-ui` (each attribution basis reads its own stored column) |
| P5-20 | Searches shows unmet demand, with redacted phrases counted but never suggested | PASS | `verify:report-ui` — the redacted row is in "everything searched", absent from the suggestions, and included in the total (6 + 9 = 15) |

## Platform console

| # | Item | Result | Evidence |
|---|---|---|---|
| P5-21 | No person-level data is reachable | PASS | `verify:platform-console` — the import walk over the console's 11 reachable modules finds no raw analytics table |
| P5-22 | §5.8's definitions, and "not enough activity" for a small store | PASS | `verify:platform-console` — 200 vs 100 is growth; 6 vs 2 is +200% and gets no verdict while keeping its real 6 |
| P5-23 | Every view of the console writes an audit row naming the admin (**D43**) | PASS | `verify:platform-console` — one view, one `PLATFORM_CONSOLE_VIEW` row, with the actor's email and the period, `tenantId` null |
| P5-24 | A store owner cannot reach `/platform/analytics` | PASS | `verify:platform-console` — owner redirected away, anonymous visitor sent to login |

## States, accessibility, bilingual

| # | Item | Result | Evidence |
|---|---|---|---|
| P5-25 | No consented traffic: the page explains how measurement begins | PASS | `verify:report-states` — the tiles are replaced, and the page names which of the two conditions the store is missing |
| P5-26 | Traffic but no orders still shows traffic, WhatsApp, products and searches | PASS | `verify:report-states` — and the average order reads as explained rather than as 0 |
| P5-27 | Redis down: "temporarily unavailable", never zero | PASS | `verify:report-states`; `verify:ingestion`'s P2-27 still covers the server side |
| P5-28 | Aggregation delayed: the last successful update, with its age | PASS | `verify:report-states` — present where there is one, named as absent where there is not |
| P5-29 | Every chart has a table alternative, reachable and readable | PASS | `verify:report-states` — all 10 report screens are real tables with headed rows and columns; the bars are `aria-hidden` decoration inside them, and no charting library is imported anywhere |
| P5-30 | Every new screen renders in Arabic, RTL | PASS | `verify:report-states` — 8 screens fetched with the Arabic cookie, each `dir="rtl"` and carrying its Arabic copy. **Not covered: visual overflow at 375px.** The dense tables become cards below `md` and the wide ones scroll in a focusable region, which is the mechanism; nobody has looked at it on a phone |
| P5-31 | Dense tables become ranked cards on a phone, with the same numbers | PASS | `verify:report-states` — one column definition feeds both layouts, and the rendered product appears in both with the same labels |

## Regression

| # | Item | Result | Evidence |
|---|---|---|---|
| P5-32 | Phases 1–4's suites all pass, `verify:e2e-policy` included | PASS | Every suite listed in the summary above, run against this branch. `verify:e2e-policy`: 17 checks, 0 failed, 9 suites still owe a custom-domain leg (unchanged — that list may only shrink) |
| P5-33 | `lint` stays at zero and `typecheck` is clean | PASS | Both clean |
| P5-34 | `/admin/marketing` and `/platform/analytics` refused on a store's custom domain (**D47**) | PASS | `verify:report-states` — 404 for both, over a socket with a chosen Host header |

## Bugs found while verifying

Six, in the order they were found. Each one was invisible from the outside.

1. **A dead Redis took down the request that touched it.** node-redis builds an `AggregateError`
   from a list of errors that is null once its reconnect strategy gives up; the `TypeError`
   escapes asynchronously, Next.js turns it into an `uncaughtException`, and the request hung for
   five minutes before answering. It reproduced on any machine with `REDIS_URL` set and nothing
   listening — which includes the rate limiter on every login there. `lib/redis.ts` no longer
   lets the strategy give up; the waiting is bounded instead, so a caller degrades in two seconds
   and a Redis that comes back is adopted without a restart. Found by the live-visitor tile
   (P5-27), the first thing in this codebase to ask Redis a question during a page render.
2. **The storefront handed every advertising id to the browser.** `grantedConfig` ran only inside
   the client component, so a visitor who declined advertising still had the pixel id in their
   page props. Nothing was tracked — and it was an id the browser was never meant to receive,
   waiting for the first line of code that read `config` instead of the granted one. It now runs
   on the server (P5-16).
3. **`verify:acquisition` had been failing silently since the Marketing move.** Its P4-35 check
   read the Phase 4 route, which had become a redirect. It reads the Marketing route now and
   asserts the redirect, which is P5-15 stated as a property rather than as a file's contents.
4. **`verify:permissions`' static guard could not see a shared role check**, so Phase 4's privacy
   actions had been failing it since they landed. It follows one level of same-file indirection
   now and prints each case — a check that cannot see a shared guard pushes people toward
   copy-pasting the guard.
5. **The Overview opened seven transactions at once** (each report sets its own RLS context) and
   starved the pool: a 500, not a slow page. The reads are sequential, with the one-transaction
   alternative written down where the next person will find it.
6. **Two checks were matching text rather than behaviour.** `verify:consent`'s P1-04 matched the
   string `PlatformAnalytics` anywhere in a file, so a page component named
   `PlatformAnalyticsPage` failed a check about where a GA component is mounted; it matches the
   import now. `verify:scheduled` counted every row in the scheduled-run table, so anything
   else writing one during a 300ms window failed it; it counts its own stages now.

## What Phase 5 does not do

- **No alert delivery.** Phase 4 evaluates the health signals and the console shows them; Phase 6
  decides who to wake.
- **No coupon-per-campaign screen.** Agreed as post-launch. The data is already there — an order
  snapshots both its coupon and its attribution — so it stays a screen rather than a migration.
- **No server-side conversion reporting** (Conversions API / Enhanced Conversions). Post-launch.
- **No live "is your tag firing" test.** It cannot be done honestly from the server; the
  integration guides point at Meta Pixel Helper and Google Tag Assistant instead.
- **No phone has been looked at.** P5-30 and P5-31 prove the mechanism, not the pixels.
- **Nine e2e suites still owe a custom-domain leg** (`verify:e2e-policy` lists them), due before
  the Phase 7 pilot.
