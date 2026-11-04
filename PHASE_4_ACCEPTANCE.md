# Phase 4 — Acceptance results

Results for [PHASE_4_PLAN.md](PHASE_4_PLAN.md) §6, run on 2026-11-04, including the seven
additions the plan review asked for (D31–D37).

**All 41 items pass: the 34 planned, plus 7 added while verifying.** Phase 4 is not a release —
§13 of the master plan holds the launch until Phase 7, and `ANALYTICS_ROLLOUT_MODE` stays `off`
in production ([ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md)).

## Reproducing this

Two of the suites need a server, and one needs it configured a particular way. Start it with
collection on and the health window at zero, so every batch flushes its own counters instead of
waiting five minutes:

```bash
ANALYTICS_ROLLOUT_MODE=all ANALYTICS_HEALTH_FLUSH_MINUTES=0 pnpm exec next dev --port 3300
```

```bash
pnpm verify:scheduled && pnpm verify:aggregates
```

```bash
BASE_URL=http://localhost:3300 pnpm verify:search && BASE_URL=http://localhost:3300 pnpm verify:acquisition
```

```bash
BASE_URL=http://localhost:3300 pnpm verify:retention && BASE_URL=http://localhost:3300 pnpm verify:health
```

```bash
PHASE4_ONLY=1 BASE_URL=http://localhost:3300 pnpm e2e:analytics
```

**Restart the server after any migration.** A `next dev` started before the latest migration
serves **route handlers as 404 while pages still render**, which looks exactly like a broken
feature and cost a run here.

## Summary of the runs

| Command | Result |
|---|---|
| `pnpm verify:scheduled` | **6 passed** |
| `pnpm verify:aggregates` | **19 passed** |
| `pnpm verify:search` | **9 passed** |
| `pnpm verify:acquisition` | **11 passed** |
| `pnpm verify:retention` | **10 passed** |
| `pnpm verify:health` | **11 passed** |
| `pnpm e2e:analytics` | **29 passed** (8 of them Phase 4, incl. 2 on a custom domain) |
| `pnpm verify:commerce-analytics` | 18/18 |
| `pnpm verify:ingestion` | 24/24 |
| `pnpm verify:consent` | 43/43 |
| `pnpm e2e:consent` | 25/25 |
| `pnpm verify:commerce` | 40/40 |
| `pnpm verify:coupons` | pass |
| `pnpm verify:templates` | 96/96 |
| `pnpm verify:isolation` | 12/12, as `app_user` |
| `pnpm verify:social-links` | 9/9 |
| `pnpm e2e:checkout` | 20/20 |
| `pnpm e2e:pages` | 10/10 |
| `pnpm verify:e2e-policy` | 17/17, with 9 suites still owing a custom-domain leg |
| `pnpm typecheck` | clean |
| `pnpm lint` | **0 problems** |

The saturation figures from this run (`checkout under saturation 524ms vs 549ms idle, 0.95x;
analytics peak 5/5 connections`) come from a dev server and are not capacity numbers. Phase 2's
production-build figures stand.

## Scheduled work cannot touch the storefront

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-01 | Two concurrent runs: the second exits having changed nothing | PASS | `verify:scheduled` — two genuinely concurrent runs against the real advisory lock; the second acquired nothing, ran no stage and wrote no row |
| P4-02 | A checkout completes normally during a full run | PASS | `verify:scheduled` — 13ms during a run against 48ms idle. Plus a static check that **no route, component or proxy file imports the scheduler or its pool**, so a slow job cannot become a slow page |
| P4-03 | A failing stage leaves the others intact | PASS | `verify:scheduled` — a throwing stage between two healthy ones: recorded FAILED with `finishedAt` set, both others ran, command exits non-zero |
| P4-04 | An expired lease is recovered | PASS | `verify:scheduled` — a RUNNING row left by a "crashed" run, lease an hour past: marked EXPIRED and closed, and the run carried on |
| P4-05 | A run with the analytics tables unreadable fails loudly | PASS | `verify:scheduled` — `REVOKE SELECT ON "AnalyticsEvent" FROM app_user`, job run **in a subprocess as app_user**: exits 1, records FAILED, and an order still completes |

