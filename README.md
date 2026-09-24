# Multi-Tenant Stores (MVP)

Next.js (App Router) + PostgreSQL/Prisma 7 + Auth.js v5 + Tailwind + shadcn/ui + Zod.

The platform owner creates every store and owner account (no public signup).
Store owners log in at `/login` and manage only their own store at `/admin`.
Storefronts are public at `/store/<slug>`.

## Setup

**New to the project? Follow [SETUP.md](SETUP.md)** for step-by-step instructions (prerequisites, database, `.env`, troubleshooting). The short version:

```bash
cp .env.example .env        # fill in DATABASE_URL, AUTH_SECRET, PLATFORM_ADMIN_* FIRST:
pnpm install                # postinstall runs `prisma generate`, which needs DATABASE_URL
pnpm db:migrate             # applies migrations (prisma migrate dev)
pnpm db:seed                # creates the PLATFORM_ADMIN from env vars
pnpm dev                    # http://localhost:3000
```

`AUTH_SECRET`: generate with `openssl rand -base64 32`.
Production: `pnpm db:deploy && pnpm build && pnpm start`.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:deploy` | `prisma migrate deploy` (CI/production) |
| `pnpm db:seed` | upserts the platform admin from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` |
| `pnpm demo:seed` | creates/refreshes a "Demo Boutique" store: content for every key, a nested category tree, 6 products with variants, 2 sample orders, all optional sections on |
| `pnpm verify:isolation` | runs cross-tenant access attempts against the DB and checks they fail |
| `pnpm verify:templates` | (server running) all 3 templates x 11 sections, section toggles, template switching keeps all data |
| `pnpm verify:commerce` | data-layer checks: category tree and cycles, variants and their rules, stock deduction (incl. a concurrent race for the last unit), cancel-restores-stock, order snapshots, cross-store attacks |
| `pnpm e2e:categories` `e2e:variants` `e2e:pages` `e2e:checkout` | real-Chrome runs (server running, Chrome installed; each creates and removes throwaway stores): admin categories, variant editor + storefront picker, shop/category/search/content pages, and the full browse-to-order flow |
| `pnpm verify:permissions` | (server running) who can reach what, over real login sessions, plus a static check that every server action verifies a role |
| `pnpm typecheck` | `tsc --noEmit` |

## How tenant isolation works

- `proxy.ts` (Next 16's replacement for middleware) gates `/platform/*` and
  `/admin/*` by role and forces `/admin/change-password` while
  `mustChangePassword` is set. It only reads the JWT, so it is an optimistic check.
- Pages and server actions repeat the checks via `lib/session.ts`
  (`requireOwner` / `requirePlatformAdmin`). `tenantId` always comes from the
  session, never from form data or URLs.
- Every function in `lib/data/*.ts` takes a `tenantId` and puts it in the `WHERE` clause
  (`updateMany`/`deleteMany` with `{ id, tenantId }`), so another tenant's record id matches
  nothing. `ProductVariant` has no `tenantId` of its own, so variant queries always go through
  the product: `where: { id, product: { tenantId } }`.
- The public storefront actions (cart lookup, checkout) take no login. They resolve the store
  from the URL slug, and the variant ids a cart carries are only ever resolved through products
  of that store, so another store's ids come back "unavailable". Prices always come from the
  database; stock is deducted with a conditional `UPDATE ... WHERE stock >= qty` inside the order
  transaction.

## Who controls what

| | Platform admin | Store owner |
| --- | --- | --- |
| Create stores and owner accounts | yes | no |
| Template, theme colors and live preview (`/platform/stores/[slug]/theme`) | yes | no |
| Content text, per section, with live preview (`/admin/content`) | no | yes |
| Show/hide the 4 optional sections (`/admin/content`) | no | yes |
| Products with variants, categories and the Best seller flag (`/admin/products`, `/admin/categories`) | no | yes |
| Orders: view, confirm, deliver, cancel (`/admin/orders`) | no | yes |

## Storefront

Every template renders the same 10 sections in the same fixed order (`SECTION_ORDER` in
`lib/sections.ts`): announcement bar, navbar, hero, featured categories, new arrivals,
best sellers, promo banner, brand story, reviews, footer. Announcement bar, promo
banner, brand story and reviews are optional: the owner can switch them off, and they also
need content to appear. Templates differ only in visual treatment.

- `templates/render.tsx` decides which sections show and in what order (so a template
  can't get it wrong); `templates/<id>/index.tsx` implements the 11 section components and
  the product page; `templates/types.ts` is the contract.
- All copy comes from `TenantContent` by canonical key (`lib/content.ts`, grouped by
  section). Templates never use their own keys or hardcode text or colors.
- Colors (`Tenant.themeOverrides`) are injected as CSS variables at the storefront root by
  `components/theme-scope.tsx`; `Tenant.sectionVisibility` holds the owner's switches.
- `/admin/content` is the store owner's editor: every field grouped by section in a left
  sidebar, a live preview of their storefront on the right (typing, section switches and the
  page/device toggles show up instantly; focusing a section scrolls the preview to it), and
  one Save. The preview (`/admin/preview`) renders the real template client-side with the
  owner's saved theme and products, so unsaved text never reaches the public site.
- `/platform/stores/[slug]/theme` is the platform admin's editor: options on the left
  (template, colors, color schemes, page and device), a live preview of the whole storefront
  on the right, and one Save. The preview is an iframe of `/platform/preview/[slug]`, which
  renders the real storefront; color changes reach it instantly through `postMessage`.

## Catalog, cart and orders

- **Categories** form a tree of any depth (`Category.parentId`). A category page shows its own
  products *and* everything in its subcategories; chips let shoppers narrow down. A category with
  subcategories or products can't be deleted (clear message), and a category can't be moved
  inside itself.
- **Variants:** stock, and optionally price and image, live on `ProductVariant`; a product always
  has at least one (a product without variation has one default variant). Attributes are free-form
  key/values. Rules: with several variants they share the same attribute names and are all
  different. The storefront picker is built from the union of attribute values, and "out of stock"
  is per variant.
- **Storefront pages:** `/store/<slug>/shop`, `/category/<slug>`, `/search?q=`, `/cart`,
  `/checkout`, `/order-confirmation/<id>`, and `/about`, `/contact`, `/faq`, `/shipping` (a content
  page exists, and is linked, only once its text is filled in under Content > Pages).
- **Cart** is React state only (no localStorage, no database): it survives moving between pages
  but not a full reload. **Checkout** is guest cash-on-delivery: the order and its items are
  created in one transaction that also deducts stock, and it fails cleanly ("just sold out") if
  someone else took the last unit. Order items snapshot name, attributes and price.
- **Orders** (`/admin/orders`) go Pending, Confirmed, Delivered, and can be Cancelled at any point;
  cancelling puts the stock back exactly once.

After a Prisma migration, **restart `pnpm dev`**: a running dev server keeps the old generated
client and fails with errors like "Cannot read properties of undefined (reading 'create')".

See `KNOWN_GAPS.md` for what is intentionally not built yet.
