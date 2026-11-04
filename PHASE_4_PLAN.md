# Phase 4 — Search, acquisition, tracked links, aggregates, and scheduled work

Plan for [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md) §13's
Phase 4, drawing on §3.5 (acquisition), §3.6 (searches), §3.7 (time), §4.7 (retention and
privacy requests), §9.3 (tables), §10 (aggregation and scheduled work) and §11.10 (platform
alerts).

**Not a release.** §13 holds the launch until Phase 7, so this phase ends with everything built
and `ANALYTICS_ROLLOUT_MODE` still `off` in production
([ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md)).

This is the phase where analytics stops being only a writer and starts running **scheduled work
and deletions**. Phases 2 and 3 could only lose analytics data; Phase 4 can delete it, and
touches an order's attribution on a privacy request. So the independence rule gets stricter, not
looser: nothing in this phase may run inside a storefront request, and nothing may delete a row
the Phase 5 reports have not yet been written to read.

## 0. Progress (resume here)

Last worked on **2026-11-04**. Branch `analytics/phase-1`, which is also what
`codex/new-brand-migration` points at up to Phase 3. **Nothing is pushed.**

| Commit | What | State |
|---|---|---|
| `7debce4` | The seven approved additions, as D31-D37 | done |
| `b45790f` | 1. The scheduled command, its lock, its isolation proofs | done, `verify:scheduled` 6/6 |
| `b414eaa` | 2. Local-day arithmetic | done, in `verify:aggregates` |
| `5f6ced7d` | 3. Search events, Arabic normalization, the PII scrub | done, `verify:search` 9/9, 4 browser legs |
| `5b3e305` | 4. The acquisition ladder and the D24 session-touch fix | done, `verify:acquisition` 8/8 |
| `c82a3f2` + `196995d` | 5. Aggregates, the three stages, D33's two routes | done, `verify:aggregates` 18/18 |
| — | **6. Retention, privacy requests, the platform console** | **in progress** |
| — | 7. Health counters reaching the metric table (D34) | not started |
| — | 8. The movable link builder (D37) | not started |
| — | 9. Verification scripts and the acceptance record | not started |

**Where commit 6 stopped.** `lib/analytics/retention.ts` is written — every §4.7 window,
chunked deletes by primary key, a dry run that counts and deletes nothing — and its four env
vars are wired into `lib/env.ts` and `.env.example`. It is **not yet registered as a stage** in
`scripts/analytics-scheduled.ts`, and nothing calls it, so it has never run.

Still owed by commit 6:

1. Register a `retention` stage (and make `--dry-run` reach it).
2. `lib/analytics/privacy-request.ts`: export and erase one visitor's data, reusing
   `forgetOrderAttributionLinks()` so orders are detached and kept (P3-25).
