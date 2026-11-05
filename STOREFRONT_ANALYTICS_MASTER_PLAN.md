# Storefront Analytics — Ultimate Implementation Master Plan

Status: implementation-ready planning document. No implementation is included here.

This document is the canonical product, privacy, architecture, security, performance, UX, deployment, and verification plan for first-party storefront analytics.

Version 1 launches as one complete product after a full one-store pilot. The phases below define build order only. No partial analytics experience is released publicly.

## 1. Locked Product Decisions

- Analytics is included in every store subscription.
- After a short silent pilot on one store, the complete release is enabled for every store in one launch.
- The pilot still shows the real consent banner and privacy information. “Silent” only means there is no public marketing announcement.
- The first release includes consent, visitors, products, funnel, searches, acquisition, tracked links, heatmap, active-now, deterministic insights, platform reporting, an installable admin PWA, and web push.
- The platform operator enters merchant privacy details, default language, and reporting timezone during store creation.
- Merchants do not have an analytics setup gate or normal analytics-disable control.
- Visitors must affirmatively consent before first-party behavioral analytics or third-party analytics/advertising tags run.
- Merchant reports always show real measured counts, including counts of one. There is no small-cohort row suppression.
- No person-level timeline, visitor profile, raw event browser, or raw-event export is exposed.
- Written advice uses minimum evidence thresholds to avoid misleading small stores.
- PostgreSQL stores analytics. The ingestion endpoint writes directly in small batches and silently drops batches on operational failure.
- Redis is limited to distributed rate limiting and active-now presence.
- There is no Redis Stream, always-running analytics worker, or analytics outbox in version 1.
- Website purchases come from the authoritative Order created inside the existing order transaction.
- WhatsApp order-button clicks are intent conversions with potential value, never completed sales or revenue.
- Aggregation, retention, catch-up notifications, summaries, and alert evaluation run through a scheduled Dokploy command.
- Owner notifications are Web Push only. No email or WhatsApp owner notifications are introduced.

## 2. Current System Assessment

### 2.1 Existing functionality to reuse

- Per-store GA4, Google Ads, and Meta instrumentation already exists in lib/analytics.tsx.
- Product views, add-to-cart, checkout, and external purchase tracking already have client integration points.
- The WhatsApp product button in templates/product-client.tsx already knows the product, selected variant when present, displayed price, and WhatsApp destination.
- Orders already snapshot products, automatic discounts, coupon allocations, delivery fees, and final payable values.
- Redis already supports shared rate limits through lib/redis.ts and lib/rate-limit.ts.
- Store colors already resolve through accessible theme tokens in lib/theme.ts.
- Admin navigation, cards, tables, empty states, responsive patterns, English/Arabic dictionaries, and RTL behavior already exist.
- Tenant isolation already uses application scoping, composite tenant references, forced PostgreSQL RLS, withTenant(), and controlled platform bypasses.

### 2.2 Existing behavior that must change

- The global platform GA script currently mounted in app/layout.tsx must not execute on storefront routes.
- Per-store GA, Google Ads, and Meta scripts currently load without a storefront consent decision.
- Redis rate-limit failures currently return an allowed result instead of falling back to the in-memory limiter.
- Search requests exist, but submitted searches and no-result demand are not measured.
- Admin language currently relies on a browser cookie and is not persisted for scheduled notification localization.
- No internal first-party analytics, consent manager, active-presence tracker, aggregate tables, analytics dashboard, PWA, push preferences, or push-delivery ledger exists.

### 2.3 Launch control

- Keep the complete feature behind ANALYTICS_ROLLOUT_MODE with off, pilot, and all values.
- The pilot target is selected through ANALYTICS_PILOT_TENANT_SLUG.
- Analytics capability and consent UI are active from day one once rollout includes a store.
- Behavioral collection still starts only after visitor consent.
- A platform-only emergency pause remains available for incidents.
- Existing stores must have privacy-controller details, default locale, and timezone backfilled before pilot.

## 3. Measurement Definitions

### 3.1 Visitors and sessions

- Measured visitor: a consenting browser with a tenant-specific first-party visitor identifier.
- New visitor: first seen during the selected reporting period.
- Returning visitor: first seen before the selected period.
- Session: activity separated by no more than 30 minutes of inactivity.
- Active now: a consenting visitor with visible storefront activity within the last five minutes.
- Each store receives a different visitor identity. Identities are never correlated between stores.

The UI must say that totals represent measured visitors who accepted analytics. It must not suggest rejected visitors are measured.

### 3.2 Funnel

The funnel has two explicit outcomes:

~~~text
Store visit → Product view → Add to cart → Checkout → Website order
                          └────────────────→ WhatsApp order click
~~~

- Funnel steps use unique sessions rather than raw event counts.
- Website abandonment is evaluated only after a 24-hour maturity window.
- A session may complete both paths; combined-action metrics deduplicate the session.
- WhatsApp clicks remain visually and financially separate from website orders.

### 3.3 Financial definitions

- Gross merchandise: regular prices before automatic discounts.
- Automatic discount: existing item-level automatic savings.
- Merchandise subtotal: after automatic discounts and before coupons.
- Coupon merchandise discount: sum of coupon allocations on items.
- Net merchandise value: merchandise subtotal minus merchandise coupon discount.
- Net delivery value: delivery fee minus delivery coupon discount.
- Final payable value: net merchandise value plus net delivery value.
- Website order value: the authoritative final payable value snapshotted on the order.
- Delivered order value: final payable value of delivered orders.
- Cancelled orders remain visible as submitted-order conversions but are excluded from current non-cancelled order-value totals.

Because payment is cash on delivery, merchant UI uses “Order value” rather than claiming electronic collection.

