# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant e-commerce platform built with **Next.js 16 (App Router)** + **PostgreSQL/Prisma 7** + **Auth.js v5** + **Tailwind** + **shadcn/ui**.

**Core concept:** Platform admin creates stores and owner accounts (no self-signup). Store owners manage their storefront independently. The system enforces strict tenant isolation at the app and database levels.

Four user roles:
- **Platform Admin** (`/platform/*`): manages stores, chooses templates/colors for each, resets owner passwords
- **Store Owner** (`/admin/*`): edits content, products, categories, processes orders, and connects their own Google/Meta accounts under Marketing
- **Staff** (`/admin/*`, a subset): one store's employees. Orders and stock only — see "Staff Accounts & Capabilities" below
- **Public shoppers** (`/store/[slug]/*`): browse and purchase (no accounts, cash-on-delivery only)

## Quick Setup

For new developers: follow [SETUP.md](SETUP.md) (10 minutes). New to Next.js? Read AGENTS.md first—this version has breaking changes.

**TL;DR:**
```bash
cp .env.example .env                  # Fill in DATABASE_URL, AUTH_SECRET, PLATFORM_ADMIN_*
pnpm install                          # postinstall runs prisma generate (needs DATABASE_URL)
pnpm db:migrate                       # Create tables
pnpm db:seed                          # Create platform admin
pnpm demo:seed                        # (Optional) "Demo Boutique" store with products
pnpm dev                              # http://localhost:3000
```

## Essential Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server + watch for changes |
| `pnpm build` | Production build |
| `pnpm start` | Run production build locally |
| `pnpm lint` | ESLint check |
| `pnpm typecheck` | tsc --noEmit |
| `pnpm db:migrate` | Apply pending Prisma migrations (creates new migration if schema changed) |
| `pnpm db:deploy` | Apply migrations for production (no prompts) |
| `pnpm db:seed` | Create/reset the platform admin from `PLATFORM_ADMIN_*` env vars |
| `pnpm demo:seed` | Create a full "Demo Boutique" store with products & sample orders |
| `pnpm verify:isolation` | Test tenant isolation (DB-level access attempts must fail) |
| `pnpm verify:commerce` | Test catalog/order/stock logic (category trees, variant rules, concurrent stock deduction) |
| `pnpm verify:templates` | Test all templates × all sections (needs server running) |
| `pnpm verify:permissions` | Test role-based access + the static rule that every admin route names a capability (needs server + login session) |
| `pnpm verify:staff` | Test staff accounts through a real staff session: every row of the D73 table, the refusal page, revocation, the audit row (needs server) |
| `pnpm verify:social-links` | Test tenant social-link fields (validation, storefront rendering) |
| `pnpm verify:campaigns` | Test saved marketing campaigns (D39: names saved by the owner, numbers only ever from the data) |
| `pnpm verify:report-ui` | Test the report screens through a real owner session (exact small numbers, the two money figures never summed, empty funnel steps, deleted products, redacted searches) |
| `pnpm verify:platform-console` | Test `/platform/analytics` (aggregate-only, no person-level data reachable, one audit row per view, owner refused) |
| `pnpm verify:notifications` | Test admin push end to end: the ledger under concurrent senders, delivery leases, the payload rules (no customer data, money opt-in), the endpoint allowlist, owner alerts at §6’s thresholds, platform alerts on transition, and both languages |
| `pnpm verify:report-states` | Test the report screens' states (nothing measured yet, traffic without orders, Redis down, Arabic/RTL, phone cards, admin paths refused on a custom domain) |
| `pnpm verify:e2e-policy` | Static check that every E2E suite has a custom-domain leg and no skip path (no server needed) |
| `pnpm pentest:cross-tenant` | Sign in as store B and try to reach store A over HTTP: every id route, every list page, the platform console, host-based routing, the internal endpoints (needs server) |
| `pnpm load-test` | §12.3's budgets against a **production build** at 30/100/150/300 concurrent (needs `pnpm build && pnpm start`) |
| `pnpm drill:restore` | Dump this database, restore it into a scratch copy beside it, and check the copy: row counts, forced RLS, the runtime role's grants |
| `pnpm verify:config` | Static check that the compose file, `.env.example`, `DOCKPLOY_SETUP.md`, the deploy checklist and the master plan's §14 all agree with `lib/env.ts` — no phantom variable, nothing production needs left unpassed (no server needed) |
| `pnpm verify:edge` | Static check of the edge trust gate (D75): the four modes, the strip list, the single `countryFrom` caller, the https upgrade, and that no committed config enables HSTS (no server needed) |
| `pnpm verify:rate-limit` | Test the Redis-backed limiter against a real Redis: the budget, the trailing window at a boundary, a TTL on every bucket, 50 concurrent callers, and that an old-shape key degrades rather than allows. Needs `REDIS_URL` and **fails** without one |
| `pnpm verify:icons` | Static check of the installable apps' icons: every manifest `src` resolves to a real PNG of the size it claims, both apps' marks differ, no orphans (no server needed) |
| `pnpm icons:build` | Re-render `public/icons/*.png` from `assets/icon-{admin,platform}.svg` (needs Chrome). Commit what it writes |
| `pnpm verify:reports` | Test the report read layer (aggregate-only rule, store-local date ranges across DST, null-not-zero rates, trend thresholds) |
| `pnpm verify:insights` | Test §6's insight rules at, just below and just above every threshold (pure; no server or database) |
| `pnpm verify:integrations` | Test the owner's Google/Meta connections: snippet extraction, consent gating, verification tags on a custom domain, audit rows (needs server) |
| `pnpm uploads:migrate --rewrite-from=<old URL>` | Rewrite stored R2 URLs after moving buckets/domains |
| `pnpm e2e:categories` / `e2e:variants` / `e2e:discounts` / `e2e:social-links` / `e2e:pages` / `e2e:checkout` / `e2e:kinetic` / `e2e:mirage` / `e2e:prism` | Chrome automation tests, one per feature area (needs server + Chrome installed; each creates/removes throwaway stores) |

