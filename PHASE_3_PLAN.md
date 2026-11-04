# Phase 3 — Products, funnel, WhatsApp, and order attribution

Implementation plan for Phase 3 of [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md),
building on [PHASE_2_ACCEPTANCE.md](PHASE_2_ACCEPTANCE.md).

Master-plan sections covered: §3.2 (the branched funnel), §3.3 (financial definitions),
§3.4 (WhatsApp conversions), §9.1 (order integration), and the Phase 3 instrumentation in §13.

Phase 2 built the pipe and proved it cannot hurt checkout. Phase 3 is where the events start
meaning something commercially — which is exactly where a measurement system earns or loses its
credibility, because the first number a merchant checks is the one they can compare against
their own takings.

---

## 1. Scope

### In scope

1. Emit `PRODUCT_VIEW`, `ADD_TO_CART`, `REMOVE_FROM_CART`, `CART_VIEW`, `CHECKOUT_STARTED`.
2. Emit `WHATSAPP_ORDER_CLICK`, with its value computed **server-side**.
3. Snapshot attribution onto the order, inside the existing order transaction.
4. Keep every money figure traceable to an authoritative source (§3.3).
5. Verification: `verify:commerce-analytics`, extended `e2e:analytics`, `PHASE_3_ACCEPTANCE.md`.

### Explicitly NOT in this phase

- Search events and acquisition reporting — Phase 4.
- Aggregates, the scheduled command, retention — Phase 4.
- Any merchant-visible report — Phase 5. Nothing in Phase 3 is readable from the admin.
- Any change to pricing, discounts, coupons or stock. Phase 3 reads the commerce layer; it does
  not get to change what anything costs.

---

## 2. Decisions needed before coding

| # | Decision | Recommendation |
|---|---|---|
| **D15** | Where does the WhatsApp click's value come from? | **The server, from canonical pricing at click time.** The client sends product, variant and quantity; the endpoint resolves the price the same way the product page does (`lib/pricing.ts`), including active discounts. §3.4 is explicit that a client-supplied money value is never trusted, and the contract already refuses `valueCents` from a browser (P2-14). |
| **D16** | How does attribution reach the order? | The checkout Server Action reads the signed session cookie, resolves the session's source dimensions, and passes them to `placeOrder`, which writes them in the **same transaction** as the order (§9.1 — no outbox, no post-checkout dependency). If there is no consent and therefore no session, the columns are null and the order is unaffected. An order must never fail, or wait, because of analytics. |
| **D17** | What stops a store double-counting a shopper who refreshes? | Nothing in Phase 3 — by design. Events carry `sessionId`, and the funnel is defined in **unique sessions** (§3.2); deduplication is a property of the Phase 5 queries, not of collection. Phase 3's job is to guarantee every event carries a session, which Phase 2 already enforces. |
| **D18** | When is `CHECKOUT_STARTED`? | On reaching the checkout page with a non-empty cart, not on submit. "Started checkout and did not finish" is the funnel step merchants act on, and firing it at submit would make that step unmeasurable. |
| **D19** | Where are cart events emitted? | From the cart provider (`lib/cart/cart.tsx`), not from each button. There are several ways into the cart and more will appear; emitting at the single place state actually changes means no entry point can be forgotten, and no path can double-fire. |
| **D20** | How is "potential WhatsApp value" kept out of revenue? | Three guards: it is stored on the event, never on an order; the column stays `valueCents` on `AnalyticsEvent` while order money lives on `Order`; and a verification check asserts the two are never summed by any shared helper. §3.4 is blunt about this and §5.4 repeats it for the UI — a merchant who confuses intent with income makes real decisions on a fiction. |

---

## 3. Data model

### 3.1 `Order` additions (§9.1)

```prisma
analyticsSessionId   String?   // the session that placed it, for funnel reconciliation
analyticsVisitorId   String?   // so a returning buyer is recognisable without a profile
attributionSource    String?   // last non-direct touch, snapshotted at purchase
attributionMedium    String?
attributionCampaign  String?
firstTouchSource     String?   // the visitor's first ever touch for this store
analyticsCountry     String?
analyticsDeviceClass String?
```

All nullable, all written once, never updated. They are a **snapshot**: a later change to the
session or visitor must not rewrite what an order says about itself, exactly like the existing
price and coupon snapshots.

No foreign key to `AnalyticsSession`. Retention deletes sessions after 13 months while orders
are kept for commercial and tax reasons (§4.7), and a foreign key would either block that
deletion or cascade it into the order. The id is a reference for reconciliation, not a relation.

### 3.2 Migration

Hand-written in the established shape; `Order` is already RLS-guarded, so no policy changes.
Existing orders keep nulls — Phase 5 reports will show pre-analytics orders as unattributed
rather than inventing a source for them.

---

## 4. New modules

| File | Purpose |
|---|---|
| `lib/analytics/whatsapp-value.ts` | Resolve a WhatsApp click's potential value from canonical pricing (**D15**), reusing `lib/pricing.ts` so a discounted product is valued the way the shopper actually saw it. |
| `lib/analytics/order-attribution.ts` | Read the signed session cookie, load the session's dimensions, and shape the snapshot for `placeOrder` (**D16**). Returns nulls rather than throwing when there is no session. |
| `components/analytics/commerce-events.tsx` | The product-page emitters: `PRODUCT_VIEW` on mount, `WHATSAPP_ORDER_CLICK` on the button. |
| `scripts/verify-commerce-analytics.ts` | Financial reconciliation, WhatsApp separation, order snapshots, and checkout independence. |

---

## 5. Changes to existing files