3. **An unresolved design question**: §4.7 says cookie settings expose "a privacy identifier",
   and the only identifier a shopper can currently see is `AnalyticsConsentReceipt.publicRef` —
   which identifies a consent DECISION and has no link to `AnalyticsVisitor`. So a privacy
   request quoting it cannot resolve the visitor's data. The intended fix is to expose the
   analytics **visitor id** (already in a signed cookie, already that visitor's own) on
   `/privacy` beside the reference, and have the console accept it. Decide this before building
   the console, because it changes what the console takes as input.
4. The platform-admin console (D36) at `/platform/stores/[slug]`, plus an `AnalyticsAuditLog`
   table (§9.3) — which does not exist yet — for the "every use is audit-logged" half of P4-26a.
5. Checks P4-24, P4-24a, P4-25, P4-26, P4-26a, P4-27 in a new `scripts/verify-retention.ts`.

**Known environment gotchas hit so far**, both worth remembering:

- Killing `prisma migrate dev` leaves a connection holding Prisma's own migration advisory lock;
  every later migration then times out at 10s until that backend is terminated
  (`SELECT pg_terminate_backend(<pid>)`).
- A verification script must not call `process.exit()` on Windows: exiting while a pooled socket
  is still closing trips a libuv assertion and the run reports failure after every check passed.

## 1. Scope

### In scope

1. **Search events** — a submitted search, a stabilized no-result query, a result click, with
   server-side normalization and PII scrubbing (§3.6).
2. **Acquisition** — the §3.5 classification ladder, a referring hostname, first touch and last
   **non-direct** touch, both actually maintained.
3. **Tracked-link builder** — an owner page that produces a UTM-tagged URL (§5.5).
4. **Aggregate tables** — `AnalyticsDailyMetric`, `AnalyticsHourlyMetric`,
   `AnalyticsProductDaily`, `AnalyticsSearchDaily`, `AnalyticsAcquisitionDaily`, plus
   `AnalyticsAggregationCursor` and `AnalyticsOperationalMetric` (§9.3).
5. **Store-timezone reporting** — UTC storage, local business day (§3.7).
6. **`pnpm analytics:scheduled`** — one idempotent command under an advisory lock (§10).
7. **Retention** — the §4.7 windows, deleted in bounded chunks.
8. **Privacy requests** — export and delete a visitor's data, detaching but preserving orders.
9. **Contract rejections (400s) as their own health signal**, with their own threshold.
10. **A platform-admin privacy-request console** (**D36**) and a **retention dry run** (**D35**).

### Explicitly NOT in this phase

- **Any report UI.** Aggregates are written and verified by query; Phase 5 renders them. The one
  new owner-facing page is the link builder, which reads nothing.
- **Push notifications and alert delivery.** Phase 4 produces the *signals* and persists them;
  Phase 6 sends and cools them down.
- **The heatmap**, insights, and the platform console (Phase 5).
- **ROAS or any spend-derived metric.** §3.5 is explicit: no ad spend, no ROAS.
- **Campaign management.** The link builder outputs a URL; no campaign table (§5.5).

## 2. Decisions needed before coding

| # | Question | Proposed answer |
|---|---|---|
| **D21** | When is a search event emitted? | `SEARCH_SUBMITTED` on an actual submit (Enter, or the suggestion list being opened by a settled query), never per keystroke. A **no-result** event only once a query has been unchanged for ~800ms *and* returned 0 results, so "ni", "nik", "nike" is one no-result phrase, not three. `SEARCH_RESULT_CLICK` carries the product clicked. |
| **D22** | Where is a search query scrubbed, and does the raw text ever land in the database? | **Server-side, before the insert; the raw text is never persisted.** The browser sends what the shopper typed (it is already in the URL), and `lib/analytics/search-text.ts` normalizes (trim, collapse whitespace, lowercase, 80 chars) and redacts anything email-like, phone-like, card-like or otherwise long-digit-run-like to `[redacted]` — the whole value, not the matching part, because a partially masked string is still a person's details. Redacted rows count toward searches and are excluded from stocking suggestions. The contract gains one optional `searchQuery` field; the envelope stays `.strict()`, so this is additive and no schema version bump is needed. |
| **D23** | How is a source classified? | Server-side, in a new `lib/analytics/attribution.ts`, by §3.5's ladder: explicit UTM → ad-click marker → recognized social/search referrer → other external referrer → direct. The session gains `referrerHost` and a classified `sourceKind`, so a report never has to re-derive a classification from loose strings and two reports can never disagree about what "direct" means. |
| **D24** | What does "last non-direct touch" mean inside a live session? | Today it means nothing: `lib/analytics/ingest.ts` writes the touch **only when the session row is created** and never revisits it, so a visitor who arrives direct and then returns through a campaign link keeps `source = null` for the whole 30-minute session. Phase 4 updates the session's touch when a later batch carries a **non-direct** one, and never overwrites a real source with a direct visit. This is a behaviour fix, not an addition, and it gets its own commit and its own check. |
| **D25** | How are aggregates computed? | **Recompute a window, never accumulate deltas.** Each run upserts the current and previous local day (and the hours within them) from the raw events, which makes late events, retried beacons and order-status changes self-correcting and the whole job safely re-runnable. `AnalyticsAggregationCursor` records how far each tenant is done, per stage. No row is ever incremented in place. |
| **D26** | Which day does an event belong to? | The store's day. Timestamps stay UTC; every aggregate row carries a `localDay` (a DATE) **and** the IANA zone it was computed in, so a tenant changing timezone is visible rather than silently rewriting history. Boundaries come from `Intl.DateTimeFormat` with the tenant's zone — not from the server's clock, and never from a viewer's device (§3.7). |
| **D27** | What guarantees one scheduled run at a time? | A PostgreSQL advisory lock taken for the whole command, plus a per-stage lease and status row. A second invocation exits immediately and says so. Tenants are processed in bounded batches, and a failure in one tenant's stage must not abort the others. |
| **D28** | What does a privacy deletion delete? | Visitor, sessions and raw events for that visitor; orders are **kept** and only detached, via the existing `forgetOrderAttributionLinks()` (P3-25). Aggregates are not touched: they are genuinely anonymous totals and §4.7 says to preserve them. Deletion runs in bounded chunks and reports what it removed. |
| **D29** | How are contract rejections (400s) surfaced? | As a **third category**, next to policy and operational drops, with its own much lower threshold. A 400 is not load and not consent: it means our own code sent something the contract refuses, so a single-digit count in a window is already a bug. `lib/analytics/health.ts` already counts `invalidEnvelopes` and the endpoint already logs the failing field; Phase 4 flushes the counter into `AnalyticsOperationalMetric` and evaluates it separately. Folding it into the operational percentage would hide exactly the Phase 3 defect where every batch from a custom domain was refused and the operational rate stayed at zero. |
| **D30** | Where does the link builder live? | `/admin/analytics/links`, client-side only: it composes a UTM-tagged URL from the store's own domain or shared-host base and copies it. It writes nothing and reads no analytics, so it cannot be the reason a report is wrong. |
| **D31** | How is Arabic search text normalized? | In `search-text.ts`, before anything else: unify the alef forms (أ إ آ ٱ → ا), ة → ه, ى → ي, strip tashkeel (U+064B–U+0652, U+0670) and tatweel (U+0640), and fold Arabic-Indic digits (U+0660–U+0669) and extended Arabic-Indic digits (U+06F0–U+06F9) to ASCII. Without it, one Arabic word spelled two ordinary ways is two phrases, and a store whose shoppers type Arabic gets its search report split across spellings — which is most of this platform's stores. Normalization groups; the normalized form is also the stored form, since the raw text is never kept (**D22**). |
| **D32** | Does the PII scrub understand Arabic digits and Lebanese numbers? | Yes, and it has to, or the scrub is theatre here: a phone number typed in Arabic-Indic digits sails straight through an ASCII-only pattern. Digits are folded first (**D31**), so one set of patterns covers both scripts. Lebanese formats explicitly: `+961` and `00961` prefixes, the `03` / `70` / `71` / `76` / `78` / `79` / `81` mobile prefixes, 7–8 local digits, with spaces, dashes and slashes ignored while matching. Covered by **P4-11**. |
| **D33** | How does a cancellation a week later correct its day? | Two mechanisms, because one is not enough. Each run recomputes any local day touched by an order whose **`updatedAt`** falls in the window (not its `createdAt`), so a status change pulls its own older day back into the queue; and a nightly pass recomputes the **last 30 days** outright. Cash on delivery means a cancellation routinely lands days after the order, and D25's current-and-previous-day window would otherwise leave a permanently wrong number in a chart nobody can explain. Tested with a cancellation a week after the order (**P4-20a**). |
| **D34** | How do per-process counters reach `AnalyticsOperationalMetric`? | **The process that owns them writes them; the scheduler only reads.** The counters in `lib/analytics/health.ts` live in one Next process's memory, and the scheduled command is a different process in a different container — it cannot see them, and an internal endpoint would reach one arbitrary instance behind the proxy. So the ingestion endpoint flushes opportunistically: when a batch arrives and the window is older than `ANALYTICS_HEALTH_FLUSH_MINUTES` (default 5), it snapshots with `reset`, writes one row keyed by instance (`hostname:pid`) and window, and does so after the response, best-effort, never awaited — a drop that costs an INSERT is not a drop. The scheduler then evaluates persisted rows across instances. An instance with no traffic writes no row, so "no rows" means silence, not failure, and the alert must not confuse the two (**P4-31a**). |
| **D35** | Can retention run without deleting anything? | Yes, and the first production run must. `analytics:scheduled --dry-run`, and `ANALYTICS_RETENTION_DRY_RUN` for the scheduled container, counts exactly what each window would delete per tenant and per table, records it on the run, and deletes nothing. The first thing this project does that destroys data should say what it is about to destroy first; a deletion count that surprises us is a bug caught for free. The acceptance record carries the dry-run numbers, and the live run is enabled only after they are read. |
| **D36** | Who can act on a privacy request? | The platform admin, from `/platform/stores/[slug]`: paste the visitor's privacy identifier (the one the cookie settings expose, §4.7), see what would be exported or erased, then do it. Store owners do not get this. A privacy request is a controller obligation that arrives by email to the platform, and an owner must not be able to erase a visitor's trail on a whim. Every use is written to `AnalyticsAuditLog`. |
| **D37** | How is the link builder built so Phase 5 can move it? | As a self-contained client component, `components/analytics/link-builder.tsx`, taking the store's base URL and its labels as props and holding no routing, layout or data loading of its own. Phase 4 mounts it at `/admin/analytics/links`; Phase 5's Marketing section mounts the same component in a tab and the Phase 4 route becomes a redirect. Nothing in it may reach for `usePathname`, a page layout or a server action, or moving it will mean rewriting it (**P4-35** proves the property by mounting it twice). |

## 3. Data model

### 3.1 New tables (§9.3)

| Table | Grain | Notes |
|---|---|---|
| `AnalyticsDailyMetric` | tenant × localDay | Sessions, visitors, funnel step counts, website orders and value, WhatsApp click sessions and potential value — the two money figures in separate columns, never summed (P3-04). |
| `AnalyticsHourlyMetric` | tenant × localDay × hour | Same shape, narrower, for the day's shape. |
| `AnalyticsProductDaily` | tenant × localDay × productId | Views, cart adds, purchasing sessions, WhatsApp clicks. |
| `AnalyticsSearchDaily` | tenant × localDay × normalized phrase | Searches, no-result count, result-click sessions. Carries a `wasRedacted` flag so a redacted phrase is countable but never suggested. |
| `AnalyticsAcquisitionDaily` | tenant × localDay × sourceKind × source × medium × campaign | First-touch and last-non-direct columns side by side, for §5.5's switch. |
| `AnalyticsAggregationCursor` | tenant × stage | Last successful run, lease holder and expiry, failure count and last error. |
| `AnalyticsOperationalMetric` | instance × window | The flushed health snapshot: attempts, accepted, policy drops, operational drops, **and contract rejections as their own column** (D29). |

Every tenant-scoped table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and the same
`tenant_isolation` policy as its siblings. `AnalyticsOperationalMetric` is **not** tenant-scoped
— it is per instance, read only by the platform admin through the existing narrow bypass.

### 3.2 Changes to existing tables

- `AnalyticsSession`: add `referrerHost`, `sourceKind`, and the first-touch trio already on
  `AnalyticsVisitor` stays the first-touch source of truth.
- `Tenant`: **nothing to add.** `analyticsTimezone` has been there since Phase 1 (default
  `Asia/Beirut`, from `PLATFORM_TIMEZONE` for new stores) and no code reads it yet. Phase 4 is
  where it starts deciding where a day begins.
- `AnalyticsEvent`: no new columns. `searchQuery` and `resultCount` already exist and are
  waiting (`ingest.ts` currently hardcodes `searchQuery: null`).

## 4. New modules

| File | Purpose |
|---|---|
| `lib/analytics/search-text.ts` | Normalize and PII-scrub a query (**D22**). Pure, so it can be unit-verified without a database. |
| `lib/analytics/attribution.ts` | The §3.5 ladder and the social/search referrer table (**D23**). Pure. |
| `lib/analytics/local-day.ts` | Local day and hour boundaries for a tenant's zone (**D26**). Pure. |
| `lib/analytics/aggregate.ts` | Recompute a tenant's window into the five aggregate tables (**D25**). |
| `lib/analytics/retention.ts` | The §4.7 windows, chunked (**D28**). |
| `lib/analytics/privacy-request.ts` | Export and delete one visitor's data, detaching orders (**D28**). |
| `scripts/analytics-scheduled.ts` | The single command, the advisory lock, the stage dispatch (**D27**). |
| `components/analytics/link-builder.tsx` | The builder itself, self-contained so Phase 5's Marketing section can mount it unchanged (**D37**). |
| `app/admin/(panel)/analytics/links/*` | The Phase 4 route that mounts it (**D30**). |
| `app/platform/(admin)/stores/[slug]/privacy-request-control.tsx` | The platform admin's entry point for an export or an erasure (**D36**). |

## 5. Commit sequence

Independence and deletion safety first, as in Phase 3 — a check that can only pass is not a
check, so each of these is proven by a forced failure before the thing it protects is built on.

1. **The scheduled command's skeleton, its lock, and its proof of isolation.** Two concurrent
   invocations; a storefront order placed while a run is in progress; a run that throws
   mid-stage. Nothing built on top of it yet.
2. **Local-day arithmetic and the timezone column.** Verified across a DST transition and
   midnight in a non-UTC zone before any aggregate depends on it.
3. **Search events**, with scrubbing, on the server, plus the contract's optional field.
4. **Acquisition classification**, including the **D24** behaviour fix for a live session.
5. **The aggregate tables and the recompute**, including a late event and a cancelled order
   correcting a day that was already aggregated.
6. **Retention and privacy requests** — dry run first (**D35**) — including the order-detaching path and the platform-admin console (**D36**).
7. **Contract rejections as their own signal** (**D29**), flushed and evaluated separately.
8. **The tracked-link builder**, as a movable component (**D37**).
9. **Verification scripts and the acceptance record.**

## 6. Acceptance checklist

Numbered P4-xx, run the way Phase 3's were: a `verify:*` script for anything a static or
HTTP-level check can prove, and a browser leg for anything that only a real page can.

**Every browser leg runs on a custom domain as well as the shared host, and a leg that cannot
run fails** — the policy from 2026-11-04, enforced by `pnpm verify:e2e-policy`. Phase 4 also
clears the nine suites still listed in that script's `PENDING_LEG`, or hands them to Phase 7
with a reason.

### Scheduled work cannot touch the storefront

| # | Item |
|---|---|
| P4-01 | Two concurrent `analytics:scheduled` runs: the second exits immediately, having changed nothing. |
| P4-02 | A checkout completes normally, and in comparable time, while a full run is in progress. |
| P4-03 | A stage that throws leaves the other stages' results intact and records its own failure. |
| P4-04 | An expired lease is recovered by the next run, not left blocking forever. |
| P4-05 | A run with the analytics tables unreadable fails loudly and leaves the storefront untouched (the Phase 3 fault injection, from the other side). |

### Time

| # | Item |
|---|---|
| P4-06 | An event at 23:30 local lands on the local day, not the UTC one, for a store in `Asia/Beirut`. |
| P4-07 | A DST transition produces no missing and no duplicated hour. |
| P4-08 | Changing a store's timezone does not silently rewrite past aggregate rows. |

### Search

| # | Item |
|---|---|
| P4-09 | Typing "nike" character by character emits one `SEARCH_SUBMITTED`, not four. |
| P4-10 | A query that returns nothing emits exactly one stabilized no-result event. |
| P4-11 | An email address, a phone number and a card-like string are each stored as `[redacted]`, and the raw text appears nowhere in the database — **including a Lebanese mobile number in Arabic-Indic digits, with and without the +961 prefix, spaced and dashed** (**D32**). |
| P4-11a | Arabic spellings of one word normalize to one phrase: alef forms, ة/ه, ى/ي, tashkeel, tatweel, Arabic-Indic digits (**D31**). |
| P4-12 | A redacted phrase still counts as a search and never reaches a stocking suggestion. |
| P4-13 | A result click records the product that was clicked. |

### Acquisition

| # | Item |
|---|---|
| P4-14 | Each rung of the §3.5 ladder classifies as specified, including a gclid with no UTM, and a referrer from a social host. |
| P4-15 | A direct visit after a campaign visit does not erase the campaign (**D24**), and a campaign visit after a direct one does become the last non-direct touch. |
| P4-16 | First touch survives on the visitor across sessions while last touch changes. |
| P4-17 | No raw click id and no full referring URL is stored anywhere. |

### Aggregates

| # | Item |
|---|---|
| P4-18 | Running the aggregation twice produces identical rows (idempotent upserts). |
| P4-19 | An event arriving late for yesterday corrects yesterday's row on the next run. |
| P4-20 | Cancelling an order corrects the day's order count and value, and leaves the conversion in the funnel (P3-05's rule, now in an aggregate). |
| P4-20a | A cancellation **a week after** the order corrects that older day, by both routes: the `updatedAt` sweep and the nightly 30-day recompute (**D33**). |
| P4-21 | Daily totals reconcile exactly against the raw events for the same local day. |
| P4-22 | Website order value and potential WhatsApp value are never summed into one figure by any aggregate or helper. |
| P4-23 | An aggregate read from the wrong tenant returns nothing, as `app_user`, with RLS doing the refusing. |

