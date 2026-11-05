# Phase 5 — Marketing, merchant reports, and the platform console

Plan for [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md) §13's
Phase 5, drawing on §5 (merchant and platform UX), §6 (insights) and §10's reporting rules — plus
two additions agreed before this plan was written:

1. **A single Marketing section** in the owner's admin — campaigns, tracked links, integrations,
   results — instead of the same work scattered across settings and analytics.
2. **Owner self-service marketing integrations**: the owner connects their own Google and Meta
   accounts, which today only a platform admin can do.

**Not a release.** §13 holds the launch until Phase 7. `ANALYTICS_ROLLOUT_MODE` stays `off`.

This is the phase where the work of Phases 1–4 becomes something a merchant looks at, which
changes the main risk. The previous phases could lose or mis-record data; this one can present
accurate data in a way that leads someone to a wrong decision. A number with no denominator, a
trend drawn from nine sessions, or WhatsApp intent sitting in the same column as revenue would
all be "working software" and still cost a merchant money.

## 0. Progress

| Commit | What landed | State |
|---|---|---|
| 1 | `lib/analytics/report.ts`, `lib/analytics/compare.ts`, `scripts/verify-reports.ts` (18 checks). The read layer and the rules that stop it misleading anyone: aggregate-only enforced by walking report.ts's own imports, day ranges proven across Beirut's 23- and 25-hour days, null rates instead of zeros, a trend that refuses to judge below its sample floor, the two money figures kept apart, and an empty funnel step shown as zero. No UI. | done |
| 2 | **Was commit 3**, brought forward: `20261106120000_report_columns` and the recompute that fills it. D44's product-name snapshot (which survives a later recompute, or the nightly pass would erase the name of every product deleted in the last month), D48a's per-product viewers, D48's four per-source columns, and D49's `visitorDays` rename. Also a bug this work exposed: `AnalyticsAcquisitionDaily.whatsappClickSessions` was initialised to 0 and never assigned, so every campaign would have reported no WhatsApp clicks. `verify:reports` is 23 checks. | done |
| 3 | `insights.ts` and `scripts/verify-insights.ts` (14 checks) — **was commit 2**. Swapped, because §6's "frequently revisited product" needs the columns above; writing the rule first would have meant writing it against data that did not exist. All eight rules, every threshold in `INSIGHT_THRESHOLDS` as a named number, each exercised at the line and one below it. Pure: the check asserts it imports the report layer for types only. One reconciliation — the activity-shift insight re-uses `compare.ts`'s verdict rather than applying §6's numbers separately, so `TREND_RULES.sessions` is now §6's 20-across-the-comparison and a tile cannot say "not enough evidence" beside an insight claiming a shift. | done |
| 4 | The Marketing section's shell and **Integrations** (D40, D40a). `lib/integrations-guide.ts` (structure) with EN/AR text in the dictionaries, per-key snippet extraction in `lib/integrations.ts`, `lib/analytics/audit.ts` as the single audit writer, the owner's route, and the platform admin's writes logged in the same shape. `LinkBuilder` moved into the section unchanged and the Phase 4 route is a redirect (P5-15). `verify:integrations` is 12 checks, `verify:permissions` now 17. | done |
| 5 | **Campaigns and Tracked links** (D39). `MarketingCampaign` (tenant-scoped, forced RLS, no numeric column), `lib/data/campaigns.ts` with the saved-plus-observed merge, the Campaigns tab, and "save this campaign" in the link builder — passed in as a prop, so the component still holds no action of its own. `lib/utm.ts` is now the one slug rule the browser and the server share. `verify:campaigns` is 10 checks; `verify:isolation` 16, `verify:permissions` 18, `verify:aggregates` counts 20 protected tables. P5-13, P5-14 and P5-15 pass. | done |
| 6 | **Marketing Results** (D38, P5-19), the first screen built on `report.ts`. Campaign rows from `campaignResults` — no second source of truth — with visits, orders, order value, WhatsApp messages and “basket at the message” in separate columns, and an unmeasured figure reading as unknown rather than zero (D48). `lib/analytics/range.ts` is now the one set of store-local periods, shared by Results and Campaigns; `components/admin/period-picker.tsx` puts it in the URL. The section opens on Results. `verify:campaigns` 13, `verify:permissions` 19. P5-12 and P5-19 pass. | done |
| 7 | **The analytics reports**: Overview (with §6's insights), Products, Funnel, Acquisition, Searches, Heatmap. Tables first with the bars drawn inside them, one measure per grid, a period in the URL, and the freshness line that keeps zeros from reading as fact. `verify:report-ui` is 9 checks through a real owner session — including D47's refusal: `/admin/*` is 404 on a store's own domain, proven over a socket with a chosen Host header. P5-02, P5-03, P5-05, P5-06, P5-07, P5-09, P5-19 and P5-20 pass. | done |
| 8 | **The platform console** (D43): `/platform/analytics`, aggregate-only and audit logged. `lib/data/platform-analytics.ts` reads the daily aggregates and the operational counters across stores through `withBypass`; §5.8's growing/declining/inactive are `compare.ts`'s verdict, so the console and the owner's own overview cannot disagree about a week. Every view writes one `PLATFORM_CONSOLE_VIEW` row naming the admin and the period. `verify:platform-console` is 7 checks (P5-21 to P5-24, D43, D47). | done |
| 9 | **States, accessibility and Arabic.** `components/admin/analytics/data-table.tsx` generates the desktop table and the phone cards from one column definition (P5-31); the “nothing measured yet” state replaces the tiles rather than showing zeros as fact (P5-25); the live-visitor tile reads “temporarily unavailable” when Redis cannot answer (P5-27). `verify:report-states` is 9 checks (P5-25 to P5-31, P5-34). Two bugs fixed on the way: a dead Redis crashed the request with an uncaughtException and hung it for five minutes, and verify:consent's P1-04 matched a component name rather than its import. | done |
| 10 | **Verification scripts and the acceptance record.** Every suite from Phases 1–4 re-run against this branch, plus the five new ones; [PHASE_5_ACCEPTANCE.md](PHASE_5_ACCEPTANCE.md) records all 34 items with their evidence and the six bugs the verification found. Two of those were checks matching text rather than behaviour, and both are fixed. | done |

Three defects commit 4 found, all fixed in it: the storefront passed **every** advertising id to
the browser and relied on the client to ignore the ungranted ones (so a visitor who declined had
the pixel id in their page props); `extractIntegrationValue` refused a lower-case `g-abc123`,
which is how people type their own id; and `verify:permissions`' static guard could not see an
action that shares a role check through a helper, so it had been failing on Phase 4's privacy
actions since they landed.

Four gaps found by building rather than by planning, each recorded as a decision instead of
worked around: **D44**, **D48**, **D48a** and **D49**. The first three were missing columns; the
last was a column that existed and meant something other than its name.

## 1. Scope

### In scope

1. **The Marketing section** (`/admin/marketing`): Results, Campaigns, Tracked links,
   Integrations.
2. **Owner self-service integrations**: GA4, Meta Pixel, Google Ads (+ conversion label) and
   Search Console verification, set by the owner, with the platform retaining visibility.
3. **The analytics reports** (`/admin/analytics`): Overview, Products, Funnel, Acquisition,
   Searches, Heatmap (§5.1–§5.7).
4. **Deterministic insights** (§6) — thresholds as data, no model, cautious copy.
5. **The platform console** (`/platform/analytics`): aggregate-only store trends and system
   health, audit logged (§5.8).
6. **States and accessibility** (§5.9): table alternatives for every chart, mobile cards, RTL,
   full Arabic copy, and honest empty/degraded states.

### Explicitly NOT in this phase

- **Coupon per campaign** (an `EID20` code tied to a tracked link, and what it earned). Agreed
  as post-launch. One note below on keeping it cheap.
- **Shopper-facing push notifications** ("back in stock", "new offer"). Post-launch, and not to
  be confused with Phase 6's *merchant* push, which is a different audience and a different
  consent basis entirely.
- **Server-side conversion reporting** to Meta and Google (Conversions API / Enhanced
  Conversions). Post-launch.
- **Any write to the analytics tables.** Phase 5 reads. The only writes it adds are the owner's
  own integration settings, saved campaigns and audit rows.
- **Alert delivery.** Phase 4 evaluates the health signals; Phase 6 sends them.

## 2. Decisions needed before coding

| # | Question | Proposed answer |
|---|---|---|
| **D38** | Marketing and Analytics are two sections — where is the line? | **Marketing is what the owner DOES to get traffic and what came of it; Analytics is what happened in the store.** So Marketing holds campaigns, tracked links, integrations and campaign-level results; Analytics holds Overview, Products, Funnel, Acquisition, Searches and the heatmap. The one number that appears in both — a campaign's sessions and orders — is computed once, in one module, and Marketing's Results links through to Acquisition rather than restating the channel view. Two homes for one figure is how two screens come to disagree. |
| **D39** | What is a "campaign"? | **Observed first, saved optionally.** A campaign is a `utm_campaign` value seen in the data, so a report never depends on bookkeeping an owner forgot. But an area that shows nothing until the first click reads as broken, so building a link offers "save this campaign", which writes a thin `MarketingCampaign` row (name, channel, created, archived) holding **no numbers**. §5.5's "no campaign-management database in v1" stands in spirit: this stores what the owner made, never what it earned. |
| **D40** | Who owns the Google/Meta ids? | **The owner sets them; the platform admin can also edit or clear them, and every change is logged either way.** They are the owner's own advertising accounts, and needing a platform admin to paste a pixel id is what makes this feel like someone else's software. But the admin keeps full edit, not just a clear: the owner who cannot get a tag working will ask for help, and "I can see it is wrong and may only delete it" is a worse answer than fixing it. The power is made safe by the record, not by being withheld — so **every** integration write, owner's or admin's, appends an `AnalyticsAuditLog` row naming the actor, the field, and the before and after values (the ids are public identifiers that ship in page source; they are not secrets). On the store side, Integrations is owner-only: `requireOwner` on the page and on every action, no other role reaches it. Consent gating is unchanged — the tags still fire only with advertising consent (§2.2) and the tab says so in plain words — with one deliberate exception in **D40a**. |
| **D40a** | Do the verification tokens wait for consent? | **No, and that is not a loophole.** `google-site-verification` and `facebook-domain-verification` are static `<meta>` tags that prove ownership of a domain to Google and Meta. They set no cookie, send no request, and identify the site rather than the reader, so withholding them until consent would break verification for every visitor who declines while protecting nobody. They already render through the storefront layout's `metadata`, outside `lib/analytics.tsx` and therefore outside the consent gate; Phase 5 pins that with a check rather than leaving it as an accident. **Meta domain verification needs no new column** — `Tenant.metaDomainVerification` exists with a format already enforced twice (on save and again at render). What it needs is the explanation: Meta verifies a *domain*, so a store on its own domain must verify that domain, and the token Meta shows for `shop.example.com` does nothing on `/store/shop`. The guide says so, because this is the single most likely thing an owner gets wrong here. |
| **D41** | Where do report numbers come from? | **Aggregates only, never raw events.** This is the Phase 3 commitment P3-24 enforces, and Phase 5 is the phase that would break it. A report module reading `AnalyticsEvent` would turn a merchant screen into a person's browsing history; it would also scan a table retention empties at 90 days, so last year's chart would quietly go flat. The check stays, and a new one asserts no file under the report routes imports the event table. |
| **D42** | How are insights kept from being confidently wrong? | §6's thresholds live in **one pure module as data**, each insight carrying the evidence that produced it, and the UI prints that evidence next to the advice ("across 112 view sessions"). Below threshold there is no insight — not a weaker one. Copy says "may need attention", never a cause. A merchant who follows a confident recommendation drawn from nine sessions loses real money, and the apology costs more than the feature earned. |
| **D43** | What can a platform admin see? | **Aggregates across stores, and nothing about a person.** No visitor histories, no raw events, no search phrases attributable to a session. Every page view of `/platform/analytics` writes an `AnalyticsAuditLog` row (§5.8), reusing the table Phase 4 built. A store with too little traffic shows its real numbers and "Not enough activity for a reliable trend" instead of a trend. |
| **D44** | How do deleted products keep their names? | §5.3 requires a historical name and a "Deleted product" label, and `AnalyticsProductDaily` stores only a `productId` — a product deleted next month makes every past row unnameable. So the recompute **snapshots `productName` onto the aggregate row**, the way an order item snapshots what it sold. It names what the product was called *that day*, which is also the honest answer after a rename. Migration plus a backfill from the current products for rows that already exist. |
| **D45** | What does a date range mean? | **Store-local days, end-inclusive, resolved by `lib/analytics/local-day.ts`.** "Last 7 days" is seven local days ending today, and a comparison period is the seven before it — not 168 hours, which would silently shift on the 23- and 25-hour days this platform's default zone actually has. Every view carries the store's timezone indicator (§5.1). |
| **D46** | What does the funnel show when a step is missing? | The step, with zero, and the drop-off above it. A funnel that hides an empty step makes a broken storefront look like a narrow one. Website and WhatsApp paths stay visually separate and never share a monetary total (§5.4, and §3.4's rule that intent is not revenue). |
| **D48** | Acquisition is missing four of the columns §5.5 asks for. Where do they come from? | **From the aggregate, in commit 3, not from arithmetic in the view.** Found while writing `report.ts`: `AnalyticsAcquisitionDaily` holds sessions, first/last-touch orders and value, and WhatsApp click sessions — but §5.5 also asks for visitors, product viewers, cart sessions and potential WhatsApp value **per source**. Those cannot be derived from a store-wide total: apportioning 40 store visitors across three sources by their session share produces a number that is plausible, wrong, and impossible to notice. So the columns are added beside D44's migration (the recompute already groups by attribution, so it is the same query learning four more counts) and backfilled by the 30-day recompute. Until then the view shows what exists rather than what looks complete. |
| **D48a** | §5.3 wants returning viewers per product, and §6 a "frequently revisited product". From what? | **Two counted columns, not a ratio.** `AnalyticsProductDaily` had views and view sessions but no visitors, so "10 visitors plus a repeat-view rate" had nothing to stand on. `viewVisitors` and `returningViewVisitors` are added beside D44's name, and "returning" is read from the visitor's own `firstSeenAt` rather than from view count: two views in one afternoon is one interested person, not a returning one. |
| **D49** | What does "visitors" mean over a range? | **It does not mean visitors, so it is not called that.** `AnalyticsDailyMetric.visitors` is distinct visitors *that day*; summing it over a week counts Monday-and-Thursday's visitor twice. The report layer therefore exposes **`visitorDays`**, and the rate built on it is `newVisitorShareOfVisitorDays`. Nothing downstream can label it "visitors" by accident, and a view that needs true distinct visitors for a period must add a column to the aggregate rather than add up this one. `newVisitors` is exempt and stays a plain sum: a visitor is new on exactly one day. |
| **D47** | Does an admin-only browser suite need a custom-domain leg? | **No, and the exemption is written down rather than assumed.** `/admin` and `/platform` are refused on a store's own domain by `proxy.ts` (`PLATFORM_ONLY_PREFIXES`), so there is no custom-domain behaviour to test — unlike the storefront, where two phases of defects hid there. `verify:e2e-policy` gains an `ADMIN_ONLY` set with that reason, and a suite in it must prove the refusal instead: `/admin/marketing` on a store domain must not render. |

## 3. Data model

| Change | Why |
|---|---|
| `AnalyticsProductDaily.productName` | **D44.** A snapshot, so a deleted product can still be named in last month's report. |
| `MarketingCampaign` | **D39.** `tenantId`, `name`, `utmCampaign` (normalized), `channel`, `destinationPath`, `createdAt`, `archivedAt`. Tenant-scoped, forced RLS, like every other store-owned table (P4-23a will check it). Holds no numbers. |
| `Tenant` | Nothing new. Every field exists already — `gaMeasurementId`, `googleAdsId`, `googleAdsPurchaseLabel`, `metaPixelId`, `googleSiteVerification` and `metaDomainVerification` (**D40a**). D40 is about who may write them and what is recorded, not about new columns. |
| `AnalyticsAuditLog` | Nothing new. Phase 4 built it; Phase 5 writes `REPORT_VIEW` rows from the platform console, reads the table in it, and adds `INTEGRATION_CHANGE` rows for **D40**. Worth being explicit: the owner cannot read this log — the table is deliberately outside RLS because it is evidence *about* a store rather than data belonging to it, so an owner cannot edit or erase the record of their own change. That is the point of logging it. |

## 4. New modules

| File | Purpose |
|---|---|
| `lib/analytics/report.ts` | Every number any report shows, read from aggregates (**D41**), one function per view, each taking a tenant and a local-day range. |
| `lib/analytics/compare.ts` | Period-over-period arithmetic and the "not enough activity" rule (**D43**, **D45**). Pure. |
| `lib/analytics/insights.ts` | §6's rules and thresholds as data, returning an insight plus its evidence (**D42**). Pure. |
| `lib/data/campaigns.ts` | Saved campaigns, tenant-scoped through `withTenant` (**D39**). |
| `app/admin/(panel)/marketing/*` | The section: Results, Campaigns, Tracked links (mounting Phase 4's `LinkBuilder` unchanged), Integrations. |
| `lib/integrations.ts` | Extended, not replaced. `extractMetaContent` already pulls the value out of a pasted `<meta>` tag; **D40** adds the same for a pasted *base code* snippet (`gtag('config','G-…')`, `fbq('init','…')`, `AW-123/label`), so the column holds an id and never HTML or script text. The formats and the render-time re-validation stay exactly as they are. |
| `lib/integrations-guide.ts` | **D40.** The step-by-step setup text per integration, EN and AR, as data beside the formats rather than prose inside a component — so the Arabic is translated once and the steps cannot drift from the field they describe. Each ends in how to *check* it: Meta Pixel Helper for the pixel, Google Tag Assistant for GA4 and Ads, Search Console and Meta Business for the verification tokens. |
| `app/admin/(panel)/analytics/*` | Overview, Products, Funnel, Acquisition, Searches, Heatmap. |
| `app/platform/(admin)/analytics/*` | The aggregate-only console (**D43**). |
| `components/analytics/chart/*` | The chart primitives, each with its table alternative as a sibling, not an afterthought (**§5.9**). |

## 5. Commit sequence

Reading comes before rendering, and the rules that stop a report misleading someone come before
the charts that could.

1. **`report.ts` and `compare.ts`**, with the aggregate-only rule enforced and the local-day
   ranges verified across a DST boundary. No UI.
2. **`insights.ts`**, with every §6 threshold exercised at, just below and just above the line.
3. **The aggregate's two missing pieces**: D44's product-name snapshot and **D48**'s four
   per-source columns — one migration, one recompute change, one backfill, and checks that a
   deleted product still names itself and that visitors-per-source are counted, not apportioned.
4. **The Marketing section's shell and Integrations** (**D40**, **D40a**) — the owner's own ids,
   validated, extracted from whatever they paste, each with its EN/AR guide and a way to check
   it; the platform admin's edit-and-clear view; audit rows for every write, owner's or admin's.
5. **Campaigns and Tracked links** (**D39**), mounting `LinkBuilder` unchanged, which is the
   property P4-35 exists to protect.
6. **Marketing Results**, the first screen built on `report.ts`.
7. **The analytics reports**: Overview, Products, Funnel, Acquisition, Searches, Heatmap.
8. **The platform console** (**D43**), aggregate-only and audit logged.
9. **States, accessibility and Arabic** across everything built above — and this is a commit, not
   a pass at the end: a table alternative retro-fitted to a chart is always worse than one
   designed with it.
10. **Verification scripts and the acceptance record.**

## 6. Acceptance checklist

Numbered P5-xx. A browser leg for anything only a real page can prove; a `verify:*` script for
everything else. Admin-only suites are exempt from the custom-domain rule under **D47** and must
prove the refusal instead.

### The reports cannot mislead

| # | Item |
|---|---|
| P5-01 | No module under the report routes reads `AnalyticsEvent`; every figure comes from an aggregate (**D41**). |
| P5-02 | A store with 3 sessions sees the exact number 3, never a rounded or hidden one, and no trend judgment. |
| P5-03 | Website order value and potential WhatsApp value never appear in one total, in any view, including the overview tiles. |
| P5-04 | A day's figures in a report reconcile exactly with the same day's aggregate row, and with the orders behind it. |
| P5-05 | "Last 7 days" is seven **store-local** days, and a comparison is the seven before it, across a 23-hour and a 25-hour day (**D45**). |
| P5-06 | A funnel step with zero sessions is shown as zero, with its drop-off, not omitted (**D46**). |
| P5-07 | A deleted product still shows its historical name and a "Deleted product" label (**D44**). |

### Insights

| # | Item |
|---|---|
| P5-08 | Each §6 insight fires at its threshold and not one session below it. |
| P5-09 | Every insight shown carries the evidence that produced it. |
| P5-10 | With no qualifying insight, the UI says there is not enough evidence — and offers no weaker guess. |
| P5-11 | No insight copy asserts a cause; the top-product line states which measure it leads by. |

### Marketing

| # | Item |
|---|---|
| P5-12 | One section holds campaigns, tracked links, integrations and results, and nothing marketing-shaped is left in settings or analytics (**D38**). |
| P5-13 | A campaign saved while building a link appears in Campaigns **before** any traffic arrives, and shows zeros rather than nothing (**D39**). |
| P5-14 | A campaign that exists only in the data (never saved) still appears in Results. |
| P5-15 | `LinkBuilder` is mounted in Marketing **unchanged** — the Phase 4 route is a redirect (P4-35's property, now used). |
| P5-16 | An owner sets their own GA4, Meta and Ads ids, and they take effect on the storefront only with advertising consent (**D40**). |
| P5-17 | A malformed id is refused with a message naming the expected shape, not saved and silently dead. |
| P5-18 | A platform admin can see, **edit** and clear every store's ids, and each of those writes an audit row naming the admin, the field, and the old and new values (**D40**). |
| P5-18a | Every integration write appends exactly one `AnalyticsAuditLog` row — owner's as well as admin's — and the owner has no route that reads or deletes it. |
| P5-18b | Integrations is owner-only: the page and every action refuse any other role, and the static check that every server action verifies its role covers them (`verify:permissions`). |
| P5-18c | A pasted `<meta>` tag, a pasted GA4/Meta base-code snippet, and an `AW-123/label` pair each save the id alone — read the column back: no `<`, no `script`, no `fbq`. What cannot be parsed is refused with the expected shape, never stored raw. |
| P5-18d | `facebook-domain-verification` and `google-site-verification` render in the storefront head **with consent declined**, and on the store's own domain as well as the shared host (**D40a**). The pixel and GA4 tags, in the same page, do not. |
| P5-18e | Each integration carries step-by-step setup text in English and Arabic, and names the tool that checks it (Meta Pixel Helper, Google Tag Assistant). The Meta domain-verification guide states that verification is per domain and that a store on its own domain must verify that domain. |
| P5-19 | Results answers "which source brought visitors, orders and WhatsApp clicks" for a period, with the three kept separate — visitors per source **counted** by the recompute, never apportioned from a store total (**D48**). |
| P5-20 | Searches shows what shoppers wanted and did not find, with redacted phrases counted but never suggested (P4-12's flag, now honoured in UI). |

### Platform console

| # | Item |
|---|---|
| P5-21 | No person-level data is reachable: no visitor, no session list, no raw event, by URL or by API. |
| P5-22 | Growing / declining / inactive follow §5.8's definitions, and a small store gets "not enough activity" instead of a trend. |
| P5-23 | Every view of the console writes an audit row naming the admin (**D43**). |
| P5-24 | A store owner cannot reach `/platform/analytics` at all. |

### States, accessibility, bilingual

| # | Item |
|---|---|
| P5-25 | No consented traffic: the page explains how measurement begins rather than showing zeros as fact. |
| P5-26 | A store with traffic but no orders still shows traffic, WhatsApp, products and searches. |
| P5-27 | Redis down: "Live visitor count temporarily unavailable", never zero (P2-27's rule, now in UI). |
| P5-28 | Aggregation delayed: the last successful update is shown, with its age. |
| P5-29 | Every chart has a table alternative reachable by keyboard and readable by a screen reader. |
| P5-30 | Every new screen renders in Arabic, RTL, with no clipped or overflowing text at 375px. |
| P5-31 | Dense tables become ranked cards on a phone, with the same numbers. |

### Regression

| # | Item |
|---|---|
| P5-32 | Phases 1–4's suites all pass, `verify:e2e-policy` included. |
| P5-33 | `lint` stays at zero and `typecheck` is clean. |
| P5-34 | `/admin/marketing` and `/platform/analytics` are refused on a store's custom domain (**D47**). |

## 7. Risks

- **The one with real money attached: a confident wrong recommendation.** Mitigated by D42 —
  thresholds as data, evidence shown beside every insight, and no weaker insight below the line.
  This is the risk worth slowing down for.
- **Two screens, one number, two answers.** D38's boundary and a single `report.ts` exist for
  this. The check that matters is P5-04: reports reconcile against the aggregates and the orders.
- **Owner-set integration ids are a foot-gun.** A wrong pixel id breaks only that owner's own
  tracking, silently. Format validation catches the typos; P5-17 makes the refusal legible. A
  live "is your tag firing" test is deliberately out of scope — it cannot be done honestly from
  the server.
- **Scope.** This is the largest phase by surface area. The sequence puts the rules first on
  purpose: if time runs short, the honest cut is fewer charts, never fewer guard rails.

## 8. Keeping the post-launch work cheap

Agreed as after-launch, and worth one note each so Phase 5 does not make them expensive:

- **Coupon per campaign.** Nothing is needed now. An order already snapshots both its coupon
  (`couponCodeSnapshot`) and its attribution (`attributionCampaign`), so "what did EID20 earn on
  the Instagram campaign" is already answerable from data Phase 3 stores — the post-launch work
  is a screen, not a migration. Phase 5 should avoid making `couponCodeSnapshot` unreachable
  from the report layer.
- **Shopper push notifications.** Keep the *shopper's* consent story separate from the merchant
  push Phase 6 builds: different audience, different legal basis, and a different subscription
  table. Phase 5 touches neither.
- **Server-side conversion reporting.** This needs an order's value and its attribution in one
  server-side place, which `report.ts` will already have. Phase 5 should keep that module free of
  UI concerns so a future job can call it.

## 9. What "Phase 5 complete" means

Every P5 item passes; `ANALYTICS_ROLLOUT_MODE` is still `off`; a merchant can answer "where did
my visitors come from, what did they want, and what did it earn" from one section; a platform
admin can see every store's health without being able to see a single person; and no screen in
the product shows a trend, a rate or a recommendation that the data underneath it cannot support.