### 3.4 WhatsApp conversions

Add WHATSAPP_ORDER_CLICK:

- Fire when the shopper selects Order on WhatsApp.
- Include product, selected variant when available, quantity, session, source, and server-calculated potential value.
- Never trust a client-supplied money value. Resolve current canonical product pricing on the server.
- Use unique clicking sessions as the primary measure and raw click count as a secondary detail.
- Report “WhatsApp order clicks” and “Potential WhatsApp value.”
- Never add potential WhatsApp value to sales, revenue, or website order value.
- The WhatsApp link continues working if consent is rejected or analytics fails.

### 3.5 Acquisition

Capture after analytics consent:

- utm_source
- utm_medium
- utm_campaign
- Sanitized utm_content
- Referring hostname
- Presence, but not the raw value, of gclid or fbclid
- Landing-page kind

Attribution priority:

1. Explicit UTM parameters
2. Recognized advertising-click marker
3. Social or recognized referring domain
4. Other external referral
5. Direct

Store first touch and last non-direct touch. Merchant reports default to last non-direct attribution. Do not claim ROAS without advertising-spend data.

### 3.6 Searches

Track:

- A submitted search
- A stabilized no-result query
- A search-result click

Do not emit an event for every keystroke.

Normalize, trim, and length-limit search text. Detect likely email addresses, phone numbers, card-like strings, and similar sensitive input. Replace sensitive-looking values with [redacted] and exclude them from stocking suggestions.

### 3.7 Time

- Every store has an IANA analytics timezone.
- Store timestamps in UTC.
- Resolve daily/hourly reporting in the store timezone.
- Resolve weekly owner notifications in the store timezone.
- The viewer’s device timezone does not redefine the store’s business day.

## 4. Privacy and Consent Architecture

### 4.1 Joint controllers

The platform and merchant are joint controllers for storefront analytics:

- The platform defines and operates the measurement system.
- The merchant receives and acts on its store’s analytics.
- The platform is the primary privacy-request coordinator.
- Visitors may exercise their rights against either controller.
- The joint-controller arrangement belongs in the merchant subscription agreement.
- The visitor privacy page presents the essence of the arrangement.

Final legal wording and retention periods require local legal review before launch.

### 4.2 Merchant privacy setup

The platform store-creation form requires:

- Merchant/controller display name
- Privacy contact email
- Optional merchant privacy-policy URL
- Store default locale: English or Arabic
- Reporting timezone
- Joint-controller agreement version
- Agreement recording timestamp and platform operator

Platform controller name, email, and privacy URL come from deployment configuration.

### 4.3 Consent banner

Use the same approved wording for every store in English and Arabic. Only store name, controller details, direction, and theme styling vary.

Primary actions:

- Accept all
- Reject non-essential
- Manage choices

Categories:

- Essential: always active
- Analytics: first-party storefront analytics and GA where configured
- Advertising: Google Ads and Meta tags where configured

Requirements:

- No non-essential option is preselected.
- Accept and reject receive comparable prominence.
- Arabic consent content uses scoped RTL.
- Visitors can switch the consent/privacy interface between English and Arabic.
- Store theme tokens provide accessible background, foreground, border, and action colors.
- Every storefront footer exposes Cookie settings.
- Withdrawal is as easy as acceptance.
- A changed notice version requests consent again.
- Use basic Google consent behavior: third-party tags do not load or transmit before the relevant consent category is granted.

### 4.4 Tenant-specific cookies

- store_consent_<tenantKey>: essential, signed/versioned, approximately six months.
- store_visitor_<tenantKey>: created only after analytics consent, approximately twelve months.
- store_session_<tenantKey>: created only after analytics consent, rolling 30-minute inactivity window.

Properties:

- HttpOnly visitor/session identifiers
- Secure
- SameSite=Lax
- No shared parent-domain visitor cookie
- Path-scoped on shared platform storefront URLs where practical
- No fingerprinting fallback

### 4.5 Data minimization

Never store:

- Raw IP addresses
- Full user-agent strings
- Full referring URLs
- Mouse movement, scrolling trails, or keystrokes
- Person-level browsing timelines
- Customer-facing visitor profiles
- Arbitrary event JSON

Store only:

- Country
- Coarse device class
- Sanitized campaign dimensions
- Normalized page kind
- Product/variant identifiers
- Typed aggregate behavioral events
- Anonymous tenant-local visitor/session identifiers

Country comes from trusted proxy metadata. IP is used transiently for rate limiting and then discarded.

As of Phase 7 commit 8, "trusted" is enforced rather than assumed: `lib/edge.ts` believes that metadata only from a request the declared edge signed, and an untrusted request has no country at all (null, not a guess) — see D75/D83 and [EDGE_HARDENING.md](EDGE_HARDENING.md).

### 4.6 Small-store reporting

- Merchant tables and charts always show actual measured counts, including one.
- Do not provide a visitor profile, raw-event explorer, arbitrary cross-dimensional drill-down, or raw-event export.
- Do not expose IP, full referrer, or detailed device fingerprint.
- Factual rankings can use small counts, but written advice requires the thresholds in this plan.

### 4.7 Retention and privacy requests

- Raw events: 90 days.
- Visitors and sessions: 13 months after last activity.
- Daily/hourly aggregates: 24 months.
- Consent receipts: 24 months after the recorded choice expires or changes.
- Push-delivery records: 90 days.
- Push subscriptions: until revoked, expired, or rejected permanently by the push service.
- Orders: existing commercial/legal retention policy.

Cookie settings expose a privacy identifier. A coordinated request can export or delete visitor/session/raw-event data, detach analytics identifiers from retained orders, preserve legally required order records, and preserve genuinely anonymous aggregate totals.

