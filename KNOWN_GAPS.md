# Known gaps

Things we knowingly left out or that are rough edges. Come back to these.
Newest sections at the bottom; delete an item when it's fixed.

## Tenant isolation (Row-Level Security)

- **Database-level isolation is now enforced** (see `prisma/migrations/*_row_level_security`).
  The Next.js runtime connects as a restricted, non-superuser role (`APP_DATABASE_URL`); every
  tenant-scoped query runs through `withTenant()` in `lib/prisma.ts`, which sets `app.tenant_id`
  per transaction, and RLS policies on the 7 tenant-owned tables (Category, Product,
  ProductVariant, ProductImage, TenantContent, Order, OrderItem) filter on it. The platform
  admin's cross-tenant reads use `withBypass()`. This is defence-in-depth *under* the existing
  app-level `tenantId` WHERE clauses, not a replacement for them.
- **Depends on `APP_DATABASE_URL` being set.** If the runtime falls back to `DATABASE_URL`
  (the owner/superuser), RLS is silently NOT enforced. Create the role with
  `scripts/sql/rls-role.sql` and point `APP_DATABASE_URL` at it in every environment.
- **User and Tenant tables are intentionally NOT under RLS (v1 scope).** Login looks up users
  by email before any tenant context exists, and the storefront resolves a Tenant by slug the
  same way; both are still guarded only by application code. Owner email + store metadata could
  leak if one of those queries ever dropped its filter. Consider RLS (or a `nolint` review) for
  them in a later pass.
- **Dev/CI scripts run as the owner** (`scripts/_owner.ts` points `APP_DATABASE_URL` at
  `DATABASE_URL`), so they bypass RLS to manage fixtures. `verify:isolation` therefore proves the
  app-level isolation, not the database policies; the RLS policies are covered by the SQL-level
  checks run at migration time.

## Auth and accounts

- **Login is rate-limited** (per IP, `lib/rate-limit.ts`): 8 attempts / 5 min, then a "try
  again in N minutes" message. The limiter is in-memory, so it protects a single app instance
  only — back it with a shared store (Redis) before running multiple instances. There is still
  no account lockout or CAPTCHA.
- **No password reset.** A store owner who forgets their password has no
  recovery path, and the platform admin has no "reset owner password" action
  (it would generate a new one-time password, same as store creation).
- **Platform admin can't edit or delete stores or owners.** Only create + list, plus the
  per-store template/theme page. They also can't edit a store's content or products on the
  owner's behalf (only the owner can), which will matter for support.
- **Stale sessions.** Role, tenantId and `mustChangePassword` live in the JWT and
  are not re-checked per request. If a Tenant/User is deleted while its owner
  has a live session, `/admin` returns 404 until they log out. Nothing in the UI
  deletes tenants yet, so this is unreachable today; handle it when store
  deletion lands (for example re-validate the user in `requireOwner`).
- **Re-running `pnpm db:seed` resets the platform admin password** to the value in
  `.env` (intentional, but easy to forget).
- **`postinstall` runs `prisma generate`, which needs `DATABASE_URL`.** Copy
  `.env.example` to `.env` before `pnpm install` on a fresh clone.

## Products and content

- **`imageUrl` is a plain text field.** No upload, no validation that the URL
  is actually an image, no `next/image` optimization (templates use `<img>`).
- **Currency is hardcoded to USD** (`lib/format.ts`).
- **Product slugs never change after creation** (renaming keeps the old URL).
- **No pagination** on the admin product table or the storefront grid.
- **Delete uses `window.confirm`**, not a proper dialog.
- **Content fields can't be intentionally blanked** when they have a non-empty
  default (headline, footer text, headings...): an empty value deletes the row and the
  default is shown again. Fields with an empty default (announcement, promo, story,
  reviews, images) can be blanked.
- **Renaming a content key orphans old rows.** Stores keep rows for keys no template reads
  any more (the demo seed cleans its own). A real key rename needs a data migration.
- **`ContentKey` is typed as plain `string`** because some keys are generated
  (`reviews.item1.quote`...), so a typo in `content["..."]` compiles. `pnpm verify:templates`
  catches non-canonical keys statically; tightening the types would be better.

## Testing and ops

- **No automated test suite or CI.** Verification is three manual scripts
  (`pnpm verify:isolation`, `verify:templates`, `verify:permissions`) plus browser runs. The
  admin editors (content, products, theme) have no automated UI tests; real form bugs
  (switches inside a `<form>`, saved values reverting on screen) were only found by hand.