**After pulling changes:**
```bash
git pull
pnpm install                      # if package.json changed
pnpm db:migrate                   # if prisma/migrations changed
# IMPORTANT: Restart `pnpm dev` — it caches the old Prisma client
```

## Architecture

### Tenant Isolation (Defense in Depth)

Three layers:

1. **Proxy routing** (`proxy.ts`): reads the JWT only, gates `/platform/*` and `/admin/*` by role, redirects to mandatory password change. Optimistic; not a security boundary on its own.

2. **App-level WHERE clauses** (`lib/data/*.ts`): every function takes a `tenantId` and includes it in WHERE conditions. `ProductVariant` has no `tenantId` field, so variant queries go *through* products (`where: { id, product: { tenantId } }`).

3. **Database Row-Level Security** (RLS, `prisma/migrations/*_row_level_security`): when `APP_DATABASE_URL` points to a restricted role, RLS policies on 25 tenant-scoped tables — the original 9 (`Category`, `Product`, `ProductVariant`, `ProductImage`, `TenantContent`, `Order`, `OrderItem`, `DiscountCampaign`, `DiscountProduct`), the coupon tables, `TenantLicense`, the consent receipt, the analytics collection tables, the analytics aggregates, `MarketingCampaign` and the five notification tables — automatically filter results. Enforced via `lib/prisma.ts`'s `withTenant()` (sets session context per transaction) and `withBypass()` (for cross-tenant platform-admin queries). **Dependencies:** the restricted role must be created with `scripts/sql/rls-role.sql`, and `APP_DATABASE_URL` must be set in every environment, or RLS silently doesn't run. `pnpm verify:aggregates`' P4-23a reads `pg_class`/`pg_policies` and fails when a table with a `tenantId` has no forced policy, so a migration cannot add one quietly.

**User and Tenant tables are intentionally NOT under RLS** (v1 scope): login looks up users by email before any tenant context exists, and the storefront resolves a Tenant by slug the same way — still guarded only by application code.

### Key Files