### Retention and privacy

| # | Item |
|---|---|
| P4-24 | Each §4.7 window deletes what it should and nothing else, in bounded chunks. |
| P4-24a | `--dry-run` reports counts per tenant and per table and deletes **nothing**, proven by row counts either side of it (**D35**). |
| P4-25 | Retention deleting a visitor's sessions leaves orders intact, with attribution dimensions kept and the session key cleared (P3-18 + P3-25, now exercised by the real job). |
| P4-26 | A privacy export contains that visitor's data and no other visitor's. |
| P4-26a | The platform admin can export and erase from `/platform/stores/[slug]`, a store owner cannot reach it at all, and every use is audit-logged (**D36**). |
| P4-27 | A privacy deletion preserves aggregate totals, because they are anonymous (§4.7). |

### Health signals

| # | Item |
|---|---|
| P4-28 | A forced contract rejection raises the 400 signal **alone**: the operational drop rate stays at zero (**D29** — the Phase 3 defect, as a regression test). |
| P4-29 | A forced pool exhaustion raises the operational rate and leaves the 400 count at zero. |
| P4-30 | A refused-consent batch raises neither. |
| P4-31 | A flushed snapshot resets its window so two windows cannot overlap. |
| P4-31a | A snapshot written by the ingesting process is readable by a second process, is keyed by instance, and an instance that received no traffic writes no row (**D34**). |