| File | Change |
|---|---|
| `lib/cart/cart.tsx` | Emit `ADD_TO_CART` and `REMOVE_FROM_CART` where state changes (**D19**). The cart must keep working with no tracker mounted, so it calls `useAnalytics()`, which is already a no-op outside a storefront with collection on. |
| `templates/product-client.tsx` | `PRODUCT_VIEW` on mount; `WHATSAPP_ORDER_CLICK` on the WhatsApp button **before** navigation, with `sendBeacon` so the click is not lost to the page going away. The link must keep working if analytics fails (§3.4). |
| `app/store/[slug]/cart/page.tsx` | `CART_VIEW`. |
| `app/store/[slug]/checkout/page.tsx` | `CHECKOUT_STARTED` when the cart is non-empty (**D18**). |
| `app/store/[slug]/checkout/actions.ts` | Resolve attribution and pass it to `placeOrder`. Wrapped so a failure here cannot fail the order. |
| `lib/data/orders.ts` | `placeOrder` accepts an optional attribution snapshot and writes it in the order's own `tx.order.create`. |
| `lib/analytics/ingest.ts` | Compute `valueCents` for `WHATSAPP_ORDER_CLICK` only; every other type keeps writing null. |
| `prisma/schema.prisma` | §3.1. |

---

## 6. Commit sequence

1. **Order columns** — schema, migration, `placeOrder` accepting a snapshot (nothing writes one yet).
2. **Attribution on checkout** — resolve from the session cookie, pass through the action.
3. **Product and cart events** — `PRODUCT_VIEW`, `ADD_TO_CART`, `REMOVE_FROM_CART`, `CART_VIEW`.
4. **Checkout event** — `CHECKOUT_STARTED` at the top of the funnel's last step.
5. **WhatsApp** — the click event and its server-side value.
6. **Verification** — `verify:commerce-analytics`, extended `e2e:analytics`, acceptance doc.

---

## 7. Acceptance checklist

### Money means one thing

| # | Item | Evidence |
|---|---|---|
| P3-01 | An order's value in analytics equals the order's own final payable value, to the cent | `verify:commerce-analytics` — compare against `Order`, including coupons and delivery |
| P3-02 | A client-supplied `valueCents` is still refused | `verify:commerce-analytics` (regression of P2-14) |
| P3-03 | WhatsApp potential value is computed server-side from canonical pricing, including discounts | `verify:commerce-analytics` — forge a price in the request, assert the stored value ignores it |
| P3-04 | Potential WhatsApp value is never added to order value by any shared helper | `verify:commerce-analytics` — static check plus a summing test |
| P3-05 | A cancelled order stays a conversion but leaves non-cancelled value totals | `verify:commerce-analytics` |

### The funnel

| # | Item | Evidence |
|---|---|---|
| P3-06 | A full journey emits exactly one of each step, in order | `e2e:analytics` — browse, view, add, cart, checkout |
| P3-07 | Every event carries the session that produced it | `verify:commerce-analytics` |
| P3-08 | Refreshing a product page does not multiply distinct sessions | `e2e:analytics` |
| P3-09 | `CHECKOUT_STARTED` fires on arrival with a non-empty cart, not on submit | `e2e:analytics` |
| P3-10 | Removing an item emits `REMOVE_FROM_CART` once, from any entry point | `e2e:analytics` |

### WhatsApp

| # | Item | Evidence |
|---|---|---|
| P3-11 | Clicking Order on WhatsApp records the click with product, variant and quantity | `e2e:analytics` |
| P3-12 | The WhatsApp link still opens when analytics is refused or failing | `e2e:analytics` — refuse consent, then click |
| P3-13 | A WhatsApp click creates no order and no revenue anywhere | `verify:commerce-analytics` |

### Orders carry their origin

| # | Item | Evidence |
|---|---|---|
| P3-14 | An order placed in a session records that session, its source and its device | `verify:commerce-analytics` |
| P3-15 | An order placed without consent records nulls and succeeds normally | `verify:commerce-analytics` |
| P3-16 | The snapshot is written in the order's own transaction, not after it | `verify:commerce-analytics` — static check that no post-commit write exists |
| P3-17 | A later session change does not rewrite a past order's attribution | `verify:commerce-analytics` |
| P3-18 | Deleting analytics data (retention) leaves orders intact | `verify:commerce-analytics` — no foreign key to cascade |

### Commerce independence

| # | Item | Evidence |
|---|---|---|
| P3-19 | An order completes when the analytics database is unreachable | `verify:commerce-analytics` — ingestion pool pointed at a closed port |
| P3-20 | An order completes when attribution resolution throws | `verify:commerce-analytics` — forced failure |
| P3-21 | `verify:commerce`, `verify:coupons`, `e2e:checkout` still pass | their own output |
| P3-22 | `verify:ingestion`, `verify:consent`, `e2e:analytics` still pass | their own output |

---

## 8. Risks

- **This phase touches the order transaction**, which is the one place in this codebase where a
  mistake costs money rather than data. Commit 1 adds columns nothing writes; commit 2 writes
  them behind a failure-proof wrapper. P3-19 and P3-20 are the checks that matter most, and they
  should exist before the writing path does.
- **The WhatsApp button is a link.** Its event must be sent without delaying or swallowing the
  navigation, and the link has to work when analytics does not (§3.4).
- **Prices move.** The WhatsApp value is resolved at click time and stored; a later price change
  must not rewrite it, exactly as order items snapshot their price today.
- **Double-firing is easy** when several components can trigger the same state change, which is
  why cart events live in the provider (**D19**) rather than on buttons.

---

## 9. What "Phase 3 complete" means

`PHASE_3_ACCEPTANCE.md` with P3-01..P3-22 showing passing evidence or a stated reason, and the
full suite reproducible from a clean checkout. Still not a release: §13 holds the launch until
Phase 7.
