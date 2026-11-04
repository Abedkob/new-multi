# Phase 2 — Collection, sessions, active visitors, and the limiter fallback

Implementation plan for Phase 2 of [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md),
building on [PHASE_1_PLAN.md](PHASE_1_PLAN.md) / [PHASE_1_ACCEPTANCE.md](PHASE_1_ACCEPTANCE.md).

Master-plan sections covered: §7 (event contract, persisted types, presence, batching, direct
PostgreSQL ingestion, pools), §8 (Redis responsibilities, limiter correction, active visitors),
§4.4 (the visitor and session cookies Phase 1 deliberately deferred), §9.3 (`AnalyticsVisitor`,
`AnalyticsSession`, `AnalyticsEvent`), §12.1 (endpoint security), §12.3–§12.4 (budgets, growth).

Phase 1 shipped the decision; Phase 2 is the first phase that writes behavioural data, and every
row of it is downstream of a visitor having said yes.

---

## 1. Scope

### In scope

1. The stable event contract and `POST /api/store/[slug]/analytics/events`.
2. A short-lived, tenant-bound signed bootstrap token, and its validation.
3. Direct PostgreSQL ingestion: validate, sanitize, verify ownership, deduplicate, insert, 202.
4. A dedicated low-capacity ingestion connection pool, separate from the application's.
5. `store_visitor_*` / `store_session_*` cookies (§4.4), minted only after analytics consent.
6. Visitor and session lifecycle, including the 30-minute inactivity window.
7. Country, device class and acquisition source resolved server-side and stored on the session.
8. `POST /api/store/[slug]/analytics/presence` and the Redis sorted set behind active-now.
9. The browser tracker: in-memory queue, batching, `sendBeacon`, flush on page hide.
10. Finishing §8.1: recording that the limiter fell back, now that falling back works.
11. Verification: `pnpm verify:ingestion`, `pnpm e2e:analytics`, `PHASE_2_ACCEPTANCE.md`.

### Explicitly NOT in this phase

- Instrumenting product views, cart, checkout and WhatsApp — Phase 3. Phase 2 emits `PAGE_VIEW`
  only; the contract accepts all nine types so later phases add emitters, not endpoint changes.
- Search events and acquisition *reporting* — Phase 4 (the session already carries its source).
- Order attribution snapshots — Phase 3. No order code is touched in this phase.
- Aggregate tables, the scheduled command, retention — Phase 4.
- Any merchant-visible UI. Nothing in Phase 2 is reachable from the admin.
- `AnalyticsOperationalMetric` and ingestion-health alerting — Phase 4/6 (see **D14**).

---

## 2. Decisions needed before coding