### Regression

| # | Item |
|---|---|
| P4-32 | `verify:commerce`, `verify:coupons`, `e2e:checkout` still pass. |
| P4-33 | `verify:ingestion`, `verify:consent`, `verify:commerce-analytics`, `e2e:consent`, `e2e:analytics` still pass. |
| P4-34 | `verify:e2e-policy`, `lint` and `typecheck` are clean, with the lint baseline still at zero. |
| P4-35 | The link builder renders and copies a correct URL mounted at a second, unrelated path — the property Phase 5 depends on (**D37**). |

## 7. Risks

- **A deletion job is the first thing in this project that can destroy data.** Mitigation: the
  retention commit lands with its checks, chunk sizes are bounded, and every window is proven on
  rows created by the test itself. Nothing in Phase 4 deletes an `Order` row, ever.
- **Aggregates that disagree with orders** would make Phase 5 untrustworthy at the first glance a
  merchant takes. Mitigation: P4-21 reconciles against the raw events and P3-01's rule stands —
  order money comes from orders, and analytics stores no second copy of it.
- **The timezone is the quiet one.** A day boundary that is wrong by a few hours is invisible in
  totals and wrong in every daily chart. Mitigation: P4-06 to P4-08, and the zone stored on each
  aggregate row.
- **D24 is a behaviour change to live collection**, so sessions written before it and after it
  mean subtly different things by `source`. It is small enough to carry a note in the acceptance
  record rather than a migration.

## 8. What "Phase 4 complete" means

Every P4 item passes; `ANALYTICS_ROLLOUT_MODE` is still `off`; the scheduled command is
documented for Dockploy but not yet scheduled in production; and no report has been written —
Phase 5 reads what this phase computes, and will find that every number in it can be derived
twice and agree.