## 5. Merchant and Platform UX

### 5.1 Merchant navigation

Add Analytics to the existing admin navigation near Home and Orders.

Route:

- /admin/analytics

Local sections:

- Overview
- Products
- Acquisition
- Searches

Controls:

- Last 7 days
- Last 30 days, default
- Last 90 days
- Custom range
- Compare with previous period
- Store-timezone indicator

Every view explains that it includes consenting measured visitors and may be lower than total storefront activity.

### 5.2 Overview hierarchy

1. Active now
2. What needs attention
3. Visitors, sessions, website orders, WhatsApp clicks, conversion, and order value
4. Visitor trend
5. Branched website/WhatsApp funnel
6. Product summary
7. Acquisition summary
8. Search opportunities
9. Day/hour activity heatmap

Lead with plain-language conclusions, not a wall of equal-weight charts.

### 5.3 Product report

Show:

- Product
- Viewing sessions
- Returning viewers
- Add-to-cart sessions
- Checkout sessions
- Website orders
- WhatsApp order-click sessions
- Website order value
- Potential WhatsApp value
- Website conversion rate
- Combined action rate
- Trend

Deleted products preserve a historical name snapshot and show a Deleted product label.

### 5.4 Funnel

Show separate website and WhatsApp paths with unique sessions, step-to-step rate, and change from the previous period. WhatsApp clicks never share the same visual label or monetary total as website orders.

### 5.5 Acquisition and tracked links

For each source/campaign show sessions, visitors, product viewers, cart sessions, website orders, WhatsApp click sessions, website order value, potential WhatsApp value, and conversion rate.

Provide a First touch / Last non-direct switch.

Tracked-link builder inputs:

- WhatsApp, Instagram, Facebook, TikTok, or custom channel
- Campaign name
- Destination: storefront, catalog, category, or product
- Optional content label

Output a UTM-tagged URL, copy action, and report preview. No campaign-management database is required in version 1.

### 5.6 Search report

Show search phrase, searches, result/no-result counts, result-click sessions, website purchasing sessions, WhatsApp click sessions, and trend.

### 5.7 Heatmap

- Store-local weekday and hour
- Selector for sessions, website orders, or WhatsApp clicks
- Exact values
- Accessible table alternative
- No identity claims

### 5.8 Platform analytics

Add /platform/analytics, separate from the existing per-store external-tracking integration route.

Show aggregate-only:

- Stores with measured activity
- Total measured visitors and sessions
- Website orders and order-value trend
- WhatsApp click trend
- Per-store traffic/order trends
- Growing stores
- Declining stores
- Stores with no measured activity
- Analytics ingestion/system health

Definitions:

- Store with activity: at least one session, website order, or WhatsApp click in the selected period.
- Growing: at least 20% growth plus a meaningful absolute increase.
- Declining: at least 20% decline plus a meaningful absolute decrease.
- No activity: zero sessions, website orders, and WhatsApp clicks for seven days.
- Very small stores keep their real numbers but receive “Not enough activity for a reliable trend” instead of a misleading trend judgment.

Platform staff cannot open visitor histories or raw events. Platform analytics access is audit logged.

### 5.9 States and accessibility

- No consented traffic: explain how measurement begins.
- No orders: still show traffic, WhatsApp, products, and searches.
- Redis unavailable: show Live visitor count temporarily unavailable, never zero.
- Aggregation delayed: show the last successful update.
- No qualified insight: say there is not enough evidence for a reliable recommendation.
- Charts include textual/table alternatives.
- Mobile converts dense tables into ranked, task-oriented cards.
- Keyboard focus, screen-reader labels, contrast, RTL, long text, and loading/error/empty states are required.

## 6. Insights

Insights are deterministic; no LLM is required.

| Insight | Minimum evidence |
| --- | ---: |
| High interest, low conversion | 25 product-view sessions |
| Funnel problem | 20 mature sessions entering the step |
| Repeated unmet search | 5 no-result searches |
| Strong acquisition source | 10 sessions and 2 website orders or 3 WhatsApp-click sessions |
| Meaningful activity shift | 20 sessions across the comparison |
| Frequently revisited product | 10 visitors plus a meaningful repeat-view rate |

Rules:

- Top product always shows the factual leader and states whether it leads by website orders, WhatsApp clicks, or views.
- High-interest/low-conversion requires the view threshold and zero combined actions or a rate below half the store baseline.
- Unnoticed product requires at least 14 active days and very low 30-day view sessions.
- Search opportunity requires the repeated no-result threshold.
- Funnel issue requires a meaningful store-specific or period-over-period drop.
- Top source requires sufficient source sessions and conversion evidence.
- Copy uses cautious language such as “may need attention,” never an unprovable cause.

## 7. Event and Ingestion Architecture

### 7.1 Stable event contract

Public endpoint:

- POST /api/store/[slug]/analytics/events

Envelope:

~~~text
schemaVersion
sentAt
events[]
  eventId
  type
  occurredAt
  pageKind
  productId?
  variantId?
  quantity?
  searchQuery?
  resultCount?
  attributionContext?
~~~

The client never supplies tenant ID, visitor ID, session ID, country, authoritative product value, website revenue, or order status.

The contract is transport-neutral. A future Redis Stream/worker can accept the same normalized envelope without storefront changes.

### 7.2 Persisted event types

- PAGE_VIEW
- PRODUCT_VIEW
- SEARCH_SUBMITTED
- SEARCH_RESULT_CLICK
- ADD_TO_CART
- REMOVE_FROM_CART
- CART_VIEW
- CHECKOUT_STARTED
- WHATSAPP_ORDER_CLICK

