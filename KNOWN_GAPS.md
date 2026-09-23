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
  again in N minutes" message. The client IP is read `TRUSTED_PROXY_COUNT` entries from the
  right of `X-Forwarded-For` (never the client-controlled first entry), so this is only
  spoof-proof when Next sits behind a reverse proxy you control. The limiter is in-memory, so it protects a single app instance
  only — back it with a shared store (Redis) before running multiple instances. There is still
  no account lockout or CAPTCHA.
- **No self-service password reset.** An owner who forgets their password has to ask the
  platform admin, who can issue a one-time password from `/platform/stores/[slug]` (see below).
  There is no "forgot password" email flow.
- **Platform admin can rename or delete a store, and reset the owner's password**
  (`/platform/stores/[slug]`). Delete removes the Tenant (cascading to every tenant-owned
  table) and the owner User together, and is `window.confirm`-gated like other destructive
  actions in the app. They still can't edit a store's content or products on the owner's
  behalf (only the owner can), and there's no way to change an owner's *email* or transfer
  ownership to a different account.
- **`requireOwner` now re-reads the user from the DB on every render/action** (deduped per
  request with React's `cache()`) instead of trusting the JWT, so an admin-issued password
  reset (`mustChangePassword`) and a deleted tenant both take effect on the owner's very next
  request, not just their next login. This was the fix the old "stale sessions" gap asked for.
  `requirePlatformAdmin` now does the same DB re-check.
- **Admin password resets revoke live sessions.** `User.sessionVersion` is stamped into the JWT at
  login; `resetOwnerPassword` bumps it and `requireOwner`/`requirePlatformAdmin` send any token
  with a stale version through `/force-logout`. Before this, a stolen session survived a reset and
  was redirected to `/admin/change-password`, where it could set a password of its own. An owner
  changing their own password bumps it too (signing everywhere else out); the change-password
  action then signs the current browser back in with the new password to get a fresh token. The
  client-triggerable session `update` deliberately never refreshes the version.
- **Self-hosting needs `AUTH_TRUST_HOST=true`** (see `.env.example`); without it Auth.js rejects
  every sign-in under `next start` with `UntrustedHost`.
- **Deleting a tenant whose owner has a live session redirects through `/force-logout`**
  (`app/force-logout/route.ts`), not straight to `/login`. `proxy.ts` only reads the JWT, so a
  plain `redirect("/login")` from `requireOwner` would bounce an already-"authenticated" owner
  straight back to `/admin` — an infinite loop, since the JWT never re-validates the DB row
  itself. The route handler clears the session cookie (`signOut`) before sending them to
  `/login`, which a Server Component render can't do directly.
- **Re-running `pnpm db:seed` resets the platform admin password** to the value in
  `.env` (intentional, but easy to forget).
- **`postinstall` runs `prisma generate`, which needs `DATABASE_URL`.** Copy
  `.env.example` to `.env` before `pnpm install` on a fresh clone.
- **Schema changes in dev no longer need a server restart.** `lib/prisma.ts` caches the client on
  `globalThis` in development (so hot reloads don't each open a pool); it now rebuilds that client
  when `prisma generate` produces a new `PrismaClient` class. Before, a stale cached client kept
  rejecting new columns ("Unknown field ... for select statement") until `next dev` was restarted.
- **Deploy order:** run `pnpm db:deploy` before starting new code that reads a new column, or
  every request touching it 500s until the migration lands.

## Products and content

- **Image uploads go to Cloudflare R2** (`lib/storage.ts`) for content, product, gallery, variant
  and category image fields (`components/image-field.tsx`). A pasted link is copied into R2 on
  paste/blur (`lib/remote-image.ts`: SSRF-guarded fetch, private IPs blocked at connect time, 3
  redirects, 10s, 5MB; rate-limited per tenant). If that copy fails, or the owner saves before it
  finishes, the external link is stored as-is and the storefront hotlinks it. Links saved before
  this existed are only copied when an owner focuses and leaves that field. No `next/image`
  optimization (templates use `<img>`). Only
  PNG/JPG/WEBP/GIF are accepted, identified by their leading bytes rather than the browser-supplied
  type; SVG is refused (it can carry script). Without R2 configured (development only) uploads fall
  back to `public/uploads/<tenantId>/`, which `next.config.ts` serves with a sandbox CSP + `nosniff`.
- **Uploads are served from the rate-limited `r2.dev` URL** for now. Before real traffic, connect a
  custom domain to the bucket, change `R2_PUBLIC_URL`, and run
  `pnpm uploads:migrate --rewrite-from=<old r2.dev URL>` (stored URLs are absolute).
- **Replaced or deleted images are never removed from the bucket** (orphaned objects just cost
  storage), and there's no per-tenant storage quota.
- **Currency is hardcoded to USD** (`lib/format.ts`).
- **Product slugs never change after creation** (renaming keeps the old URL).
- **No pagination on the admin product table.** (The storefront shop, category and search pages
  are paginated, 12 per page — `CATALOG_PAGE_SIZE` in `lib/data/products.ts`.)
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

- **No automated test suite or CI.** Verification is four manual scripts
  (`pnpm verify:isolation`, `verify:commerce`, `verify:templates`, `verify:permissions`) plus
  browser runs (`e2e:*`). The
  admin editors (content, products, theme) have no automated UI tests; real form bugs
  (switches inside a `<form>`, saved values reverting on screen) were only found by hand.
- **No caching** on storefront pages (plain SSR by design for the MVP).
- **DB connection pool: `max: 30`** is now set on `PrismaPg` (`lib/prisma.ts`), up from
  node-postgres's default of 10 — confirmed against this DB's `max_connections` (100). Single
  instance only; once running more than one app instance (replicas/containers), stop raising
  this and put a connection pooler in front of Postgres instead (PgBouncer, or the host's
  built-in one on Neon/Supabase/RDS Proxy) — connections multiply per instance, and raw
  Postgres connections are too heavyweight to just keep scaling up.
  **Load-tested against a real `next start` production build** (3 throwaway stores seeded with
  products, N concurrent simulated shoppers each hitting home -> shop -> a product page):
  30 concurrent users, 0 failures, p50 550ms; 100 concurrent, 0 failures, p50 1.4s; 150
  concurrent, 0 failures but p95 climbing to ~2.9s; **300 concurrent, 10% of requests fail with
  a 500** (`PrismaClientKnownRequestError P2028: "Unable to start a transaction in the given
  time"` — Prisma's default 2s `maxWait` for acquiring a pooled connection, not the 5s query
  timeout). That's ~300 *simultaneous* fresh page loads in the same instant, a much more
  aggressive spike than organic traffic ever produces pre-launch, but it's the real, measured
  ceiling of `max: 30` today. Cheapest next lever if this becomes real: raise `max` further
  (Postgres here allows up to 100 `max_connections`, plenty of headroom above 30); the durable
  fix at real scale is still the pooler mentioned above. (Note: dev mode, i.e. `next dev`, is
  not representative for this kind of test at all — the same simulation against the dev server
  produced multi-second latency and even a transaction-timeout 500 at just 30 concurrent users,
  purely from Turbopack/HMR overhead. Always load-test against `next build && next start`.)
- **`loadStorefrontData` (`lib/data/storefront.ts`) now runs its 5 reads (content, new
  arrivals, best sellers, categories, category images) inside one shared `withTenant`
  transaction** instead of 5 independent ones. Every `withTenant`/`withBypass` call is an
  interactive transaction that holds a pooled connection for its duration (needed to
  `set_config('app.tenant_id', …)` before the RLS-guarded query), so 5 of them firing
  concurrently via `Promise.all` — which almost every storefront route hit, since they all go
  through this function — cost 5 connections per page load. The data-layer functions this
  reuses (`contentRowsQuery`, `newArrivalsQuery`, `bestSellersQuery`, `categoriesQuery`) now
  export a raw-query variant taking an already-open transaction client alongside the original
  `withTenant`-wrapped export, so other callers are unaffected.
  **`app/admin/preview/page.tsx` and `app/platform/preview/[slug]/page.tsx` still do the same
  5-way fan-out inline** (not through `loadStorefrontData`, since the owner-preview one needs
  raw content rows, not the resolved map) — left as-is since they're single-admin, low-
  concurrency pages, not the customer-facing path. Worth consolidating the same way if they
  ever see real concurrent load.

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
  details, no partial cancellation, returns or refunds. Status only moves forward
  (Pending -> Confirmed -> Delivered), and only Pending/Confirmed orders can be Cancelled.
  Delivered and Cancelled are both final: cancelling restores stock, which would be wrong once
  the goods are gone. A real returns flow (restock on return) doesn't exist yet.
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
- **Categories:** an optional cover image, but no descriptions or manual ordering (siblings sort by name), slugs don't
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

## Custom domains

- **Routing, SEO and admin-side domain connection are all built; TLS provisioning (Caddy) is not.**
  `Tenant.domain` (nullable, unique) exists, every URL-emitting surface (sitemap, robots.txt,
  canonical tags, `lib/store-url.ts`'s `getStoreUrl`/`getStoreBasePath`, every storefront-internal
  link) resolves through it, and `proxy.ts` rewrites `{domain}/*` to `/store/{slug}/*` and 307s
  the old path-based URL (query string included) to the domain once one is set — 307, not 308,
  because browsers cache a 308 indefinitely and a disconnected/changed domain could then never
  be taken back. The www/apex twin of a connected domain 307s to it too, and incoming Host
  headers are normalized (lowercase, no port, no trailing dot) before lookup. The platform admin can now connect/
  disconnect a domain from `/platform/stores/[slug]` (`domain-form.tsx` -> `updateStoreDomainAction`
  in `actions.ts`): it validates the format, rejects the platform's own hostname and domains
  already connected to another store, and — this is what keeps `domain` invariantly "verified and
  live" (see the schema comment) — refuses to save until `lib/domain-check.ts`'s
  `checkDomainResolves` confirms the domain's DNS actually resolves and resolves to exactly this server
  (`SERVER_PUBLIC_IP`, required in production; IP-literal "domains" are rejected outright). Hosting decision landed on a VPS (Caddy for
  reverse proxy + on-demand TLS, since Postgres needed to be self-hosted there anyway, and the
  admin sets DNS directly — no client-facing ownership-verification flow was needed). **What's
  still missing**: Caddy itself isn't set up on any server yet (this repo has no infra config for
  it). The app side is ready: point Caddy's `on_demand_tls { ask http://127.0.0.1:3000/api/tls-check }`
  at `app/api/tls-check/route.ts`, which answers 200 only for connected domains and their www/apex
  twins, so strangers can't make the server request certificates for arbitrary hostnames.
- **`lib/domain-check.ts` vs `lib/domain-format.ts`: keep the split.** `domain-check.ts` reads
  `env.ts` (secrets) and `node:dns/promises` (a Node built-in Turbopack can't bundle for the
  browser) — importing it from anywhere reachable by a client component breaks the build (hit
  this once: `lib/validation.ts` is imported by `app/admin/preview/live-preview.tsx` for
  `isImageUrl`/`isInstagramHandle`, so it can only ever import the pure, dependency-free
  `domain-format.ts`, never `domain-check.ts`). Only `actions.ts` (a `"use server"` file) should
  import `domain-check.ts`.
- **Production env checklist:** `PLATFORM_BASE_URL`, `SERVER_PUBLIC_IP` (both required — startup
  fails without them), `AUTH_TRUST_HOST=true` (or every sign-in fails), `APP_DATABASE_URL` (or RLS
  is off), and `TRUSTED_PROXY_COUNT` (2 if Cloudflare's proxy sits in front of nginx/Caddy). A
  domain behind Cloudflare's orange-cloud proxy resolves to Cloudflare's IPs and fails the DNS
  check — use DNS-only (grey cloud) for its A record.
- **`proxy.ts`'s host cache (`hostHits`/`hostMisses`/`domainBySlug`, 30s TTL, in-memory,
  oldest-first eviction; misses capped separately so junk Host headers can't flush real stores)** is per-instance,
  like the rate limiters — fine for one instance, needs a shared store (or just a shorter TTL)
  once there's more than one. A newly-connected domain can take up to 30s to start resolving.
- **Local testing:** Chrome resolves `*.localhost` to 127.0.0.1 without any hosts-file edit, and
  Next's dev server already allows `*.localhost` origins by default (`allowedDevOrigins`), so
  `http://any-name.localhost:3000` works for manual testing once a tenant's `domain` is set to
  `any-name.localhost` directly in the DB. For scripted checks, `curl -H "Host: ..."` works too
  (verified against `pg_stat_activity` that `proxy.ts` importing `prisma`/`env` directly does not
  open a second connection pool — Next 16 runs Proxy on the Node.js runtime by default, not Edge,
  which is what makes the direct import safe here at all).
- **Storefront-internal navigation is domain-aware** (`StoreInfo.basePath` — see
  `templates/types.ts` and `lib/store-url.ts`'s `getStoreBasePath`), threaded through every
  template, the nav/cart/checkout client components, and the pagination/breadcrumb builders. The
  platform admin's own preview iframes (`app/admin/preview`, `app/platform/preview/[slug]`)
  deliberately always use the path-based `basePath` regardless of `tenant.domain`, since those
  iframes only ever render on the platform's own host.

## Fixed in the 2026-09-23 backend review

Kept here briefly so the reasoning isn't lost; details live in the sections above and in the code
comments. Delete this section once it's no longer useful.

- **Stored XSS via SVG upload** — raster-only uploads checked by magic bytes, plus a sandbox CSP
  on `/uploads/*` (see "Products and content").
- **Stolen sessions survived a password reset** — `User.sessionVersion` revokes every older token
  on an admin reset or an owner's own password change (see "Auth and accounts").
- **Rate limits were bypassable by spoofing `X-Forwarded-For`** — `TRUSTED_PROXY_COUNT`.
- **`/store/[slug]` -> domain redirect** dropped the query string and was a browser-cached 308;
  now a 307 that keeps `?q=`/`?page=`.
- **Domain input/routing:** IP literals rejected, hosts normalized, www/apex twin redirects, junk
  Host headers can't flush the host cache, `/api/tls-check` for Caddy on-demand TLS.
- **`SERVER_PUBLIC_IP` is required in production**, so a typo'd domain resolving to someone else's
  server can't be accepted as "verified".
- **Slug retry loops for products/categories** ran inside one transaction, where Postgres rejects
  every statement after the first unique violation; they now retry with a fresh transaction.
- **Cancelling a Delivered order restored stock** — Delivered is now final.
- **`requirePlatformAdmin` trusted the JWT alone** — it now re-checks the DB like `requireOwner`.

## Store management: domain, Google Search, analytics & ads

- **"Manage store" is a sidebar layout** (`app/platform/(admin)/stores/[slug]/layout.tsx`):
  Overview (name, setup checklist, owner reset), Domain (connect form, DNS records to create with
  `SERVER_PUBLIC_IP` filled in, live **Check DNS** for A/AAAA/CNAME/CAA on the domain and its
  www twin), Google Search (exact sitemap to submit + Search Console steps, HTML-tag verification
  field), Analytics & ads (IDs + setup guides), Theme (the existing full-screen editor), Danger
  zone. Platform admin only — owners see none of it.
- **Per-store integrations** live on `Tenant` (`gaMeasurementId`, `googleAdsId`,
  `googleAdsPurchaseLabel`, `metaPixelId`, `googleSiteVerification`, `metaDomainVerification`),
  validated on save and again before rendering (`lib/integrations.ts`) since they end up in
  script/meta tags. The storefront layout mounts `lib/analytics.tsx` only when one is set, and
  never in the admin previews. Events: page views, `view_item`/ViewContent,
  `add_to_cart`/AddToCart, `begin_checkout`/InitiateCheckout, `purchase`/Purchase + the Google
  Ads conversion. Purchase fires once: only within 30 min of the order
  (`isFreshOrder`), once per browser (localStorage flag), with the order id as
  `transaction_id`/`eventID` for platform-side dedupe.
- **No cookie-consent banner.** The tags set tracking cookies immediately. Stores selling to the
  EU/EEA/UK need consent first (and Google Consent Mode v2 for ad personalisation) — the
  Analytics page warns about this. Building a banner + Consent Mode defaults is the next step if
  any store targets those regions.
- **Browser-only tracking.** No Meta Conversions API or Google Ads enhanced conversions
  (server-side), so ad blockers / iOS privacy lose some events and ad platforms under-report
  sales versus the Orders page. `eventID = orderId` is already sent so a future server-side
  event would dedupe against the browser one.
- **GA4 page views after the first rely on GA4's enhanced measurement** ("page changes based on
  browser history events", on by default). If someone turns it off, only landing pages count.
- **Store owners can't edit their own tracking IDs** — deliberate (platform admin manages
  marketing setup); revisit if owners should self-serve.
- **The Search Console "done" check can't see DNS-TXT verification** (nothing is stored for it),
  so the overview checklist can only say the HTML-tag token is saved, and words it accordingly.

## Storefront SEO

- **Every storefront page now has:** a title with the store name (`%s | Store` template in
  `app/store/[slug]/layout.tsx`), its own meta description (hero subtext / product description /
  page text — no longer the platform's root-layout "Multi-tenant storefront platform"), a
  canonical URL, and Open Graph + Twitter tags with an absolute image. Helpers in `lib/seo.ts`.
  Paginated shop/category pages add "– Page N" to the title.
- **Structured data (JSON-LD):** `WebSite` + `Organization` on the home page, `Product` with an
  `Offer` (one variant) or `AggregateOffer` (price range) on product pages, USD, In/OutOfStock.
  Not yet: `BreadcrumbList`, `ProductGroup` per-variant offers (Google's preferred shape for
  variants in Shopping), shipping/return-policy details (Merchant listings warn without them),
  and reviews/ratings (the store's reviews are free text, not tied to products).
- **Cart, checkout, search and order confirmation are `noindex, nofollow`** on top of the
  robots.txt Disallow (a disallowed URL can still be indexed if linked elsewhere).
- **Share images:** product photo, else the category image, else the store's hero image, else
  the logo. Facebook/WhatsApp/X don't render SVG previews — the demo store's `/demo/*.svg`
  images won't show; real uploads (PNG/JPG/WEBP) do.
- **Language is hardcoded to English** (`<html lang="en">`, left-to-right). Arabic stores need
  per-store language support (see the i18n discussion) before their SEO is right.