## Time

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-06 | An event at 23:30 local lands on the local day | PASS | `verify:aggregates` — and 00:30 local, which is the previous day in UTC; the same instant is a different day in three zones |
| P4-07 | A DST transition loses and duplicates no hour | PASS | `verify:aggregates` — Beirut changes clocks **at midnight**: 2026-03-29 is 23 hours and starts at 01:00 with no hour 00; 2026-10-24 is 25 hours and its repeated 23:00 still belongs to it |
| P4-08 | A zone change does not silently rewrite the past | PASS | `verify:aggregates` — every row records the zone that computed it; after a change to `Asia/Dubai` the recomputed row says so, so a step in a merchant's chart can be explained |

## Search

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-09 | Typing emits one search, not one per keystroke | PASS | `e2e:analytics` — "jacket" typed a letter at a time emitted exactly one `SEARCH_SUBMITTED` with 1 result, on the shared host **and on `analytics-e2e.test`** |
| P4-10 | A no-result query emits exactly one stabilized event | PASS | `e2e:analytics` — "umbrella" typed and never submitted: one event, `resultCount` 0 |
| P4-11 | Email, phone and card-like text are stored as `[redacted]` | PASS | `verify:search` — 15 forms, **including Lebanese mobiles in Arabic-Indic digits**, with and without `+961`, spaced and dashed; posted through the real endpoint, and the raw text appears in no column |
| P4-11a | Arabic spellings of one word normalize to one phrase | PASS | `verify:search` — 10 variants (alef forms, ة/ه, ى/ي, tashkeel, tatweel, both digit sets) collapse; "قميص" and "قمصان" stay apart |
| P4-12 | A redacted phrase counts but never suggests stock | PASS | `verify:aggregates` — the `[redacted]` row counts one search and carries `redacted: true` |
| P4-13 | A result click records the product | PASS | `e2e:analytics` — a real click recorded the product id and the phrase it was found by |

## Acquisition

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-14 | Each rung of §3.5's ladder classifies as specified | PASS | `verify:acquisition` — all 9 rungs, including a gclid with no UTM, `m.facebook.com` folding to one channel, and `notfacebook.com` not folding |
| P4-15 | A direct visit never erases a campaign; a campaign mid-session wins | PASS | `verify:acquisition` — the full sequence through the real endpoint: direct → campaign → direct → social. **This is the D24 bug**: the touch was written at session creation and never revisited |
| P4-16 | First touch survives while last touch changes | PASS | `verify:acquisition` — first touch stayed at `newsletter` while last touch moved to `facebook` |
| P4-17 | No click id and no referring URL is stored | PASS | `verify:acquisition` — nothing resembling one anywhere in the three tables; an over-long host is refused with 400 |

## Aggregates

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-18 | Running twice produces identical rows | PASS | `verify:aggregates` — three days recomputed twice, byte-identical apart from `id`/`computedAt`, and no duplicate rows |
| P4-19 | A late event corrects yesterday | PASS | `verify:aggregates` — a session created after the first pass appears on the next |
| P4-20 | Cancelling corrects the day and keeps the conversion | PASS | `verify:aggregates` — 2000 moved out of `orderValueCents` into `cancelledOrderValueCents`; `checkoutSessions` untouched |
| P4-20a | A cancellation a week later corrects that older day | PASS | `verify:aggregates` — both routes: the `updatedAt` sweep corrected 2026-10-28, and the nightly 30-day pass repaired a day corrupted on purpose |
| P4-21 | Daily totals reconcile against the raw events | PASS | `verify:aggregates` — 3 product views in 1 session count as 1 session; a product's `views` (3) and `viewSessions` (1) both recorded and different |
| P4-22 | Order value and potential WhatsApp value never merge | PASS | `verify:aggregates` — 2 modules touch both columns, neither sums them |
| P4-23 | A cross-tenant aggregate read returns nothing, by RLS | PASS | `verify:aggregates` — **in a subprocess as app_user**: another store's rows invisible, and a row written for another store refused by the policy's `WITH CHECK` |