| # | Decision | Recommendation |
|---|---|---|
| **D7** | §7.5 says application pool 20, ingestion 5, jobs 2. The application pool is currently **30**, and CLAUDE.md records load tests at that value (150 concurrent, p95 ~2.9s, 0 failures). | **Keep the application pool at 30 and add ingestion 5.** Dropping a load-tested number to match a planning document would be a regression chosen on paper. Total becomes 35 plus the jobs pool in Phase 4; check `max_connections` on the production database before merging, and say so in the deploy notes. |
| **D8** | What is the bootstrap token actually for? | A tenant-bound HMAC with a ~30 minute expiry, minted per page render and embedded in the tracker's config. Be honest about what it buys: the page is public, so any visitor can read their own token. It stops *blind* posting to another store's endpoint and lets us reject stale or forged envelopes cheaply. It is not authentication, and nothing downstream may treat it as proof of anything beyond "this envelope was minted for this tenant recently". |
| **D9** | Who mints the visitor and session cookies? | The ingestion endpoint, via `Set-Cookie` on its 202. Not the page: a visitor who never sends an event should not be given an identifier. Both HttpOnly, both signed like the consent cookie, visitor ~12 months, session rolling 30 minutes. |
| **D10** | Deduplication key. | `@@unique([tenantId, eventId])` with a client-generated UUIDv4 `eventId`, inserted with `skipDuplicates`. A retried beacon is therefore free, which is what makes "no durable retry queue" (§7.4) safe. |
| **D11** | Presence storage. | One Redis sorted set per tenant, member = the opaque session id, score = last activity. Count entries newer than five minutes; prune on write. When Redis cannot answer, active-now is **unavailable**, never `0` — a false zero reads as "nobody is here", which is a different and more damaging claim than "we don't know". |
| **D12** | Where do country and device come from? | The helpers Phase 1 already wrote (`lib/consent/read.ts`): trusted proxy metadata and a three-way user-agent bucket. Move them to `lib/analytics/request.ts` and have consent import from there, so there is one definition rather than two that can drift. |
| **D13** | Does every page view become a row? | Yes, but the page is stored as a **normalized page kind** (`home`, `shop`, `category`, `product`, `cart`, `checkout`, `page`, `search`, `other`), never a URL (§4.5). At the volumes in §12.4 this is comfortably inside the 90-day retention budget, and it is what makes the funnel's first step real. |
| **D14** | Record that the limiter fell back — where? | In-process counter plus a log line in Phase 2. The durable `AnalyticsOperationalMetric` row belongs with the scheduled command that will flush it (Phase 4), and the alerting on top is Phase 6. Writing a metrics table in Phase 2 with no reader and no flush would be three phases of dead code. |

---

## 3. Data model

### 3.1 `AnalyticsVisitor`

```prisma
model AnalyticsVisitor {
  id          String   @id @default(cuid())   // the value inside store_visitor_<key>
  tenantId    String
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  country     String?
  deviceClass String?
  // First touch, kept for the attribution switch Phase 4 exposes.
  firstSource   String?
  firstMedium   String?
  firstCampaign String?

  @@unique([id, tenantId])
  @@index([tenantId, lastSeenAt])
}
```

One visitor row per browser **per store**. Identities are never correlated between stores (§3.1),
which falls out of the cookie being per-tenant rather than being a rule anyone has to remember.

### 3.2 `AnalyticsSession`

```prisma
model AnalyticsSession {
  id             String   @id @default(cuid())
  tenantId       String
  visitorId      String
  startedAt      DateTime @default(now())
  lastActivityAt DateTime @default(now())
  country         String?
  deviceClass     String?
  landingPageKind String?
  // Last non-direct touch for this session (§3.5).
  source   String?
  medium   String?
  campaign String?
  content  String?
  hasAdClick Boolean @default(false)   // presence of gclid/fbclid, never the value

  @@unique([id, tenantId])
  @@index([tenantId, startedAt])
  @@index([tenantId, lastActivityAt])
}
```

### 3.3 `AnalyticsEvent`

```prisma
enum AnalyticsEventType {
  PAGE_VIEW
  PRODUCT_VIEW
  SEARCH_SUBMITTED
  SEARCH_RESULT_CLICK
  ADD_TO_CART
  REMOVE_FROM_CART
  CART_VIEW
  CHECKOUT_STARTED
  WHATSAPP_ORDER_CLICK
}

model AnalyticsEvent {
  id         String             @id @default(cuid())
  tenantId   String
  eventId    String             // client-generated, the deduplication key
  type       AnalyticsEventType
  occurredAt DateTime           // clamped client time
  receivedAt DateTime           @default(now())
  sessionId  String
  visitorId  String
  pageKind   String
  productId  String?
  variantId  String?
  quantity   Int?
  searchQuery String?           // normalized, length-limited, PII-scrubbed (Phase 4 emits these)
  resultCount Int?
  valueCents  Int?              // server-computed only (Phase 3's WhatsApp value)

  @@unique([tenantId, eventId])
  @@index([tenantId, occurredAt])
  @@index([tenantId, type, occurredAt])
}
```

Typed columns, no arbitrary JSON (§9.9). `searchQuery` and `valueCents` exist now so the later
phases add emitters rather than migrations.

### 3.4 Migration

