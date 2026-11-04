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
| **D40** | Who owns the Google/Meta ids? | **The owner.** They are the owner's own advertising accounts, and needing a platform admin to paste a pixel id is what makes this feel like someone else's software. The platform keeps a read-only view of every store's ids and the ability to clear one (an abusive or mistaken id), which is a narrower power than editing. Consent gating is unchanged: these tags still fire only with advertising consent (§2.2), and the Integrations tab says so in plain words. |
| **D41** | Where do report numbers come from? | **Aggregates only, never raw events.** This is the Phase 3 commitment P3-24 enforces, and Phase 5 is the phase that would break it. A report module reading `AnalyticsEvent` would turn a merchant screen into a person's browsing history; it would also scan a table retention empties at 90 days, so last year's chart would quietly go flat. The check stays, and a new one asserts no file under the report routes imports the event table. |
| **D42** | How are insights kept from being confidently wrong? | §6's thresholds live in **one pure module as data**, each insight carrying the evidence that produced it, and the UI prints that evidence next to the advice ("across 112 view sessions"). Below threshold there is no insight — not a weaker one. Copy says "may need attention", never a cause. A merchant who follows a confident recommendation drawn from nine sessions loses real money, and the apology costs more than the feature earned. |
| **D43** | What can a platform admin see? | **Aggregates across stores, and nothing about a person.** No visitor histories, no raw events, no search phrases attributable to a session. Every page view of `/platform/analytics` writes an `AnalyticsAuditLog` row (§5.8), reusing the table Phase 4 built. A store with too little traffic shows its real numbers and "Not enough activity for a reliable trend" instead of a trend. |
| **D44** | How do deleted products keep their names? | §5.3 requires a historical name and a "Deleted product" label, and `AnalyticsProductDaily` stores only a `productId` — a product deleted next month makes every past row unnameable. So the recompute **snapshots `productName` onto the aggregate row**, the way an order item snapshots what it sold. It names what the product was called *that day*, which is also the honest answer after a rename. Migration plus a backfill from the current products for rows that already exist. |
| **D45** | What does a date range mean? | **Store-local days, end-inclusive, resolved by `lib/analytics/local-day.ts`.** "Last 7 days" is seven local days ending today, and a comparison period is the seven before it — not 168 hours, which would silently shift on the 23- and 25-hour days this platform's default zone actually has. Every view carries the store's timezone indicator (§5.1). |
| **D46** | What does the funnel show when a step is missing? | The step, with zero, and the drop-off above it. A funnel that hides an empty step makes a broken storefront look like a narrow one. Website and WhatsApp paths stay visually separate and never share a monetary total (§5.4, and §3.4's rule that intent is not revenue). |
| **D47** | Does an admin-only browser suite need a custom-domain leg? | **No, and the exemption is written down rather than assumed.** `/admin` and `/platform` are refused on a store's own domain by `proxy.ts` (`PLATFORM_ONLY_PREFIXES`), so there is no custom-domain behaviour to test — unlike the storefront, where two phases of defects hid there. `verify:e2e-policy` gains an `ADMIN_ONLY` set with that reason, and a suite in it must prove the refusal instead: `/admin/marketing` on a store domain must not render. |

## 3. Data model

| Change | Why |
|---|---|
| `AnalyticsProductDaily.productName` | **D44.** A snapshot, so a deleted product can still be named in last month's report. |
| `MarketingCampaign` | **D39.** `tenantId`, `name`, `utmCampaign` (normalized), `channel`, `destinationPath`, `createdAt`, `archivedAt`. Tenant-scoped, forced RLS, like every other store-owned table (P4-23a will check it). Holds no numbers. |
| `Tenant` | Nothing new. The integration fields already exist (`gaMeasurementId`, `googleAdsId`, `googleAdsPurchaseLabel`, `metaPixelId`, Search Console verification); D40 is about who may write them, not about new columns. |
| `AnalyticsAuditLog` | Nothing new. Phase 4 built it; Phase 5 writes `REPORT_VIEW` rows from the platform console and reads the table in it. |

## 4. New modules

| File | Purpose |
|---|---|
| `lib/analytics/report.ts` | Every number any report shows, read from aggregates (**D41**), one function per view, each taking a tenant and a local-day range. |
| `lib/analytics/compare.ts` | Period-over-period arithmetic and the "not enough activity" rule (**D43**, **D45**). Pure. |
| `lib/analytics/insights.ts` | §6's rules and thresholds as data, returning an insight plus its evidence (**D42**). Pure. |
| `lib/data/campaigns.ts` | Saved campaigns, tenant-scoped through `withTenant` (**D39**). |
| `app/admin/(panel)/marketing/*` | The section: Results, Campaigns, Tracked links (mounting Phase 4's `LinkBuilder` unchanged), Integrations. |
| `app/admin/(panel)/analytics/*` | Overview, Products, Funnel, Acquisition, Searches, Heatmap. |
| `app/platform/(admin)/analytics/*` | The aggregate-only console (**D43**). |
| `components/analytics/chart/*` | The chart primitives, each with its table alternative as a sibling, not an afterthought (**§5.9**). |

## 5. Commit sequence

Reading comes before rendering, and the rules that stop a report misleading someone come before
the charts that could.

1. **`report.ts` and `compare.ts`**, with the aggregate-only rule enforced and the local-day
   ranges verified across a DST boundary. No UI.
2. **`insights.ts`**, with every §6 threshold exercised at, just below and just above the line.
3. **D44's product-name snapshot**: migration, recompute change, backfill, and a check that a
   deleted product still names itself.
4. **The Marketing section's shell and Integrations** (**D40**) — the owner's own ids, validated,
   with the platform's read-only view.
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
| P5-18 | A platform admin can see every store's ids and clear one, and cannot edit one. |
| P5-19 | Results answers "which source brought visitors, orders and WhatsApp clicks" for a period, with the three kept separate. |
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
