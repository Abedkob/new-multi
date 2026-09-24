# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant e-commerce platform built with **Next.js 16 (App Router)** + **PostgreSQL/Prisma 7** + **Auth.js v5** + **Tailwind** + **shadcn/ui**.

**Core concept:** Platform admin creates stores and owner accounts (no self-signup). Store owners manage their storefront independently. The system enforces strict tenant isolation at the app and database levels.

Three user roles:
- **Platform Admin** (`/platform/*`): manages stores, chooses templates/colors for each, resets owner passwords
- **Store Owner** (`/admin/*`): edits content, products, categories, and processes orders for their own store
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
| `pnpm verify:permissions` | Test role-based access (needs server + login session) |
| `pnpm e2e:categories` / `e2e:variants` / `e2e:pages` / `e2e:checkout` | Chrome automation tests (needs server + Chrome installed) |

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

3. **Database Row-Level Security** (RLS, `prisma/migrations/*_row_level_security`): when `APP_DATABASE_URL` points to a restricted role, RLS policies on 9 tenant-scoped tables (`Category`, `Product`, `ProductVariant`, `ProductImage`, `TenantContent`, `Order`, `OrderItem`, `DiscountCampaign`, `DiscountProduct`) automatically filter results. Enforced via `lib/prisma.ts`'s `withTenant()` (sets session context per transaction) and `withBypass()` (for cross-tenant platform-admin queries). **Dependencies:** the restricted role must be created with `scripts/sql/rls-role.sql`, and `APP_DATABASE_URL` must be set in every environment, or RLS silently doesn't run.

**User and Tenant tables are intentionally NOT under RLS** (v1 scope): login looks up users by email before any tenant context exists, and the storefront resolves a Tenant by slug the same way — still guarded only by application code.

### Key Files