## Retention and privacy

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-24 | Each §4.7 window deletes its own rows and nothing else | PASS | `verify:retention` — 6 deletions across 5 tables; the surviving aggregate row is the expected one, unmodified. The four windows default to exactly §4.7's numbers |
| P4-24a | `--dry-run` reports and deletes nothing | PASS | `verify:retention` — row counts identical either side, and every window's count reported |
| P4-25 | Retention never touches an order | PASS | `verify:retention` — the order survives with its attribution **and its session key**; deleting the session it points at leaves the order and its snapshot (there is deliberately no foreign key) |
| P4-26 | An export holds that visitor's data and no other's | PASS | `verify:retention` + `e2e:analytics` — the export carries the subject's sessions and events and leaks no other visitor; the shopper's id is shown on `/privacy` and matches their visitor row |
| P4-26a | The platform admin can act; a store owner cannot; every use is logged | PASS | `e2e:analytics` — the console resolved the id and logged the lookup as the admin; **the store's own owner was sent to `/admin`**. `verify:retention` — no owner-facing file reaches the privacy service; 3 actions, all behind `requirePlatformAdmin` |
| P4-27 | Erasure preserves aggregates and other visitors | PASS | `verify:retention` — daily totals byte-identical after an erasure; the other visitor and their event untouched; the subject's order **detached and kept**, source/medium/returning intact |