| File | Purpose |
|------|---------|
| `lib/session.ts` | `requireOwner` / `requirePlatformAdmin` — re-checks DB on every render/action to catch password resets + deleted tenants immediately |
| `lib/prisma.ts` | Prisma client setup, `withTenant()` / `withBypass()` transaction wrappers for RLS |
| `lib/data/*.ts` | All queries scoped by `tenantId`; exports wrapped-query variants for use inside `withTenant` |
| `lib/roles.ts` | Role union (`PLATFORM_ADMIN`/`STORE_OWNER`/`STAFF`), `AdminRole`, `homeForRole` |
| `lib/permissions.ts` | **The capability table** — what each in-store role may do, plus `can()` and `requireCapability()`. Default deny |
| `lib/data/staff.ts` | Staff accounts: create/list/revoke/reset. Writes the audit row itself, so a caller cannot omit it |
| `lib/env.ts` | Environment validation (fails fast at startup if anything's missing/invalid) |
| `lib/edge.ts` | What may be believed about where a request came from (D75): the trust gate, the forgeable-header strip, the https upgrade, the response security headers |
| `app/actions/auth.ts` | Login, logout, password change |
| `proxy.ts` | Custom-domain host routing, path-based → domain redirect, auth role gates |
| `templates/meta.ts` | Canonical `TEMPLATE_IDS` registry (13 templates: minimal, classic, tonkic, fashion, luxury, atelier, atlas, pearl, drop, kinetic, mirage, muse, prism) + per-template default colors; `normalizeTemplateId` falls back unknown/legacy ids to `minimal` |
| `templates/*` | Each template dir implements 11 sections + product page per `templates/types.ts` contract |
| `lib/sections.ts` | Canonical content keys for the 11 sections (announcement, navbar, hero, featured categories, new arrivals, best sellers, promo, brand story, reviews, FAQ, footer) |
| `templates/store-footer.tsx`, `templates/store-faq.tsx` | The two sections shared across all 13 templates instead of reimplemented per template: one component + a per-template `look` style table (`FooterLook`/`FaqLook`) |
| `lib/license/*` | Store licensing/entitlement: `crypto.ts` (encrypt/decrypt license secrets), `provider.ts` (calls the external license API), `service.ts` (activate/heartbeat flow), `status.ts` (`isLicenseActive`/`canServeTenant` gating) |

### Common Patterns

#### Protecting Server Actions & Pages

```typescript
import { requireCapability } from "@/lib/permissions";
import { requirePlatformAdmin, requireTenantMember } from "@/lib/session";

// Every page and action under app/admin names ONE capability. This is enforced statically by
// pnpm verify:permissions: a route that names none fails the check.
const { tenantId, role } = await requireCapability("orders:read");

// Platform console:
const admin = await requirePlatformAdmin();

// Only for surfaces that grant nothing beyond "you work here" (the panel shell, the language
// switch, change-password). Listed by name in verify:permissions' SELF set.
const member = await requireTenantMember();

// tenantId is always from the session, never from form data
```

`requireOwner` still exists and still means *owner*; nothing under `app/admin` calls it any
more. It was deliberately **not** widened to admit staff — a guard that refuses too much fails
in the safe direction, and renaming it across every call site two weeks before a pilot was the
larger risk.

#### Querying Tenant Data

```typescript
import { getTenantProducts, createProduct } from "@/lib/data/products";
import { prisma, withTenant } from "@/lib/prisma";

// High-level: function already takes tenantId
const products = await getTenantProducts(tenantId);

// Low-level: use withTenant for a custom query
const result = await withTenant(tenantId, async (tx) => {
  return await tx.product.findMany();  // RLS filters this automatically
});

// Platform admin: cross-tenant, use withBypass
const allProducts = await withBypass(async (tx) => {
  return await tx.product.findMany();
});
```

#### Content & Sections

- Content lives on `TenantContent` by canonical key (defined in `lib/content.ts`, grouped by section).
- Templates never hardcode text or colors; they read everything from `TenantContent`.
- Section visibility is on `Tenant.sectionVisibility`; optional sections (announcement, promo, brand story, reviews, FAQ) can be hidden.
- The 11 sections are in a fixed order (`SECTION_ORDER` in `lib/sections.ts`) — no reordering yet.

#### Variants & Stock

- Every product has at least one variant (a product without variation has one default variant with `attributeKey: null, attributeValue: null`).
- Variants share attribute *names* but differ in *values*; typos in attribute names create new attributes.
- Stock lives on `ProductVariant` — stock deduction is a conditional UPDATE in the order transaction (`UPDATE ... WHERE stock >= qty`), failing cleanly if another buyer took the last unit.
- Variant queries go through products: `where: { id, product: { tenantId } }`.
- **Stock has its own narrow write**: `setVariantStock` + `setVariantStockAction` + `/admin/products/[id]/stock`, because the product form replaces the whole product. That separation is what makes `products:stock` grantable to staff without also granting name, price and images.

#### Images & Uploads

- Image uploads go to Cloudflare R2 (production) or `public/uploads/` (dev) via `lib/storage.ts`.
- Remote images are SSRF-guarded (fetch with private-IP block, 3 redirects, 10s, 5MB).
- Only raster images (PNG/JPG/WEBP/GIF) via magic-byte sniff; SVG rejected (XSS risk).
- Uploads served from the platform's origin with a sandbox CSP + `nosniff` header (`next.config.ts`).
- No image deletion (orphaned R2 objects just cost storage); old R2 URLs are never removed from the database.

### Data Model Highlights

- **Tenants** have `sectionVisibility`, `themeOverrides` (CSS vars), `domain` (nullable, unique, verified-and-live), integrations (GA4, Meta, Google Ads IDs), favicon, social links (`facebookUrl`, `instagramUrl`, `tiktokUrl`, `googleMapsUrl`), `whatsappNumber`, `deliveryFeeCents`/`deliveryNote`, and `isPaused`/`pausedAt`/`pauseReason` (platform-admin manual kill switch, independent of licensing).
- **Users** have `mustChangePassword` (platform admin can force an owner to change) and `sessionVersion` (bumped when password reset to revoke live sessions).
- **TenantLicense** (one per tenant) holds encrypted license key/activation token ciphertext, `status`, `expiresAt`, `offlineGraceUntil`, and heartbeat bookkeeping (`checkAfter`, `lastCheckedAt`, `lastError`) for the self-hosted licensing system — see "Licensing & Store Availability" below.
- **Categories** form a tree (`parentId`); a category page shows its products + everything in subcategories; can't be deleted if it has subcategories or products.
- **Products** have a slug (never changes on rename, keeping old URLs valid), `isBestSeller` flag (manual, not sales-driven), and a `tenantId`.
- **MarketingCampaigns** are campaigns a store owner saved while building a tracked link (one per
  `utm_campaign` value, tenant-scoped, forced RLS). They hold a name, the normalized utm value, the
  channel and destination the link used — and **no numbers**: every campaign figure comes from the
  acquisition aggregates, so a report never depends on whether the owner saved the campaign, and
  a campaign that was never saved still shows up with its real traffic.
- **Admin notifications** (Phase 6, in progress) are a ledger, not a queue: `AdminNotification`
  is one logical "this person was told this" with a unique `dedupeKey`, `AdminNotificationOrder`
  is unique on (recipient, order) so one order is announced once, and
  `AdminNotificationDelivery` is one row per device with a lease so two senders cannot both send.
  `PushSubscription` holds an encrypted endpoint (it is a capability — whoever holds it can push
  to that device) plus a keyed hash to look it up by. `lib/notifications/types.ts` maps a role to
  the notification types it may receive, and `lib/data/notifications.ts` refuses anything outside
  that set before writing a row.
- **DiscountCampaigns** apply an automatic percentage or fixed per-unit discount to assigned products. Eligible campaigns never stack; the lowest final price wins. Campaign names are admin-only.
- **ProductVariants** live under products (no direct `tenantId`); stock, optional price/image override, free-form attributes. One variant per product minimum.
- **Orders** go Pending → Confirmed → Delivered (or can be Cancelled at any point); cancelling restores stock exactly once. Cancelled and Delivered are final. Orders snapshot `deliveryFeeCentsSnapshot`/`deliveryNoteSnapshot` from the tenant's settings at purchase time.
- **OrderItems** snapshot the product name, attributes, and price from the moment of purchase — editing a product doesn't affect past orders.

## Storefront & Templates

### How Templates Work

- `templates/render.tsx` decides section visibility and order (so a template can't get it wrong).
- Each template (e.g., `templates/atelier/index.tsx`) implements 11 section components + product page.
  Footer and FAQ are the two sections most templates don't reimplement: they wire in the shared
  `StoreFooter`/`StoreFAQ` components (`templates/store-footer.tsx`, `templates/store-faq.tsx`) with
  their own `look` value instead.
- `templates/types.ts` is the contract all templates follow.
- Colors are injected as CSS variables at the root by `components/theme-scope.tsx` (from `Tenant.themeOverrides`).

### Content Editor Preview

- `/admin/content`: store owner edits their storefront's text, images, and section switches. Live preview on the right (client-side, real template code). One Save button; section switches save immediately.
- `/admin/preview`: the preview route (renders the real template client-side with the owner's saved content/theme).

### Platform Admin Theme Editor

- `/platform/stores/[slug]/theme`: platform admin picks a template, sets colors/schemes, and adjusts layout. Live preview in an iframe (`/platform/preview/[slug]`). Color changes reach the preview via `postMessage`.

### SEO & Analytics

- Every storefront page has a title, meta description, canonical URL, Open Graph tags.
- Structured data (JSON-LD): `WebSite` + `Organization` on home, `Product` with `AggregateOffer` on product pages.
- Integrations: per-store GA4 ID, Meta Pixel, Google Ads IDs, Google Search Console and Meta domain verification, sitemap/robots.txt. **The owner sets these themselves** at `/admin/marketing/integrations` (D40); the platform admin can also edit or clear them from `/platform/stores/[slug]/analytics`. Either way the write is appended to `AnalyticsAuditLog` with the actor and the before/after values. The owner cannot read, edit or erase that log; the one window onto it is `lastIntegrationChanges` (D40b), which tells each screen who last changed a given field and when — an actor and a timestamp, newest only, no values. Whatever is pasted — a `<meta>` tag, a gtag or fbq snippet, an `AW-123/label` pair — is reduced to the id by `lib/integrations.ts`; markup and script text are never stored.
- The two verification tokens render for **every** visitor, consent or not: they prove domain ownership rather than watching anyone. The measurement ids are narrowed by `grantedConfig` **on the server**, so a visitor who declines advertising never receives them at all.
- `lib/analytics.tsx` mounts tracking tags (only in storefront, never in admin previews).
- Purchase event deduped by `eventID = orderId` and fires once per browser within 30 min of order.

## Admin Push Notifications (Phase 6)

- Two installable identities: the merchant admin (`/admin`) and the platform console
  (`/platform`), each with its own manifest route linked from its own layout — never from the
  root, which would offer a shop's customers the admin app. `public/sw.js` handles `push` and
  `notificationclick` and **caches nothing**: no fetch handler, no Cache API (D57).
- **Both manifests are public, and that is deliberate** (`PUBLIC_CONSOLE_PATHS` in `proxy.ts`).
  A browser fetches a manifest with `credentials: "omit"`, so the `/admin` role gate saw an
  anonymous request and redirected it to `/login` — which meant neither app could be installed
  by anyone, signed in or not, while every page behind the gate looked correctly protected. A
  manifest is a name, a colour and a list of icons, identical for every store. On a store's own
  domain both are still 404: `PLATFORM_ONLY_PREFIXES` is now checked *before* the static-file
  passthrough, because `.webmanifest` has a dot in it and was being handed straight through.
- **Icons** (D76): `assets/icon-{admin,platform}.svg` → `pnpm icons:build` → eight committed
  PNGs. The set is declared once in `lib/push/icons.ts`, which the generator, `manifest.ts` and
  `verify:icons` all read, so a manifest cannot name a file nobody generates. The two marks
  differ in shape *and* colour on purpose, and iOS needs the `apple-touch-icon` link in each
  subtree's metadata because it ignores manifest icons entirely.
- **A push never costs an order.** `app/store/[slug]/checkout/actions.ts` schedules
  `announceNewOrderSafely` with `after()` after the transaction commits; the sender has a ~2.5s
  timeout and never throws. Anything missed is picked up by the `new-order-catch-up` stage.
- **What a payload may say** (`lib/push/payload.ts`, D50): the fact, the count and a destination.
  No customer name, phone, address, note or product list, ever. The order amount is opt-in and
  **off by default** (`OwnerNotificationPreference.showOrderAmount`).
- **One order, one notification**: a unique `dedupeKey` on `AdminNotification`, a unique
  `(recipientUserId, orderId)` on `AdminNotificationOrder`, and a lease on each
  `AdminNotificationDelivery` — three layers because they fail differently (D52).
- **A device's endpoint must be a real push service** (`lib/push/endpoint.ts`, D61): https, no
  credentials in the URL, and one of the known push hosts. Enforced at registration and again in
  the sender. `PUSH_TEST_ENDPOINT_HOST` relaxes it by `host:port`, outside production only.
- **Who may receive what** (`lib/notifications/types.ts`, D60): a role maps to the types it may
  receive, and the writer refuses the rest before a row exists. A future non-owner staff role
  gets new orders and nothing else.
- Owner alerts read `lib/analytics/insights.ts` and invent no thresholds (D54); platform alerts
  fire on the **transition** recorded in `NotificationAlertState`, not on the condition (D55).
- `User.adminLocale` persists the dashboard language, because a scheduled job has no cookie
  (D58). Notification wording lives in `lib/notifications/templates.ts`, not the dictionaries.

## Staff Accounts & Capabilities

Added in Phase 7 (D70-D73). A third principal in an isolation model that had two since Phase 1.

- **`Role.STAFF`, not a flag.** A new enum value makes every exhaustive `switch` a compile error
  until considered; `User.isStaff` would have left every existing `role === "STORE_OWNER"` check
  silently true for staff.
- **One store, enforced by the database.** `User.staffTenantId` plus a CHECK constraint
  (`User_staff_tenant_required`): STAFF implies exactly one store, anything else implies none. A
  staff account with no tenant would be a principal with no isolation scope.
- **RLS needed no change.** Every policy keys on the tenant, not the user, so it already covers
  a principal that did not exist when it was written. Staff go through the same `withTenant()`.
- **One capability table** (`lib/permissions.ts`), default deny. `verify:permissions` fails on an
  admin route that names no capability, so a new screen is refused to staff until somebody writes
  down what it is for.
- **What staff may do** (D73): open Orders and an order's detail *including the customer's phone
  and address* (you cannot deliver without them), advance Pending -> Confirmed -> Delivered, read
  products and categories, edit variant stock, and manage their own notification devices. They
  may **not** cancel an order (it restores stock and is final), write a product, see any report
  or marketing screen, touch settings, or manage staff.
- **Refusals land on `/admin/no-access`**, never `/login` (the cookie is valid and the proxy
  admits both store roles to `/admin`, so `/login` would loop) and never a 404 (the page exists,
  it is just not theirs).
- **The nav is filtered from the same table the pages enforce**, so a link can never offer
  something the page behind it would refuse.
- **Notifications**: `NOTIFIABLE_TYPES.STAFF = ["NEW_ORDER"]` (D60), enforced in the writer before
  a row exists. Staff never receive an analytics alert.
- **Every grant, reset and removal leaves an audit row** (`STAFF_CHANGE` in `AnalyticsAuditLog`),
  written in `lib/data/staff.ts` rather than in the action so it cannot be omitted. Removal is a
  delete; the live session dies on the next request because `lib/session.ts` re-reads the user.
- **No invitation email.** The platform has never had outbound mail. The owner sets a first
  password, shown once, with `mustChangePassword` set.

## Authentication & Sessions

- **Login:** rate-limited per IP (8 attempts / 5 min). No CAPTCHA or account lockout yet.
- **Password reset:** platform admin can issue a one-time password from `/platform/stores/[slug]`; owner must change it on next login (` mustChangePassword`). No self-service "forgot password" email flow.
- **Session revocation:** `User.sessionVersion` is stamped into the JWT at login. An admin password reset or the owner changing their own password bumps it. Any token with a stale version is sent to `/force-logout`, which clears the session cookie and redirects to `/login` (not straight to `/login`, because the JWT would just bounce an already-"authenticated" owner back to `/admin`).
- **RLS & delayed logout:** `requireOwner` and `requirePlatformAdmin` re-check the user in the DB on every render/action (deduped per request with React's `cache()`), so a deleted tenant or a password reset takes effect on the very next request, not just the next login.

## The Edge (Phase 7)

Where a request came from, and what the app is allowed to believe because of it. The runbook is
[EDGE_HARDENING.md](EDGE_HARDENING.md); the code is `lib/edge.ts`. All four variables default to
the pre-Phase-7 behaviour, so a deployment that sets none of them behaves exactly as it did.

- **The problem.** `cf-ipcountry` and `cf-connecting-ip` are right behind an edge and forgeable
  without one: anyone who can reach the origin directly can write a country of their choosing
  into the analytics tables and rotate their rate-limit bucket per request. The real fix is at
  the reverse proxy (origin accepts only Cloudflare's ranges, edge headers stripped from
  everything else) — documented, not in this repository, because Dokploy's Traefik is shared
  with every other deployment on the box.
- **What the app enforces.** `EDGE_TRUST_MODE=cloudflare` believes a request only when it carries
  `EDGE_SHARED_SECRET` in `x-edge-token` (a Cloudflare Transform Rule adds it; a direct client
  cannot guess it). A shared secret, not an IP range, because the socket's peer address never
  reaches Next — every request's peer is the local proxy. `lib/env.ts` refuses to boot in
  `cloudflare` mode with no secret: trusting nothing looks exactly like a correctly guarded
  origin.
- **One gate, not one per reader.** `countryFromTrusted` (in `lib/edge.ts`) is the only
  legitimate caller of `countryFrom`, and `verify:edge` fails if anything else calls it. An
  untrusted request yields `null` — unknown, never a guess.
- **`TRUSTED_PROXY_COUNT` is 2 behind Cloudflare**, not the shipped default of 1. In
  `cloudflare` mode a trusted request does not use it at all (`cf-connecting-ip` is the client),
  which is the point: one number that must match the deployment's shape, where off-by-one puts
  either every visitor or the whole internet into one rate-limit bucket, silently.
- **Response headers** (`securityHeaders()`, applied by `proxy.ts` to every response it
  produces, redirects and 404s included): `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`. Deliberately **not** `X-Frame-Options` (the theme and content editors
  render a store in an iframe) and **not** a CSP (storefronts inject each owner's own GA4/Meta
  snippets; a useful policy needs per-request nonces through 13 templates — see KNOWN_GAPS.md).
- **HSTS is off in every committed configuration** and is turned on by hand, last, after the
  pilot has served a week (D74). `EDGE_HSTS_MAX_AGE` needs `EDGE_FORCE_HTTPS=true`, and
  `verify:edge` fails if `.env.example` or `docker-compose.yml` ever ships a non-zero value.
- **The orange cloud and custom domains conflict (D84).** `checkDomainResolves` requires a
  domain's A record to equal `SERVER_PUBLIC_IP`, and a Cloudflare-proxied domain resolves to
  Cloudflare. So a domain must be **connected while DNS-only (grey cloud)** and proxied
  afterwards; changing it later means turning the proxy off, saving, and turning it back on.
  Written down rather than fixed: widening that gate would weaken the one check behind
  `Tenant.domain`'s "verified and live" contract.

## Licensing & Store Availability

- The app is self-hosted/sold with a per-tenant license (see `LICENSE_SETUP.md`). `lib/license/provider.ts` calls an external license API (`LICENSE_API_BASE_URL`, `LICENSE_PRODUCT_CODE`); `lib/license/crypto.ts` encrypts license keys/activation tokens at rest with `LICENSE_ENCRYPTION_KEY` (the browser never sees the raw key or token).
- Platform admin activates a license from `/platform/stores/[slug]` (`store-license-control.tsx`), which calls `lib/license/service.ts`'s `activateTenantLicense`.
- `POST /api/internal/license-heartbeat` (auth'd with `LICENSE_HEARTBEAT_SECRET`, meant to be hit by a cron every ~5 min) only contacts the provider for licenses whose `checkAfter` is due, and records failures; see `lib/data/licenses.ts`.
- **`TenantLicense` is RLS-guarded, so its gate columns are read through `getLicenseAccessSnapshot` (`lib/data/licenses.ts`), not as an `include`.** `getTenantBySlug` resolves a store by slug with no tenant context, where an include would come back null for every store — and `isLicenseActive(null)` is `true` by design during the opt-in rollout, so licensing would stop being enforced without an error. `verify:isolation` holds both halves down.
- `lib/license/status.ts`'s `canServeTenant()` = `!tenant.isPaused && isLicenseActive(...)` gates storefront/checkout availability. A license temporarily unreachable is tolerated only within its `offlineGraceUntil` window. Tenants without any assigned license are allowed (opt-in rollout). Manual `isPaused` (platform admin) is a separate, always-available kill switch.

## Performance & Scaling Notes

- **Connection pool:** `max: 30` (up from node-postgres default of 10). Two sets of numbers,
  because they were taken on different machines and neither replaces the other. Re-take them
  with `pnpm load-test` against `next build && next start` — **never `next dev`**, whose numbers
  measure the compiler.

  | Concurrent | Earlier run | 2026-11-06 (`pnpm load-test`, dev laptop) |
  |---|---|---|
  | 30 | p50 550ms, 0 fail | p50 1129ms, p95 2043ms, 0 fail |
  | 100 | p50 1.4s, 0 fail | p50 3545ms, p95 4291ms, 0 fail |
  | 150 | p95 ~2.9s, 0 fail | p50 4855ms, p95 5764ms, 0 fail |
  | 300 | 10% fail (500) | **64% fail (500)**, p50 7920ms |

  The November run had PostgreSQL, the app and the load generator on one laptop, so it measures
  contention between them as much as the application — the figures are not comparable, and the
  one that will count is the VPS run before the pilot (P7-23). What *is* comparable is the
  failure mode: every 500 at 300 concurrent is Prisma's `Unable to start a transaction in the
  given time`, the pool's `maxWait`, exactly as the earlier run recorded.
- **§12.3's own budgets:** 30-day dashboard p95 851ms (budget 1.5s) and active-now p95 67ms
  (budget 300ms) are comfortable. **Ingestion was recorded as over budget and is not.** The
  first run measured p95 192ms at 5 concurrent; a re-run against a fresh production build the
  same day, with `--ingest-levels=1,5,30`, measured **9ms at 1, 39ms at 5, 166ms at 30** — so
  one request costs 9ms and expected load is well inside the 150ms budget. The first figure was
  taken while several suites were running on the same laptop. A batch is 5-7 statements and
  **7.6ms inside Postgres**, so the database is not the cost at any level. Only 30 sustained
  writers is marginally over, with a p99 tail of 979ms. Both runs and the method are in
  KNOWN_GAPS.md; **always measure level 1**, or there is nothing to attribute a slow level to.
- **Rate limiting is Redis-backed with in-memory fallback** (`lib/redis.ts`, `lib/rate-limit.ts`):
  set `REDIS_URL` to share limits across instances; without it, or when Redis cannot answer, each
  instance limits independently. It **does not fail open** — `redisRateLimit` reports
  `available: false` and the caller applies the in-memory limiter, because an unreachable Redis
  once *was* reported as "allowed" and that turned every limit off at once. The
  domain-resolution cache is still in-memory per-instance regardless.
- **Both backends are a trailing window, and the Redis one is a single atomic script.** It used
  to be `INCR` + `EXPIRE`, which was wrong twice: a fixed window (so the shared limiter — the
  production one — allowed up to 2x the budget across a boundary, while the in-memory fallback
  did not), and two round trips (a process dying between them left a bucket holding a count with
  no TTL, which nothing clears, so that address was rate limited *permanently* with nothing
  logged). Buckets are sorted sets of hit timestamps under a versioned `rl:v2:` prefix, so they
  can never meet an old integer key. A refused hit is not recorded, or retrying would push the
  window forward and extend a block for as long as a client kept trying. `pnpm verify:rate-limit`
  holds all of it down; six of its checks fail against the old implementation.
- **Storefront data:** `loadStorefrontData` runs 5 reads inside one `withTenant` transaction (was 5 separate ones, costing 5 pooled connections per page load).

## Important Gotchas

- **Restart `pnpm dev` after DB migrations.** A running dev server caches the old Prisma client and throws "Cannot read properties of undefined" until restarted.
- **Prisma client generation needs `DATABASE_URL` at install time.** Copy `.env.example` → `.env` before `pnpm install`.
- **AGENTS.md and CLAUDE.md are hand-maintained.** This entry used to say `next dev` regenerates them from `scripts/generate-agent-files.js`; that script does not exist in the repository, and the working tree stays clean across dev-server restarts. AGENTS.md is the Next.js rules file from `create-next-app`; this file is ours. Edit them directly.
- **Self-hosting requires `AUTH_TRUST_HOST=true`.** Auth.js rejects every sign-in under `next start` without it.
- **Stale PENDING orders auto-cancel.** Run lazily when an owner opens `/admin/orders` — anything PENDING older than 24 hours is cancelled. No scheduler runs it independently.
- **Custom domains need `SERVER_PUBLIC_IP` and DNS validation.** Tenant.domain is "verified-and-live" — the platform admin must confirm the domain's DNS resolves to the server IP before saving. A **Cloudflare-proxied** domain resolves to Cloudflare and is therefore refused: connect it grey-clouded first (D84, EDGE_HARDENING.md §7).
- **`lib/env.ts` is the only authority on what an environment variable is called.** Everything else — `docker-compose.yml`, `.env.example`, `DOCKPLOY_SETUP.md`, the deploy checklists, §14 of the master plan — is checked against it by `pnpm verify:config`, because the failure mode is silent in both directions: a variable that is documented and never read (three such entries were in §14, and all four push variables were once named `WEB_PUSH_*`), and a variable the app requires that the deployment never passes (`DOCKPLOY_SETUP.md` listed 8 of 49, missing all three that production refuses to boot without). **`docker-compose.yml` is not the production path** — the app is built from the Dockerfile with its environment set in Dockploy's UI — but it is what the load test and `docker compose up` use, and `environment:` there is a whitelist.

## Testing & Verification

No automated test suite yet. Manual verification scripts + browser E2E tests:

- `pnpm verify:isolation`: app-level tenant isolation (DB access attempts must fail).
- `pnpm verify:commerce`: category trees, variant rules, stock deduction (concurrent), order snapshots, cancellation.
- `pnpm verify:templates`: all 13 templates × 10 sections, switches, live preview in admin/platform.
- `pnpm verify:permissions`: role-based access via real login sessions + the static rule that every admin page, layout and action names a capability from `lib/permissions.ts` (and that staff hold exactly six of them).
- `pnpm verify:staff`: a real staff session walked across every row of D73 — what opens, what refuses (each to `/admin/no-access`), the sidebar, notifications, revocation, cross-store isolation, and the audit row.
- `pnpm verify:social-links`: tenant social-link field validation and rendering.
- `pnpm verify:reports`: the report read layer — that it reads aggregates only (by walking its own imports), that a date range means store-local days across a 23- and a 25-hour day, that a rate with no denominator is null rather than 0, and that a trend is withheld below its sample floor.
- `pnpm verify:insights`: every §6 threshold exercised at the line, one below it and one above, plus the rules that a redacted search phrase never becomes a suggestion, that an unmeasured figure is treated as unknown rather than low, and that no insight asserts a cause.
- `pnpm verify:integrations`: what an owner pastes is reduced to an id (no markup, no script), a malformed value is refused with its expected shape, consent nulls the advertising ids server-side, the verification tags are present for a visitor who declined **and on the store's own domain**, and every integration write leaves one audit row while a no-op leaves none.
- `pnpm pentest:cross-tenant`: the attack an actual tenant can mount — a real session, a real
  cookie, and another store's id. Every attempt is **paired with the legitimate version of the
  same request**, so a refusal cannot pass because the route 404s for its owner too, and every
  refusal is judged by the response body rather than the status code. It prints what it tried
  and what it left to the other suites.
- `pnpm drill:restore`: a backup is a hypothesis until it is restored. Dumps, restores into a
  scratch database, then checks the copy for row counts, forced RLS, and the runtime role's
  grants — `pg_dump` writes no `CREATE ROLE`, so a restore onto a fresh machine has no
  `app_user`, and "fixing" that by pointing `APP_DATABASE_URL` at the owner turns RLS off
  silently.
- `pnpm e2e:*`: Chrome automation, one script per feature (categories, variants, discounts, social-links, storefront pages, checkout, kinetic/mirage/prism template-specific flows).

### Custom-domain legs are mandatory, and a skip is a failure

Every E2E suite must exercise its feature on a store's **own domain** as well as the shared
host, and **a leg that cannot run must fail** — never a skip, never a skip reported as a pass.

A custom domain changes the origin, the cookie path, the secure context and the proxy's host
routing at once, so it is the other half of the product rather than a variation of the shared
host. Two consecutive phases shipped total data loss that every shared-host check called
healthy: a consent cookie scoped to `/store/<slug>` that never reached a domain root, and event
ids that are not UUIDs off localhost (`crypto.randomUUID` is secure-context-only), which made
the contract refuse every batch with a 400. The second was found only because a custom-domain
leg was added — and that leg's first run skipped itself with a plausible excuse.

- Use `scripts/e2e/custom-domain.ts` (`onCustomDomain`, `assertDevOriginAllowed`,
  `PRODUCTION_BUILD_HINT`). Chrome resolves the hostname via `--host-resolver-rules`, so no
  hosts file and no elevation.
- Add each `*.test` hostname to `allowedDevOrigins` in `next.config.ts`, or `next dev` serves
  the page and withholds its JavaScript.
- `pnpm verify:edge`: the trust gate at each mode, that every header the country reader looks
  at is stripped from an untrusted request, that nothing but `lib/edge.ts` calls `countryFrom`,
  and that HSTS is absent from every committed configuration. Static on purpose — the live
  checks (P7-12 to P7-16) need the real domain and run at the pilot.
- `pnpm verify:e2e-policy` enforces all of this statically. Every suite now has its leg — the
  nine that predated the policy were paid off in Phase 7 — so its `PENDING_LEG` set is empty and
  stays that way: a suite added without a leg fails the check, and the fix is to write the leg.
- A template's leg calls `assertStorefrontDomainBasics` (`scripts/e2e/custom-domain.ts`) for the
  three things every template owes a store with a domain — root-relative links, no overflow, its
  routes answering — and then asserts its own thing, which for the motion templates is that the
  client code ran at all (a `.pin-spacer`, or an inline style GSAP wrote).

## Development Tips

1. **When adding a new field to a table:** run `pnpm db:migrate` (creates a migration in `prisma/migrations`), commit it with your code changes.
2. **Tenants are always scoped by the session:** never pass `tenantId` from URL params, form data, or cookies. Always from the JWT (via `requireOwner` / `requirePlatformAdmin`).
3. **Content keys are plain strings** (typos compile). Use `pnpm verify:templates` to catch non-canonical keys statically.
4. **Optional sections need content to appear.** If a section is switched on but has no text, it renders nothing (no warning yet).
5. **Page editors show home and product pages only** — not shop, category, cart, checkout, or content pages.
6. **Custom domains:** verify with `lib/domain-check.ts` (Node-only, use only in Server Actions). Keep it separate from `lib/domain-format.ts` (pure, dependency-free, usable in client components).

## Known Gaps

See [PHASE_5_ACCEPTANCE.md](PHASE_5_ACCEPTANCE.md) for what the analytics and marketing screens are proven to do, and [KNOWN_GAPS.md](KNOWN_GAPS.md) for:
- Intentional MVP limitations (e.g., no caching, cart is in-memory only, no pagination on admin products).
- Production readiness TODOs (e.g., no automated scheduler, etc.).
- Rough edges flagged for future work (e.g., `ContentKey` is untyped, content editor doesn't warn about missing-content optional sections).

## Production Deployment

The app is deployed to production via Dockploy (Docker Compose: Next.js + Postgres + Redis behind a reverse proxy):
- [DOCKPLOY_SETUP.md](DOCKPLOY_SETUP.md): step-by-step first-time deployment.
- [PRODUCTION.md](PRODUCTION.md): environment variables and service configuration reference.
- [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md): pre-launch checklist.
- [PHASE_7_DEPLOY_CHECKLIST.md](PHASE_7_DEPLOY_CHECKLIST.md): the ordered runbook from merge to `ANALYTICS_ROLLOUT_MODE=all` — the environment first (it is the step that decides whether the container boots), then off → verify → pilot → all, with a rollback table.
- [HUMAN_CHECKLIST.md](HUMAN_CHECKLIST.md): the steps no script can take (the domain, the production keys, the `app_user` queries, the retention dry run, real devices, legal sign-off).
- [EDGE_HARDENING.md](EDGE_HARDENING.md): Cloudflare and reverse-proxy hardening, in the order it is turned on, with the break-glass path (see "The edge" below).
- [LICENSE_SETUP.md](LICENSE_SETUP.md): licensing env vars and heartbeat cron setup (see "Licensing & Store Availability" above).

---

**New to the project?** Start with SETUP.md, then browse the app at `/store/demo-boutique` (storefront), `/admin` (owner panel), and `/platform` (admin console) after running `pnpm demo:seed`.