| File | Purpose |
|------|---------|
| `lib/session.ts` | `requireOwner` / `requirePlatformAdmin` — re-checks DB on every render/action to catch password resets + deleted tenants immediately |
| `lib/prisma.ts` | Prisma client setup, `withTenant()` / `withBypass()` transaction wrappers for RLS |
| `lib/data/*.ts` | All queries scoped by `tenantId`; exports wrapped-query variants for use inside `withTenant` |
| `lib/roles.ts` | Role enum, `homeForRole` helper |
| `lib/env.ts` | Environment validation (fails fast at startup if anything's missing/invalid) |
| `app/actions/auth.ts` | Login, logout, password change |
| `proxy.ts` | Custom-domain host routing, path-based → domain redirect, auth role gates |
| `templates/*` | Three templates (Atelier, Minimal, Luxury) + one more; each implements 10 sections per `templates/types.ts` contract |
| `lib/sections.ts` | Canonical content keys for the 10 sections (announcement, navbar, hero, featured categories, new arrivals, best sellers, promo, brand story, reviews, footer) |

### Common Patterns

#### Protecting Server Actions & Pages

```typescript
import { requireOwner, requirePlatformAdmin } from "@/lib/session";

// In a Server Action or Server Component:
const user = await requireOwner();     // throws if not logged in or not a store owner
const admin = await requirePlatformAdmin();
// user.tenantId is always from the session, never from form data
```

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
- Section visibility is on `Tenant.sectionVisibility`; optional sections (announcement, promo, brand story, reviews) can be hidden.
- The 10 sections are in a fixed order (`SECTION_ORDER` in `lib/sections.ts`) — no reordering yet.

#### Variants & Stock

- Every product has at least one variant (a product without variation has one default variant with `attributeKey: null, attributeValue: null`).
- Variants share attribute *names* but differ in *values*; typos in attribute names create new attributes.
- Stock lives on `ProductVariant` — stock deduction is a conditional UPDATE in the order transaction (`UPDATE ... WHERE stock >= qty`), failing cleanly if another buyer took the last unit.
- Variant queries go through products: `where: { id, product: { tenantId } }`.

#### Images & Uploads

- Image uploads go to Cloudflare R2 (production) or `public/uploads/` (dev) via `lib/storage.ts`.
- Remote images are SSRF-guarded (fetch with private-IP block, 3 redirects, 10s, 5MB).
- Only raster images (PNG/JPG/WEBP/GIF) via magic-byte sniff; SVG rejected (XSS risk).
- Uploads served from the platform's origin with a sandbox CSP + `nosniff` header (`next.config.ts`).
- No image deletion (orphaned R2 objects just cost storage); old R2 URLs are never removed from the database.

### Data Model Highlights

- **Tenants** have `sectionVisibility`, `themeOverrides` (CSS vars), `domain` (nullable, unique, verified-and-live), integrations (GA4, Meta, Google Ads IDs), and favicon.
- **Users** have `mustChangePassword` (platform admin can force an owner to change) and `sessionVersion` (bumped when password reset to revoke live sessions).
- **Categories** form a tree (`parentId`); a category page shows its products + everything in subcategories; can't be deleted if it has subcategories or products.
- **Products** have a slug (never changes on rename, keeping old URLs valid), `isBestSeller` flag (manual, not sales-driven), and a `tenantId`.
- **DiscountCampaigns** apply an automatic percentage or fixed per-unit discount to assigned products. Eligible campaigns never stack; the lowest final price wins. Campaign names are admin-only.
- **ProductVariants** live under products (no direct `tenantId`); stock, optional price/image override, free-form attributes. One variant per product minimum.
- **Orders** go Pending → Confirmed → Delivered (or can be Cancelled at any point); cancelling restores stock exactly once. Cancelled and Delivered are final.
- **OrderItems** snapshot the product name, attributes, and price from the moment of purchase — editing a product doesn't affect past orders.

## Storefront & Templates

### How Templates Work

- `templates/render.tsx` decides section visibility and order (so a template can't get it wrong).
- Each template (e.g., `templates/atelier/index.tsx`) implements 10 section components + product page.
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
- Integrations: per-store GA4 ID, Meta Pixel, Google Ads IDs, Google Search Console verification, sitemap/robots.txt.
- `lib/analytics.tsx` mounts tracking tags (only in storefront, never in admin previews).
- Purchase event deduped by `eventID = orderId` and fires once per browser within 30 min of order.

## Authentication & Sessions

- **Login:** rate-limited per IP (8 attempts / 5 min). No CAPTCHA or account lockout yet.
- **Password reset:** platform admin can issue a one-time password from `/platform/stores/[slug]`; owner must change it on next login (` mustChangePassword`). No self-service "forgot password" email flow.
- **Session revocation:** `User.sessionVersion` is stamped into the JWT at login. An admin password reset or the owner changing their own password bumps it. Any token with a stale version is sent to `/force-logout`, which clears the session cookie and redirects to `/login` (not straight to `/login`, because the JWT would just bounce an already-"authenticated" owner back to `/admin`).
- **RLS & delayed logout:** `requireOwner` and `requirePlatformAdmin` re-check the user in the DB on every render/action (deduped per request with React's `cache()`), so a deleted tenant or a password reset takes effect on the very next request, not just the next login.

## Performance & Scaling Notes

- **Connection pool:** `max: 30` (up from node-postgres default of 10). Load-tested:
  - 30 concurrent users: p50 550ms, 0 failures.
  - 100 concurrent: p50 1.4s, 0 failures.
  - 150 concurrent: p95 ~2.9s, 0 failures.
  - 300 concurrent: 10% fail with 500 (Prisma's `maxWait` timeout).
  - *Always test against `next build && next start`, not `next dev`.*
- **Before multi-instance:** rate limiters and domain-resolution cache are in-memory (per-instance). Use a shared store (Redis) or adjust cache TTLs.
- **Storefront data:** `loadStorefrontData` runs 5 reads inside one `withTenant` transaction (was 5 separate ones, costing 5 pooled connections per page load).

## Important Gotchas

- **Restart `pnpm dev` after DB migrations.** A running dev server caches the old Prisma client and throws "Cannot read properties of undefined" until restarted.
- **Prisma client generation needs `DATABASE_URL` at install time.** Copy `.env.example` → `.env` before `pnpm install`.
- **`next dev` modifies AGENTS.md and CLAUDE.md.** These files are generated by `next dev` at startup (see `scripts/generate-agent-files.js`). Commit them or ignore the changes.
- **Self-hosting requires `AUTH_TRUST_HOST=true`.** Auth.js rejects every sign-in under `next start` without it.
- **Stale PENDING orders auto-cancel.** Run lazily when an owner opens `/admin/orders` — anything PENDING older than 24 hours is cancelled. No scheduler runs it independently.
- **Custom domains need `SERVER_PUBLIC_IP` and DNS validation.** Tenant.domain is "verified-and-live" — the platform admin must confirm the domain's DNS resolves to the server IP before saving.

## Testing & Verification

No automated test suite yet. Four manual verification scripts + browser E2E tests:

- `pnpm verify:isolation`: app-level tenant isolation (DB access attempts must fail).
- `pnpm verify:commerce`: category trees, variant rules, stock deduction (concurrent), order snapshots, cancellation.
- `pnpm verify:templates`: all 3+ templates × 10 sections, switches, live preview in admin/platform.
- `pnpm verify:permissions`: role-based access via real login sessions + static check that every server action verifies role.
- `pnpm e2e:*`: Chrome automation (categories, variants, shop/category/search/content pages, checkout flow).

## Development Tips

1. **When adding a new field to a table:** run `pnpm db:migrate` (creates a migration in `prisma/migrations`), commit it with your code changes.
2. **Tenants are always scoped by the session:** never pass `tenantId` from URL params, form data, or cookies. Always from the JWT (via `requireOwner` / `requirePlatformAdmin`).
3. **Content keys are plain strings** (typos compile). Use `pnpm verify:templates` to catch non-canonical keys statically.
4. **Optional sections need content to appear.** If a section is switched on but has no text, it renders nothing (no warning yet).
5. **Page editors show home and product pages only** — not shop, category, cart, checkout, or content pages.
6. **Custom domains:** verify with `lib/domain-check.ts` (Node-only, use only in Server Actions). Keep it separate from `lib/domain-format.ts` (pure, dependency-free, usable in client components).

## Known Gaps

See [KNOWN_GAPS.md](KNOWN_GAPS.md) for:
- Intentional MVP limitations (e.g., no caching, cart is in-memory only, no pagination on admin products).
- Production readiness TODOs (e.g., no automated scheduler, rate limiters are in-memory, etc.).
- Rough edges flagged for future work (e.g., `ContentKey` is untyped, content editor doesn't warn about missing-content optional sections).

---

**New to the project?** Start with SETUP.md, then browse the app at `/store/demo-boutique` (storefront), `/admin` (owner panel), and `/platform` (admin console) after running `pnpm demo:seed`.