## Health signals

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-28 | A forced 400 raises the contract signal alone | PASS | `verify:health` — a non-UUID `eventId` (Phase 3's actual bug) raised 1 rejection and **0 operational drops**; and the stage alerted on rejections at the threshold with no operational claim |
| P4-29 | A limiter raises the operational rate alone | PASS | `verify:health` — 80 batches carrying the minted identity produced 19 operational drops and 0 rejections; the stage alerted at 20% and stayed silent at 100% over 5 batches, which is below §11.10's baseline |
| P4-30 | A refused-consent batch raises neither | PASS | `verify:health` — 1 policy drop, 0 operational, 0 rejections; a window of nothing but policy drops raises no alert at all |
| P4-31 | A flushed snapshot resets its window | PASS | `verify:health` — 85 windows, none overlapping for an instance, 85 batches counted exactly once |
| P4-31a | A second process reads them; a quiet instance writes nothing | PASS | `verify:health` — a window written by the server read by the check, keyed `hostname:pid`; a forced flush in a process that ingested nothing wrote no row; with no rows the stage reports "silence, not failure" |

## Regression

| # | Item | Status | Evidence |
|---|---|---|---|
| P4-32 | `verify:commerce`, `verify:coupons`, `e2e:checkout` pass | PASS | 40/40, pass, 20/20 |
| P4-33 | The Phase 1–3 suites pass | PASS | `verify:ingestion` 24, `verify:consent` 43, `verify:commerce-analytics` 18, `e2e:consent` 25, `e2e:analytics` 29 |
| P4-34 | `verify:e2e-policy`, lint and typecheck clean | PASS | 17/17, **lint 0 problems**, typecheck clean |
| P4-35 | The link builder is movable and builds a classifiable link | PASS | `verify:acquisition` — none of 7 page couplings, the route holds the URL and data, and all 6 offered channels tag what the ladder classifies. `e2e:analytics` — a link built in the admin recorded `instagram / social / eid-sale-2026` when used |

## The seven additions, and how each is proven

1. **D31, Arabic normalization.** Alef forms, ta marbuta, alef maksura, tashkeel, tatweel and
   both digit sets, folded before anything else looks at the text (P4-11a).
2. **D32, the scrub understands Arabic digits and Lebanese numbers.** Digits fold to ASCII
   first, so one set of patterns covers both scripts; the Lebanese prefixes are named explicitly
   (P4-11). Without this the scrub would have been theatre in exactly this market.
3. **D33, late cash-on-delivery cancellations.** Two mechanisms, both checked: an `updatedAt`
   sweep that lets an order drag its own older day back into the queue, and a nightly 30-day
   recompute (P4-20a). `Order.updatedAt` did not exist and had to be added, backfilled to each
   order's `createdAt` rather than to now().
4. **D34, how per-process counters reach the table.** The process that owns them writes them,
   after the response, never awaited, keyed by instance; the scheduler only reads (P4-31a).
5. **D35, a retention dry run.** Reports every window's count and deletes nothing (P4-24a).
   **The first production run must be a dry run** — see "Before this is switched on" below.
6. **D36, a platform-admin entry point.** `/platform/stores/<slug>/privacy`, three steps, every
   use audit-logged, and the store's own owner cannot reach it (P4-26a).
7. **D37, the link builder is movable.** Proven structurally rather than by mounting it at a
   throwaway second route, which would be production code existing only for a test and would not
   catch the coupling anyway (P4-35).

## Found and fixed while verifying

1. **An isolation check that could not fail.** P4-05 ran the job in-process, where
   `scripts/_owner` has already pointed `APP_DATABASE_URL` at the owner — a superuser, which RLS
   and `REVOKE` do not apply to. The fault was invisible and the check reported the job had
   succeeded. It now runs as a subprocess connecting as `app_user`, the way the real container
   does. P4-23 had the same problem and the same fix.
2. **"Last non-direct touch" never moved** (D24). The session's touch was written when the row
   was created and nothing revisited it — the comment there even claimed it was "only
   overwritten with something real". A visitor who arrived direct and came back through a
   campaign link kept `source = null` for the whole half hour, and the campaign that brought
   them was credited to nothing.
3. **A check that matched its own documentation.** The link builder's header explains that it
   must not reach for `usePathname`; the scan for that string matched the sentence and failed a
   correct component. Comments are stripped first now.
4. **A flood that tripped nothing.** The limiter check sent 80 cookieless batches, which fall
   under the 1,200/min identity-creation bound rather than the 60/min per-visitor one. It now
   carries the identity the endpoint minted, the way a browser does.
5. **Two assertions that could not fail**, deleted: `"/"` and `"?"` appear in every ISO
   timestamp, so searching a JSON dump for them passed whatever happened.
6. **A P3-16 check that was too strict rather than wrong.** It asserted that only two modules
   mention an order's attribution columns, which was true when only two did. Phase 4's aggregate
   reads them legitimately. The check now distinguishes readers from writers, which is what the
   claim was always about.
7. **A browser check that assumed the dev port.** The link builder uses `PLATFORM_BASE_URL`,
   because it hands a merchant a link to paste in public. The check asserted the dev origin and
   was wrong to; it now asserts the path and parameters and visits the link against the test
   server.

## Two environment traps, both of which cost a run

- **A `next dev` started before the latest migration serves route handlers as 404 while pages
  still render.** Every analytics endpoint 404'd and the failure looked like a broken feature.
  Restart the server after migrating.
- **A browser check must read back what it typed.** A server-rendered input exists before React
  hydrates it, and a controlled input that hydrates mid-typing is reset — the form then submits
  an empty query. `scripts/e2e/analytics.ts`'s `typeSearch` types, reads the value back, and
  retypes if the field was cleared.

## Before this is switched on

1. `ANALYTICS_ROLLOUT_MODE` stays `off`. Phase 4 built the machinery; §13 holds the launch.
2. **Run retention as a dry run first** and read the counts:
   `pnpm analytics:scheduled --dry-run`. Enable the live run only after the numbers have been
   looked at by a person (D35).
3. Schedule `pnpm analytics:scheduled` every five minutes in Dockploy (§10), and give the
   container the usual 10–30s graceful shutdown so `after()` callbacks finish.
4. New environment variables, all optional with defaults:
   `ANALYTICS_JOB_DATABASE_POOL_MAX` (2), `ANALYTICS_HEALTH_FLUSH_MINUTES` (5),
   `ANALYTICS_RAW_RETENTION_DAYS` (90), `ANALYTICS_VISITOR_RETENTION_MONTHS` (13),
   `ANALYTICS_AGGREGATE_RETENTION_MONTHS` (24), `ANALYTICS_RECEIPT_RETENTION_MONTHS` (24),
   `ANALYTICS_INGESTION_FAILURE_PERCENT` (5), `ANALYTICS_INGESTION_MIN_BATCHES` (20),
   `ANALYTICS_CONTRACT_REJECTION_ALERT` (5).
5. The job's pool is a **third** pool: one instance now needs 30 + 5 application connections and
   the job container 2. Re-check the arithmetic in
   [ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md) §2 before raising instances.

## What Phase 4 does not do

- **No report UI.** Aggregates are written and verified by query; Phase 5 renders them. The one
  owner-facing page added is the link builder, which reads nothing.
- **No alert delivery.** The health stage evaluates and records; Phase 6 decides who to wake.
- **Nine e2e suites still owe a custom-domain leg** (`verify:e2e-policy` lists them). Due before
  the Phase 7 pilot, which runs on a real store's own domain.
- **`AnalyticsAuditLog` is written but never read by a report.** Phase 5's platform console will
  show it; today it is evidence sitting in a table, which is the right order — writing it late
  would mean the first privacy requests went unlogged.