Same shape as `20261104120000_analytics_consent`: hand-written SQL, composite `(id, tenantId)`
uniques, `ENABLE` + `FORCE ROW LEVEL SECURITY` with the `tenant_isolation` policy on all three
tables, cascade from `Tenant`. Composite foreign keys tie session → visitor and event → session
on `(id, tenantId)`, so a row can never point across tenants even if application code slips.

**`scripts/sql/rls-role.sql` must be re-run again** — three more tables for the restricted role.

---

## 4. New modules

| File | Purpose |
|---|---|
| `lib/analytics/contract.ts` | The envelope's zod schema and the shared TypeScript types. Pure, imported by the tracker, the endpoint and the verification scripts, so the wire format has exactly one definition. |
| `lib/analytics/token.ts` | Mint and verify the tenant-bound bootstrap token (**D8**). |
| `lib/analytics/identity.ts` | The visitor and session cookies: names, signing, TTLs, the rolling window. Mirrors `lib/consent/cookie.ts` and reuses its signing approach. |
| `lib/analytics/request.ts` | Country, device class, page-kind normalization, UTM and referrer parsing (**D12**). `lib/consent/read.ts` becomes a thin re-export. |
| `lib/analytics/ingest.ts` | The 13 steps of §7.5 as one function, so the route handler stays a thin shell and the whole path is unit-testable without HTTP. |
| `lib/analytics/presence.ts` | The Redis sorted set: touch, count, prune, and the explicit `unavailable` result (**D11**). |
| `lib/prisma-analytics.ts` | The second Prisma client on its own small pool (**D7**), with short statement and acquisition timeouts and a process-local concurrency ceiling. |
| `lib/data/analytics-events.ts` | Tenant-scoped writes through `withTenant` on the ingestion client. |
| `app/api/store/[slug]/analytics/events/route.ts` | The ingestion endpoint. |
| `app/api/store/[slug]/analytics/presence/route.ts` | Presence ping. |
| `components/analytics/tracker.tsx` | The browser queue: batching, `sendBeacon`, flush on hide, no durable retry (§7.4). |
| `components/analytics/page-view.tsx` | Emits `PAGE_VIEW` on navigation. The only emitter in this phase. |

---

## 5. Changes to existing files

| File | Change |
|---|---|
| `app/store/[slug]/layout.tsx` | Mount the tracker when consent grants analytics **and** `rolloutIncludes(tenant)` — the one place where the rollout flag finally does something. Pass the bootstrap token and the normalized page kind. |
| `lib/analytics/rollout.ts` | Unchanged; Phase 1 wrote it for exactly this. |
| `lib/prisma.ts` | Export the pool size as a named constant so the two clients are visibly different numbers rather than two magic literals. |
| `lib/redis.ts` | Presence helpers; record that a fallback happened (**D14**). |
| `lib/env.ts` | `ANALYTICS_DATABASE_POOL_MAX` (5), `ANALYTICS_MAX_BATCH_SIZE` (20), `ANALYTICS_SESSION_TIMEOUT_MINUTES` (30), `ANALYTICS_ACTIVE_WINDOW_MINUTES` (5). |
| `.env.example`, `PRODUCTION.md`, `DEPLOYMENT_CHECKLIST.md` | The new variables, the `max_connections` note from **D7**, and the `rls-role.sql` re-run. |
| `package.json` | `verify:ingestion`, `e2e:analytics`. |

---

## 6. Commit sequence

1. **Contract and token** — `lib/analytics/contract.ts`, `token.ts`, env additions.
2. **Schema and migration** — three tables, the enum, RLS, composite foreign keys.
3. **Ingestion pool and identity** — `lib/prisma-analytics.ts`, `identity.ts`, `request.ts`.
4. **The endpoint** — `ingest.ts` plus the route, with every §7.5 step in order.
5. **The tracker** — browser queue, `PAGE_VIEW`, storefront wiring behind consent + rollout.
6. **Presence** — Redis sorted set, the presence route, the unavailable-not-zero contract.
7. **Verification** — `verify:ingestion`, `e2e:analytics`, `PHASE_2_ACCEPTANCE.md`.