- **No caching** on storefront pages (plain SSR by design for the MVP).
- **DB connection pool is unconfigured** (`lib/prisma.ts` passes no `max` to `PrismaPg`, so
  it inherits node-postgres's default of 10 connections, shared by the whole process via the
  `globalThis` singleton). Fine at low traffic — stock deduction itself is safe under
  concurrency (`placeOrder` uses a conditional `updateMany` inside a transaction, with variant
  ids sorted first to avoid deadlocks) — but a burst of concurrent checkouts across many stores
  will queue behind those 10 connections and can hit Prisma's interactive-transaction timeout,
  surfacing as "Something went wrong placing your order" instead of a real crash. Fix in two
  stages: (1) single instance — set `max` on `PrismaPg` (e.g. 30-50) and confirm Postgres's
  `max_connections` covers it; (2) once running more than one app instance (replicas/containers),
  stop raising `max_connections` and put a connection pooler in front of Postgres instead
  (PgBouncer, or the host's built-in one on Neon/Supabase/RDS Proxy) — connections multiply
  per instance, and raw Postgres connections are too heavyweight to just keep scaling up.

## Storefront sections and templates

- **Storefront filtering:** the shop page has no price/in-stock filters or sorting (Classic's
  old sidebar filters were dropped in the 11-section rework).
- **Best sellers are a manual flag** (`Product.isBestSeller`), not sales data, and both
  New arrivals and Best sellers are capped at 8 products.
- **Instagram is a static strip**, not a live feed: up to 4 photo URLs from content, topped
  up with product photos, plus a link to the handle. It does not fetch anything from Instagram.
- **Reviews are typed in by hand** (max 3 quotes), not a review system. The demo store's
  reviews are made-up sample text.
- **Fixed section order** (by design for now): no reordering, and only the four optional
  sections can be hidden. `pnpm verify:templates` assumes it.
- **Colors only**: no font choice, no per-template layout options.
- **The owner's section switches save immediately** with no undo or confirmation.
- **Optional sections need content to appear.** A section that is switched on but has no
  text (for example Reviews with no quotes) renders nothing. The admin doesn't warn about
  this yet.
- **`verify:templates` and `verify:permissions` need the server running** and briefly change
  the demo store (restored afterwards). They are manual scripts, not CI tests.
- **Theme editor:** the preview shows the store's newest product on the "Product page" view
  and has links disabled. The editor doesn't warn about unsaved changes when you navigate
  away, and it has no undo beyond "Reset to defaults".
- **Content editor:** the preview shows the store's newest product on the "Product page"
  view, and its links are disabled. It warns (browser prompt) if you close the tab with
  unsaved edits, but not on in-app navigation. Section switches save immediately while text
  needs Save, which is a slightly inconsistent model. The preview is rendered client-side
  from the same template code, so a template that used server-only APIs would break it.

## Catalog, checkout and orders

- **Checkout is rate-limited** (per IP + store, `lib/rate-limit.ts`): 10 orders / 10 min, to blunt
  order-flooding. No CAPTCHA/verification. The limiter is in-memory (single instance).
- **Stale PENDING orders are auto-cancelled** (stock restored) by `expireStalePendingOrders`,
  run lazily when the owner opens `/admin/orders` — anything PENDING older than
  `ORDER_PENDING_TTL_HOURS` (default 24) is cancelled through the normal guarded path. This is a
  deliberate no-scheduler design: if the owner never opens their orders they aren't selling, so
  held stock doesn't matter. If you later want expiry independent of admin activity (e.g. a busy
  store), move the same call behind a cron-triggered endpoint or a checkout-time sweep.
- The public search endpoint (`/api/store/[slug]/search`) is likewise rate-limited (30 / min per
  IP, returns 429 with `Retry-After`); the live-search box degrades silently when throttled.
- **No notifications.** Owners are not emailed or texted about new orders; they must check
  `/admin/orders` (the dashboard shows a pending count). Customers get no confirmation email.
- **Orders admin is basic:** no search, filter or pagination, no editing of items or customer
  details, no partial cancellation, returns or refunds, and Cancelled is final (no un-cancel).
  Status can only move forward (or to Cancelled).
- **The confirmation page is a bearer link.** Anyone with the long random order URL sees the
  customer's name, phone and address; there are no customer accounts or order lookup.
- **TODO (returning customers): remember delivery details so they aren't re-typed.** A returning
  shopper re-enters name/phone/address/location on every order. Save these and prefill next time,
  showing "Are you still at <address>?" so they confirm or edit rather than retype.
  - **Prefer a table over localStorage.** localStorage is per-device and lost on a new
    browser/phone; a table works everywhere and is per store. Likely shape: a `Customer` row
    keyed by `(tenantId, phone)` — phone is the natural identity for guest checkout (no accounts,
    see above) — storing last name/address/deliveryLocation and updatedAt. On checkout, if the
    entered phone matches, prefill and ask to confirm; otherwise create/update the row.
  - **Consent:** low-stakes (it's their own delivery info for reorders), so saving without an
    explicit opt-in is probably fine, but revisit against local privacy rules before launch; at
    minimum note it in the store's terms. localStorage prefill needs no consent.
  - Interacts with the bearer-link/privacy point above and with any future customer-accounts work.
- **Money is simple:** USD only, no shipping fees, tax, discounts or coupons. The cart doesn't
  warn if a price changed; the order is priced when placed and the summary shows current prices.
- **Cart is per browser tab and lost on a full reload** (by requirement). A shopper who reloads
  the checkout page, or opens it directly, sees an empty cart.
- **Categories:** no images, descriptions or manual ordering (siblings sort by name), slugs don't
  change on rename, the navbar lists top-level categories only (no dropdown for children), and
  the home tiles show up to 6 top-level categories chosen alphabetically (with a product photo).
- **Variants:** attribute names are free text (a typo creates a different attribute, which the
  same-names rule then catches on save). There is no variant generator (size x color matrix), SKU,
  barcode or weight, and one image per variant. Deleting a variant that has orders keeps the order
  history (snapshots) but unlinks it, so cancelling such an order can't restore that stock.
- **Search** is a plain case-insensitive "contains" on name and description: no ranking, typo
  tolerance or filtering by category. Content pages (About, Contact, FAQ, Shipping) are plain text.
- **The editor previews** (content and theme) show the home and product pages only, not the
  shop, category, cart, checkout or content pages.
- **The old `featuredCategories.item*` content rows** were replaced by real category tiles; stores
  that had filled them in keep those rows orphaned in the database (harmless).
- **Migrations:** the `variants` migration is hand-written SQL (it backfills one default variant
  per existing product); it lives in `prisma/migrations` and applies normally to a fresh database.
- **The browser (`e2e:*`) scripts** need Chrome installed and a running server, and take a
  minute or two. They are manual, not CI.