Website purchases come from Order, not a public purchase event.

### 7.3 Presence

Use POST /api/store/[slug]/analytics/presence:

- Only after analytics consent
- Only while the document is visible
- Approximately every 60 seconds
- Redis only
- Never persisted as raw events

### 7.4 Browser batching

- In-memory queue only
- Flush about every ten seconds or ten events
- Maximum accepted batch: 20
- Flush on navigation/visibility change
- Prefer sendBeacon; use keepalive fetch fallback
- No durable browser retry queue
- Event IDs make retries idempotent
- Analytics sending failures remain invisible to commerce users

### 7.5 Direct PostgreSQL ingestion

The endpoint:

1. Resolves tenant from route and host.
2. Verifies a short-lived tenant-bound bootstrap token.
3. Confirms analytics consent.
4. Applies tenant/IP rate limits.
5. Strictly validates the envelope.
6. Sanitizes query/campaign strings.
7. Verifies product/variant tenant ownership.
8. Resolves visitor/session.
9. Calculates WhatsApp potential value server-side.
10. Inserts with duplicate skipping.
11. Updates session activity.
12. Touches Redis active presence best-effort.
13. Returns 202.

Invalid/oversized input returns 400. Abusive but structurally valid input may be silently discarded with 202. Database timeout/failure is sampled into operational health where possible, returns 202, and drops the batch. There is no server retry.

Use separate low-capacity pools so analytics cannot starve checkout:

- Application pool: initially 20
- Analytics ingestion pool: initially 5
- Scheduled-job pool: initially 2

Use short acquisition/statement timeouts and a small process-local concurrency ceiling. Drop excess analytics work. Require PgBouncer before horizontal application scaling.

## 8. Redis Architecture

Redis version 1 responsibilities:

1. Distributed rate limiting
2. Active visitor presence

Redis does not store streams, historical analytics, dashboard caches, permanent orders, or notification queues.

### 8.1 Rate-limit correction

Change redisRateLimit to distinguish a valid allow/deny result from Redis unavailable/error.

On Redis failure:

1. Fall back to the in-memory limiter.
2. Record the fallback state best-effort.
3. Never reject checkout solely because Redis failed.
4. If both limiting paths encounter an unexpected internal failure, checkout and coupon validation continue.

Normal abuse limits still apply when either limiter functions.

### 8.2 Active visitors

Use a tenant-specific Redis sorted set:

- Member: opaque tenant-local visitor/session identifier
- Score: last visible activity
- Count entries newer than five minutes
- Prune stale entries on writes/reads
- No IP or page history

Redis failure makes live presence unavailable rather than reporting a false zero.

## 9. Orders and Data Model

### 9.1 Order integration

Add immutable order snapshots:

- Analytics session identifier
- First-touch source/medium/campaign
- Last non-direct source/medium/campaign
- Country
- Coarse device class

Write these with the order in the existing transaction. Aggregation reads Order and OrderItem as the purchase source of truth. There is no purchase event, analytics outbox, or post-checkout analytics dependency.

### 9.2 Tenant fields

- analyticsTimezone
- defaultLocale
- privacyControllerName
- privacyEmail
- privacyPolicyUrl
- jointControllerVersion
- jointControllerRecordedAt
- consentNoticeVersion
- Platform-only emergency analytics pause timestamp/reason

### 9.3 Analytics tables

- AnalyticsConsentReceipt
- AnalyticsVisitor
- AnalyticsSession
- AnalyticsEvent
- AnalyticsDailyMetric
- AnalyticsHourlyMetric
- AnalyticsProductDaily
- AnalyticsSearchDaily
- AnalyticsAcquisitionDaily
- AnalyticsAggregationCursor
- AnalyticsOperationalMetric
- AnalyticsAuditLog

### 9.4 Notification tables

- AdminPushSubscription
- AdminNotificationPreference
- PlatformNotificationPreference
- AdminNotification
- AdminNotificationOrder
- AdminNotificationDelivery
- NotificationAlertState

### 9.5 User additions

- adminLocale: en, ar, or null
- Owner notification preferences
- Platform notification preferences where applicable
- Push subscriptions

The admin language switch updates both the immediate locale cookie and persisted User.adminLocale.

### 9.6 Push subscription

Store:

- User
- Optional tenant
- Audience: OWNER or PLATFORM
- Encrypted endpoint
- Encrypted p256dh/auth values
- Device label and coarse device/browser class
- Created/last-success/last-failure timestamps
- Revoked/expired timestamp

### 9.7 Notification preferences

Use typed Boolean fields, all defaulting true.

Owner:

- newOrders
- weeklySummary
- productAlerts
- funnelAlerts
- searchAlerts
- trafficAlerts

Platform:

- inactiveStoreAlerts
- storeDeclineAlerts
- ingestionHealthAlerts
- aggregationHealthAlerts
- redisFallbackAlerts
- pushDeliveryAlerts
- weeklyPlatformSummary

Preferences belong to the user and apply to every device. Device removal is separate.

### 9.8 Notification ledger

AdminNotification contains recipient, audience, type, localized title/body snapshot, destination, dedupe key, cooldown/entity key, and creation time.

AdminNotificationOrder links notification batches to orders and enforces a unique owner/order association.

AdminNotificationDelivery contains notification, subscription, PENDING/SENDING/SENT/FAILED/EXPIRED state, attempt count, lease expiration, error category, and sent time.

### 9.9 Isolation

All tenant-owned analytics/notification tables include tenant ID, forced RLS, tenant indexes, composite tenant foreign keys where applicable, reviewed cascade behavior, and event deduplication on tenant ID plus event ID.