---

## 7. Acceptance checklist

### Consent still governs everything

| # | Item | Evidence |
|---|---|---|
| P2-01 | No event request is made before consent, on a store inside the rollout | `e2e:analytics` (request log) |
| P2-02 | Withdrawing consent stops event requests immediately | `e2e:analytics` |
| P2-03 | An envelope arriving without a valid consent cookie is rejected and writes nothing | `verify:ingestion` |
| P2-04 | A store outside the rollout mounts no tracker, but still shows the notice | `e2e:analytics` |
| P2-05 | No visitor or session cookie is minted for a visitor who refused | `e2e:analytics` |

### The endpoint

| # | Item | Evidence |
|---|---|---|
| P2-06 | A valid batch returns 202 and persists exactly its events | `verify:ingestion` |
| P2-07 | The same `eventId` delivered twice persists one row | `verify:ingestion` |
| P2-08 | A missing, expired, or other tenant's bootstrap token is rejected | `verify:ingestion` |
| P2-09 | Oversized body (>20KB) or over-long batch (>20) returns 400 and writes nothing | `verify:ingestion` |
| P2-10 | Unknown fields, unknown event types and malformed envelopes return 400 | `verify:ingestion` |
| P2-11 | A `productId`/`variantId` belonging to another tenant is refused | `verify:ingestion` |
| P2-12 | Client timestamps are clamped: no future rows, nothing older than the batch window | `verify:ingestion` |
| P2-13 | A database failure drops the batch silently with 202 and never surfaces to the shopper | `verify:ingestion` (pool pointed at a closed port) |
| P2-14 | The client cannot set `tenantId`, `visitorId`, `sessionId`, `country` or `valueCents` | `verify:ingestion` (fields rejected as unknown) |
| P2-15 | Ingestion p95 under 150ms for a 10-event batch | `verify:ingestion` (measured, 200 batches) |

### Identity and sessions

| # | Item | Evidence |
|---|---|---|
| P2-16 | Visitor and session cookies are HttpOnly, Secure-when-HTTPS, path-scoped per store | `e2e:analytics` |
| P2-17 | Two stores give the same browser two unrelated visitor ids | `e2e:analytics` |
| P2-18 | Activity within 30 minutes continues one session; a gap past it starts a new one | `verify:ingestion` (clock-controlled) |
| P2-19 | A returning visitor keeps their visitor row and gains a second session | `verify:ingestion` |
| P2-20 | Session carries country, device class, landing page kind and last non-direct source | `verify:ingestion` |
| P2-21 | `gclid`/`fbclid` set `hasAdClick` and the raw value is never stored | `verify:ingestion` (column allowlist) |

### Isolation and privacy

| # | Item | Evidence |
|---|---|---|
| P2-22 | All three tables are invisible across tenants under the restricted role | `verify:ingestion` |
| P2-23 | A composite foreign key makes a cross-tenant session→visitor link impossible | `verify:ingestion` (direct SQL attempt) |
| P2-24 | No IP, user-agent, full referrer or URL on any analytics table | `verify:ingestion` (column allowlist on all three) |
| P2-25 | Deleting a store cascades visitors, sessions and events | `verify:ingestion` |

### Redis, presence, and not breaking commerce

| # | Item | Evidence |
|---|---|---|
| P2-26 | Active-now counts only sessions seen within five minutes | `verify:ingestion` |
| P2-27 | With Redis down, active-now reports **unavailable**, never zero | `verify:ingestion` (Redis pointed at a closed port) |
| P2-28 | With Redis down, rate limiting falls back to in-memory and still blocks | `verify:ingestion` (already true since Phase 1; re-asserted here) |
| P2-29 | With Redis down, checkout completes normally | `e2e:analytics` |
| P2-30 | Saturating the ingestion pool does not slow or fail checkout | **BUILT AND PASSING** — `e2e:analytics`: with 200 concurrent batches in flight, a real order took 501ms against a 409ms warm baseline (1.22x), and analytics never held more than 5 of its 5 connections. Built before the tracker, as planned |
| P2-31 | A failing analytics endpoint is invisible to the shopper: no console error, no UI change | `e2e:analytics` |