Events use typed columns rather than arbitrary JSON.

## 10. Aggregation, Retention, and Scheduled Work

Dokploy invokes one idempotent command:

- pnpm analytics:scheduled

Recommended interval: every five minutes.

It performs due work:

- Aggregate refresh, at most every 15 minutes
- Recompute current/previous local day for late events and order-status changes
- New-order push catch-up
- Expired SENDING delivery-lease recovery
- New-order batching
- Owner preference revalidation
- Owner weekly summaries
- Owner important-alert evaluation
- Platform system alerts
- Platform weekly summary
- Daily retention cleanup
- Stale-session maintenance
- Expired push-subscription cleanup
- Notification-delivery retention

Use a PostgreSQL advisory lock to prevent overlap. Process tenants in bounded batches. Aggregate upserts are idempotent. Retention deletes raw events in bounded chunks. Store last successful run, per-stage status, lease, and failure information.

A failed scheduled run never affects storefront or checkout.

Merchant pages query tenant aggregates through withTenant(). Platform analytics requires authenticated PLATFORM_ADMIN, uses the narrow existing bypass path, reads aggregates/operational health rather than raw events, and audit logs access.

## 11. Admin PWA and Web Push

### 11.1 PWA surfaces

Provide two installable identities using the same safe push infrastructure:

- Merchant admin: manifest ID/start URL /admin
- Platform admin: manifest ID/start URL /platform

Use a service worker for push and notification clicks. Do not offline-cache authenticated HTML, API responses, order/customer data, or analytics reports. Version 1 remains network-dependent.

### 11.2 Owner setup UX

Add /admin/notifications with three sections:

1. Push status: install state, permission state, Enable notifications, Send test notification.
2. Notification types: new orders, weekly summary, product, funnel, search, traffic toggles.
3. Registered devices: device description, added time, last successful delivery, state, Remove device.

All owner types default on. Adding a device inherits preferences. Removing a device does not change preferences or other devices.

On iPhone/iPad explain:

1. Open the canonical admin URL in Safari.
2. Use Share.
3. Choose Add to Home Screen.
4. Open the installed admin app.
5. Choose Enable notifications.

Request notification permission only from the user’s direct action.

### 11.3 Notification localization

Fallback:

1. Persisted owner admin language
2. Store default locale
3. English

Every owner/platform notification and weekly summary has complete English and Arabic templates. Arabic payloads set lang=ar and dir=rtl and use Arabic sentence structure rather than translated fragments.

### 11.4 Instant new-order delivery

Sequence:

1. The order transaction commits successfully.
2. The server has the committed order ID.
3. Next.js after() schedules notification work after the response.
4. The callback uses a strict approximately 2–3 second push timeout.
5. Exceptions are swallowed and recorded best-effort.
6. Scheduled catch-up handles anything missed.

Never schedule before commit. Never call a push provider inside the order transaction. Push success never affects order success or checkout response time.

Dokploy must allow a 10–30 second graceful shutdown period for pending after() callbacks.

### 11.5 Order notification deduplication

Logical identity:

- recipientUserId + NEW_ORDER + orderId

Use unique logical notification/order and notification/subscription constraints. Delivery claims use leases so instant and scheduled senders cannot both own the same delivery.

Payloads contain a stable notification ID/tag such as owner-order:<ownerId>:<orderId>. The service worker uses this tag plus a small local seen-ID store to replace/discard retries.

Each active registered device receives at most one visible copy. Multiple devices intentionally each receive one copy.

### 11.6 Short-window batching

Use an approximately 3–5 second coalescing window:

- The first post-commit callback acquires an owner-scoped delivery lock.
- It claims currently unnotified recent orders.
- One order: “You have a new order.”
- Several: “You have 3 new orders.”
- Concurrent callbacks observe the existing associations.

Catch-up may also batch several missed orders. Push bodies contain no customer identity, phone, address, notes, or product list.

### 11.7 Owner weekly summary

Default Monday 09:00 store time:

- Top product
- Biggest qualified problem
- Top repeated unmet search

If evidence is insufficient, say no strong problem/repeated unmet search was detected. The notification opens the matching analytics period.

### 11.8 Owner important alerts

- High-interest product with insufficient website/WhatsApp actions
- Significant checkout-to-order deterioration
- Repeated no-result search spike
- Unexpected traffic disappearance against an established baseline

Respect type preferences and per-type/entity cooldowns. Do not alert from tiny samples. Use cautious language. New-order alerts require no sample threshold because they report a confirmed fact.

### 11.9 Platform notification setup

Add /platform/notifications using the same installation, permission, test, preference, and device-management components, tagged with PLATFORM audience so merchant and platform deliveries cannot cross.

Platform messages may include store names but never customer/order personal data.

### 11.10 Platform alerts

Inactive store:

- Zero measured sessions, website orders, and WhatsApp clicks for seven days.
- Send once on state entry, respect cooldown, reset after activity resumes.

Sharp decline:

- At least 50% traffic/order reduction.
- Require a meaningful baseline, initially about 20 sessions or 5 orders.
- Seven-day cooldown per store/metric.

Ingestion failures:

- Example threshold: at least 20 attempted batches and over 5% operational drops within ten minutes.
- Increment process-local counters and flush them to AnalyticsOperationalMetric best-effort without blocking ingestion.

Aggregation health:

- Last successful aggregation older than 20 minutes.
- Explicit failed run.
- Run lease expired.
- Repeated tenant aggregation failure.

Redis fallback:

- Record fallback start/end.
- Notify once when in-memory limiting begins.
- Cool down repeats.
- Optionally report recovery.

Push failure:

- Example threshold: over 20% failures with at least ten attempts in the evaluation window.
- Exclude subscriptions already classified as permanently expired.
- Keep the issue visible in platform system health even if push delivery itself is degraded.

A complete app/database/scheduler outage cannot reliably send its own Web Push notification. Retain external infrastructure uptime monitoring for that case.

### 11.11 Weekly platform summary

Default Monday 09:00 in the platform admin’s configured timezone:

- Total active stores
- Growing/declining/inactive stores
- Ingestion health
- Aggregation freshness
- Redis fallback health
- Push delivery success rate

Open /platform/analytics for detail.

## 12. Security and Performance

### 12.1 Analytics endpoint

- Validate Host, tenant slug, and Origin.
- Require a short-lived tenant-bound signed bootstrap token.
- Maximum body approximately 15–20 KB and 20 events.
- Reject unknown fields/types.
- Clamp client timestamps.
- Deduplicate event IDs.
- Validate product/variant ownership.
- Store normalized page kinds, not arbitrary URLs.
- Rate limit by tenant, visitor, and trusted client IP.
- Add Cloudflare/WAF limits.
- Never log full event payloads, cookies, search values, or push endpoints.

### 12.2 Push security

- VAPID private key remains server-only.
- Encrypt push endpoints and authentication keys with a dedicated key.
- Bind subscriptions to user, audience, and optional tenant.
- Recheck ownership when creating/removing.
- Remove endpoints returning permanent expiration.
- Limit devices per user.
- Support device revocation.
- Security-sensitive account changes may revoke subscriptions.
- Payloads contain no customer personal data.
- Notification links allow only approved internal admin paths.
- Respect notification preferences immediately before instant and scheduled sends.

### 12.3 Performance budgets

- Tracker payload under approximately 15 KB gzip.
- Ingestion p95 under 150 ms under expected load.
- Ingestion statement budget under 500 ms.
- 30-day dashboard p95 under 1.5 seconds.
- Active-now lookup under 300 ms.
- Aggregate lag under 20 minutes.
- New-order push normally visible within seconds.
- No commerce failure caused by Redis, ingestion, aggregation, or push.
- Load test at three times projected launch traffic.
- Monitor raw-table growth, database saturation, fallback state, aggregate lag, and push failure rate.

### 12.4 Growth controls

- Index tenant ID plus occurredAt.
- Unique tenant/event ID deduplication.
- Aggregate dashboards do not scan unrestricted raw history.
- Delete raw events in bounded retention batches.
- Monitor table/index size.
- Consider monthly partitioning only when actual volume approaches tens of millions of events.

## 13. Implementation Build Sequence

Nothing is publicly released until every phase is complete.

### Phase 1 — Privacy, controller setup, and consent

Build tenant privacy/default-locale/timezone fields, consent receipts, tenant-specific cookies, consent manager, footer settings, joint-controller privacy content, external-tag gating, global platform-GA separation, and rollout controls.

Verify no tracking before consent, withdrawal, custom/platform domains, notice renewal, RTL, contrast, keyboard, and mobile.

### Phase 2 — Collection, sessions, active visitors, and rate-limit correction

Build the stable contract, direct PostgreSQL ingestion, dedicated pool, visitor/session lifecycle, country/device/source resolution, presence endpoint, Redis sorted sets, and Redis-to-memory limiter fallback.

Verify RLS, deduplication, tenant product validation, silent batch drop, Redis outage, checkout continuity, and unavailable-not-zero live state.

### Phase 3 — Products, funnel, WhatsApp, and order attribution

Instrument page/product/cart/checkout/WhatsApp actions, calculate WhatsApp potential value on the server, and snapshot attribution inside orders.

Verify financial reconciliation, WhatsApp/revenue separation, session deduplication, and checkout independence from analytics.

### Phase 4 — Search, acquisition, tracked links, aggregates, and scheduled work

Build meaningful search events, PII scrubbing, first/last attribution, link builder, aggregate tables, timezone handling, the Dokploy scheduled command, and retention.

Also: **count contract rejections (HTTP 400) as their own health signal**, separate from both policy and operational drops, and carry them through the snapshot flush into `AnalyticsOperationalMetric` and the Phase 6 alert evaluation.

The three kinds mean three different things and must never share a threshold:

- A **policy** drop is the system working — consent refused, store outside the rollout. Alerting on these pages someone because consent is being honoured.
- An **operational** drop is the system struggling — pool full, limiter bit, database timed out. This is what §11.10's "over 5% of at least 20 attempted batches in ten minutes" is written against.
- A **contract rejection** is *our own code sending something the contract refuses*. It is never the shopper's fault, never load-dependent, and a non-zero rate means a browser is losing data right now. It warrants a separate, much lower threshold than operational drops — a single-digit count in a window is already a bug.

Folding 400s into the operational percentage would hide exactly the defect Phase 3 found the hard way: off localhost, every batch was refused as malformed and lost, and the operational drop rate stayed at zero throughout. `lib/analytics/health.ts` already counts `invalidEnvelopes` separately and the endpoint already logs which field failed; Phase 4 owes the persistence, the threshold and the alert.

Verify no-result searches, source classification, DST/midnight, late events, status changes, chunked retention, overlapping-job protection, and that a forced contract rejection raises the 400 signal alone while leaving the operational drop rate at zero.

### Phase 5 — Marketing, merchant reports, and the platform console

Build Overview, Products, Acquisition, Searches, branched funnel, heatmap, accessible alternatives, insights, platform store trends, system health, bilingual mobile states, and audit logging.

Also, agreed before [PHASE_5_PLAN.md](PHASE_5_PLAN.md) was written, because they decide what this product *is* to the person paying for it:

- **One Marketing section** in the owner's admin — campaigns, tracked links, integrations, results — instead of the same work scattered between settings and analytics. The storefront is a shop; this section is the reason an owner opens the admin on a week when nothing has sold.
- **Owner self-service integrations**: the owner connects their own Google and Meta accounts, which today only a platform admin can do. Needing to ask someone else to paste a pixel id is what makes software feel like it belongs to somebody else. The platform admin keeps full edit as well — an owner stuck on a tag asks for help, and "I can see it is wrong and may only delete it" is a worse answer than fixing it — and every write, owner's or admin's, is audit-logged. Each integration gets step-by-step setup text in English and Arabic ending in how to check it, whatever the owner pastes is reduced to the id itself (never stored as HTML or script), and the domain-verification tags render without consent, because they prove who owns a domain rather than watching anyone.

Verify small-store exact values, insight thresholds, no person-level access, platform aggregate-only boundaries, and order/aggregate reconciliation.

**Built and verified** — all 34 items in [PHASE_5_ACCEPTANCE.md](PHASE_5_ACCEPTANCE.md) pass. `ANALYTICS_ROLLOUT_MODE` stays `off`: §13 holds the launch until Phase 7.

**After launch, deliberately not in Phase 5** (each would slow the build, and none is needed to launch): a coupon tied to a campaign and what it earned; shopper-facing push notifications ("back in stock", "new offer"), which are a different audience and consent basis from Phase 6's merchant push; and server-side conversion reporting to Meta and Google. §8 of the Phase 5 plan notes what to avoid now so each stays cheap later.

### Phase 6 — Admin PWA, Web Push, and Notification Control

Build:

- Merchant and platform manifests/PWA identities
- Safe service worker
- Owner/platform push subscriptions and device management
- Persisted notification language
- Typed owner/platform preferences
- Instant post-commit new-order push through after()
- Logical notification/order/delivery ledgers
- Retry and per-device service-worker deduplication
- Short-window order batching
- Scheduled new-order catch-up
- Owner weekly summary and important alerts
- Platform health/store alerts and weekly summary
- Cooldowns, delivery leases, and expired-endpoint cleanup
- iPhone Home Screen guidance

**Built and verified** — all 32 script-provable items in [PHASE_6_ACCEPTANCE.md](PHASE_6_ACCEPTANCE.md) pass. Two items (real iPhone and Android delivery) are checked by a person at the pilot and are not done. `ANALYTICS_ROLLOUT_MODE` stays `off`; new-order push works regardless, because an order is not an analytics event.

Verify:

- Order notification arrives within seconds.
- Checkout succeeds when push fails/times out.
- Rolled-back orders produce no notification.
- Instant/catch-up paths do not create duplicate logical notifications.
- Retries collapse on the same device.
- Several recent orders can produce one “3 new orders” notification.
- Disabled types are never sent.
- New devices inherit preferences.
- Removing one device leaves other devices/preferences intact.
- English/Arabic fallback and RTL render on Android, desktop, and iPhone.
- Merchant/platform audiences never cross.
- Platform alerts fire under simulated ingestion, aggregation, Redis, and push failures.
- Cooldowns work.
- No push payload contains customer data.
- Aggregate lag alerts trigger after 20 minutes.
- Failed runs surface on recovery/watchdog evaluation.

### Phase 7 — Hardening, complete pilot, and full launch

**Planned** — [PHASE_7_PLAN.md](PHASE_7_PLAN.md), twelve commits with decisions D70–D84.
It adds one thing this section does not list: **staff accounts**, decided on 2026-11-05 to be
needed before launch rather than after, so a third role joins an isolation model that has had
two principals since Phase 1. They are commits 1–3 and gate the rest.

- **Force HTTPS on every custom domain via Cloudflare** (Always Use HTTPS + an edge certificate per store domain, HTTP→HTTPS redirect at the edge, HSTS once verified). **The code, configuration and runbook are done 2026-11-05** (Phase 7 commit 8): [EDGE_HARDENING.md](EDGE_HARDENING.md) is the ordered procedure with its break-glass path, `lib/edge.ts` is the application's half (`EDGE_FORCE_HTTPS`, HSTS off in every committed configuration by design, and a trust gate so `cf-ipcountry` is believed only from the edge), and `pnpm verify:edge` holds 25 of those properties statically. Turning it on is yours — it needs the real domain, and D84 says the domain must be connected *before* the orange cloud goes on. Not cosmetic: a plaintext custom domain cannot carry a `Secure` cookie, so consent and identity cookies are refused by the browser, and it is not a secure context, so `crypto.randomUUID` and other secure-context APIs are unavailable — the two defects Phase 3 found. HTTPS everywhere is what makes the shared host and a store's own domain behave identically.
- ~~**Every E2E suite has its custom-domain leg**~~ **Done 2026-11-05** (Phase 7 commits 4–6): the nine suites in `scripts/verify-e2e-policy.ts`'s `PENDING_LEG` all have one, the set is empty, and `verify:e2e-policy` passes with 44 checks and no gaps. A silent pilot runs on a real store's own domain, so a suite that had never run against one had not been exercised against what is being piloted. Three things turned up on the way: the admin category tree had been asserting nothing (it indents with `paddingInlineStart`, for Arabic), `robots.txt`/`sitemap.xml` at a domain's root were already being rewritten by `proxy.ts` while both route docstrings called it future work, and two suites were reading client-resolved values the instant their selector appeared.
- Security and privacy/legal review
- Cross-tenant penetration testing
- Performance/load testing
- Database backup/restore test
- Browser/PWA/push matrix
- Full-feature one-store silent pilot
- Compare analytics against authoritative orders
- Validate event loss, database load, scheduled lag, push delivery, preference behavior, localization, and consent
- Fix pilot findings
- Switch rollout from pilot to all stores
- Closely monitor the first launch week

## 14. Deployment Configuration

Runtime services:

1. Next.js application
2. PostgreSQL
3. Redis
4. Dokploy scheduled command using the same application image

No analytics worker, Redis Stream, or outbox.

Environment:

~~~text
ANALYTICS_SIGNING_SECRET
ANALYTICS_SIGNING_KEY_VERSION=1
ANALYTICS_ROLLOUT_MODE=off|pilot|all
ANALYTICS_PILOT_TENANT_SLUG

PLATFORM_PRIVACY_NAME
PLATFORM_PRIVACY_EMAIL
PLATFORM_PRIVACY_URL
PLATFORM_DEFAULT_LOCALE=en
PLATFORM_TIMEZONE=Asia/Beirut

ANALYTICS_RAW_RETENTION_DAYS=90
ANALYTICS_AGGREGATE_RETENTION_MONTHS=24
ANALYTICS_VISITOR_RETENTION_MONTHS=13
ANALYTICS_RECEIPT_RETENTION_MONTHS=24
ANALYTICS_SESSION_TIMEOUT_MINUTES=30
ANALYTICS_ACTIVE_WINDOW_MINUTES=5
ANALYTICS_MAX_BATCH_SIZE=20
ANALYTICS_MAX_IN_FLIGHT

ANALYTICS_DATABASE_POOL_MAX=5
ANALYTICS_JOB_DATABASE_POOL_MAX=2

PUSH_VAPID_PUBLIC_KEY
PUSH_VAPID_PRIVATE_KEY
PUSH_VAPID_SUBJECT
PUSH_ENCRYPTION_KEY
PUSH_TIMEOUT_MS=2500

ANALYTICS_INGESTION_FAILURE_PERCENT=5
ANALYTICS_INGESTION_MIN_BATCHES=20
ANALYTICS_CONTRACT_REJECTION_ALERT=5
ANALYTICS_HEALTH_FLUSH_MINUTES=5
~~~

Corrected 2026-11-06 (Phase 7 commit 9, D78). This block is now exactly the variables
`lib/env.ts` reads, and `pnpm verify:config` fails if it names one the code does not — in either
direction. Three entries were removed because nothing read them, and a variable that is
documented, set and never read is the failure this correction is about:

- `APP_DATABASE_POOL_MAX=20` — the runtime pool is `max: 30`, hardcoded in `lib/prisma.ts`. The
  load-tested number in CLAUDE.md is that 30, not this 20.
- `ANALYTICS_AGGREGATION_LAG_MINUTES=20` and `PUSH_DELIVERY_FAILURE_PERCENT=20` — both are real
  thresholds with those exact values, but they live in code as `PLATFORM_THRESHOLDS`
  (`lib/notifications/platform-alerts.ts`), not in the environment. Deliberately: a platform
  alert threshold that each deploy can set is a threshold nobody can reason about across
  deployments.

D78's original claim was that this block named `WEB_PUSH_*` and `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`
while the code read the four `PUSH_*` names. By the time commit 9 checked, the push names here
already matched; the mismatch that survived was these three phantom entries, pointing the other
way. `verify:config` also refuses the old names anywhere in the documents, so neither direction
can come back.

No secret becomes NEXT_PUBLIC — nothing in the repository does, and `verify:config` keeps it that
way. The VAPID public key reaches the browser only as a prop of `/admin/notifications` and
`/platform/notifications`, each behind its own capability or role gate; that is the
"authenticated admin endpoint" this line asks for.

Dokploy:

- Run pnpm analytics:scheduled every five minutes.
- Configure a 10–30 second graceful container shutdown/drain period for Next.js after() callbacks.
- Keep PostgreSQL and Redis private.
- Protect Redis with authentication and persistence appropriate for rate-limit/presence state.
- Monitor app, database, scheduler, Redis, and disk health externally.

## 15. Final Acceptance Criteria

The feature is launch-ready only when:

- The complete feature launches to all stores after the complete pilot.
- No non-essential event or third-party tag fires before consent.
- Rejecting analytics leaves storefront, cart, checkout, and WhatsApp fully functional.
- Visitors are never correlated across stores.
- No merchant/platform view exposes person-level browsing data.
- Small stores see real counts, including one.
- Advice respects evidence thresholds.
- Website conversions and values come from authoritative orders.
- WhatsApp clicks remain clearly labelled intent and never revenue.
- Visitors, products, funnel, searches, acquisition, tracked links, heatmap, active-now, insights, platform reporting, PWA, and push are complete.
- Redis failure falls back to memory and cannot block checkout merely because Redis failed.
- Ingestion failure silently drops events.
- No analytics or push operation can roll back a valid order.
- Aggregation/retention/notification catch-up run idempotently through Dokploy.
- Platform analytics contains aggregates only.
- Consent styling works across every storefront template.
- Admin analytics and notification settings work in English, Arabic, RTL, desktop, and mobile.
- Merchant and platform PWAs are installable.
- iPhone guidance accurately requires Home Screen installation before notification permission.
- Instant order push normally arrives within seconds.
- Instant and catch-up delivery do not show duplicate notifications on a device.
- Preferences are applied to both instant and scheduled sends.
- Arabic notifications render correctly across supported devices.
- Platform alerts respect thresholds/cooldowns and contain store names but no customer data.
- Push subscriptions can be revoked per device.
- External monitoring covers full infrastructure outages that Web Push cannot self-report.

No further product decision is required before implementation.