### Regression

| # | Item | Evidence |
|---|---|---|
| P2-32 | `verify:consent` still passes in full | its own output |
| P2-33 | `verify:isolation`, `verify:templates`, `verify:coupons`, `verify:social-links` pass | their own output |
| P2-34 | `typecheck` clean; `lint` adds nothing new | their own output |
| P2-35 | `e2e:checkout` passes unchanged | its own output |

---

## 8. Risks

- **The ingestion pool is the dangerous part.** The whole point is that analytics cannot starve
  checkout, and the only honest proof is P2-30: saturate it and place an order. Built first, and
  passing — see the checklist row.
- **The concurrency ceiling is the dominant limiter under a burst, not the pool.** Measured via
  the health counters: of 203 batches in a deliberate burst, 179 were dropped and every one of
  them at the ceiling, with no rate limiter involved. That is the designed behaviour at ~20x
  capacity on one instance. Under sustained realistic load it never engages at all.
- **`PAGE_VIEW` on every navigation is the first real write volume.** Watch table growth against
  §12.4 during the pilot; partitioning stays off the table until volume approaches tens of
  millions, as the master plan says.
- **Session boundaries are clock-sensitive.** The 30-minute window must be tested with a
  controlled clock, not with sleeps, or the test is slow and flaky and proves nothing.
- **`sendBeacon` cannot be assumed.** Safari limits it on page hide; the keepalive fetch fallback
  needs to be exercised, and a lost final batch must stay a non-event.
- **Phase 1's Redis fix is load-bearing here.** Presence makes Redis a per-request dependency for
  the first time; without the bounded connect it would reintroduce the hang on a different path.

---

## 8.1 Measured so far

All against a **production build** (`next build && next start`), since a dev server recompiles
routes and would make any capacity figure fiction.

**Sustained realistic load** — `pnpm load:analytics`, 200 concurrent visitors browsing for three
minutes, each flushing a small batch every ~10s with jitter:

| | |
|---|---|
| Batches / events | 3573 sent, 7161 events |
| Rate | ~1200 batches/min |
| **Events stored** | **7161 of 7161 — 0.00% loss** |
| Operational drops | 0 (health counters confirm: none of any kind) |
| Ingestion latency | p50 24ms, **p95 38ms**, p99 173ms (budget: p95 < 150ms) |
| Identity | exactly 200 visitor rows, 200 session rows |
| Analytics connections | peak 5 of 5 |

**Burst** — `pnpm e2e:analytics`, 200 simultaneous batches while a real order is placed:

| | |
|---|---|
| Checkout under saturation | **192ms vs 192ms idle — 1.00x** |
| Analytics connections | peak 5 of 5, never a sixth |
| Batches | 203 attempted, 24 accepted, 179 dropped — **all at the concurrency ceiling** |
| Responses | 200/200 answered 202 |

**Capacity per instance.** At 200 concurrent visitors nothing was under strain — p95 38ms, five
connections, no drops — so this is not a hardware ceiling. The first limit traffic actually
meets is the configured per-store rate limit of 3000 batches/min, which at this browsing rate
is **~500 concurrent visitors per store**. That is a number in `lib/rate-limit.ts`, not a
property of the machine, and it is per store rather than per instance.

## 9. What "Phase 2 complete" means

`PHASE_2_ACCEPTANCE.md` with P2-01..P2-35 showing passing evidence or a stated reason, and
`pnpm verify:ingestion && pnpm e2e:analytics && pnpm verify:consent && pnpm typecheck`
reproducible from a clean checkout. Still not a release: §13 holds the launch until Phase 7.
