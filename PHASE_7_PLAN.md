# Phase 7 — Hardening, staff accounts, the pilot, and launch

Plan for [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md) §13's
Phase 7, plus §14 (deployment configuration) and §15 (final acceptance), and the one thing §13
does not mention: **staff accounts, which you have decided are needed before launch.**

**This is the release.** Every phase before this one ended with "nothing is released yet" and
`ANALYTICS_ROLLOUT_MODE=off`. This one ends with `pilot` on one real store, then `all`. It is
the first phase whose mistakes are seen by shoppers and merchants rather than by a verification
script.

So the shape of the risk changes one last time. Phases 1–6 could produce a wrong number, a
leaked id, or a notification nobody wanted — all recoverable, all caught by a script that ran on
a laptop. Phase 7 can produce:

1. **A store that cannot take orders**, because its own domain got HTTPS, cookies, or host
   routing wrong and nothing had ever tested that path.
2. **A staff account that can read another store**, or can read its own store's customers and
   revenue when it was only supposed to pack boxes. This phase adds a new principal to an
   isolation model that has had exactly two principals since the beginning, two weeks before
   launch.
3. **A pilot that proves nothing**, because the exit criteria were decided after looking at the
   results.

## 0. Progress

| Commit | Content | State |
|---|---|---|
| — | Plan written. Staff accounts confirmed **needed before launch**, so they are commits 1–3 and gate everything else. | done |
| - | Scope amended 2026-11-05: commits 11-12 **postponed until you say so**, and the five edge checks needing a live domain (P7-12 to P7-16) move with them; the merge into `codex/new-brand-migration` happens after commit 10 with `ANALYTICS_ROLLOUT_MODE=off`; **D73 answered** - staff see phone numbers, cancelling is owner-only; SSH and the Dokploy dashboard stay outside the Cloudflare lock (D75). | done |
| 1 | **`Role.STAFF`, the constraint and the gates - granting nothing.** A new enum value, `User.staffTenantId` with a CHECK constraint ("STAFF implies exactly one store, anything else implies none"), `requireTenantMember` beside `requireOwner`, the proxy admitting both store roles, and `/admin/no-access` - because a refusal to `/login` would loop. RLS needed no change: every policy keys on the tenant. `verify:isolation` 18. | done |
| 2 | **The capability table** (`lib/permissions.ts`): 18 capabilities, default deny, every admin page/layout/action naming one, and `verify:permissions` failing statically on one that names none. Stock got its own narrow write because the product form replaces the whole product. The nav filters from the same table the pages enforce. `verify:permissions` 24. | done |
| 3 | **`/admin/staff`**: add, reset, remove; the first password shown once; the scope stated above the form. The audit row is written in `lib/data/staff.ts`, not the action, so it cannot be omitted. `verify:staff` 17. | done |
| 4 | **Legs: `checkout.ts`, `categories.ts`, `variants.ts`.** checkout buys on the domain (consent cookie at the root, root-relative links, the WhatsApp handoff, the Server Action origin check, `/admin` 404 from there); categories replays the owner's own session against the domain to prove `/admin` is a 404 even for them; variants proves the picker hydrates and that `public/` assets are passed through. Fixed two stale assertions that were testing nothing: the category tree indents with `paddingInlineStart` (Arabic), and the WhatsApp URL arrives on the client's first render. | done |
| 5 | **Legs: `discounts.ts`, `social-links.ts`, `storefront-pages.ts`.** discounts does not read the sale price, it buys the thing and checks the order snapshot (8000). social-links separates the footer's absolute social links from its root-relative own links. storefront-pages adds the one nothing covered: `robots.txt` and `sitemap.xml` at the **host root**, which proxy.ts has always rewritten — both route docstrings called it future work and are now correct. Hardened two flakes that read a value the instant its selector appeared. | done |
| 6 | **Legs: `kinetic.ts`, `mirage.ts`, `prism.ts`. `PENDING_LEG` is empty**, and the set stays rather than being deleted so a new suite without a leg still fails. A template is almost all client code, so each leg's own assertion is that the code ran on a non-localhost host (a `.pin-spacer`, an inline style GSAP wrote); `assertStorefrontDomainBasics` holds the three things every template owes a store with a domain. | done |
| 7 | **The icon set, and the two bugs it uncovered.** Two source SVGs → eight committed PNGs via `pnpm icons:build` (Chrome, no new dependency), one declaration in `lib/push/icons.ts` that the generator, both manifests and `verify:icons` all read. The icons were the easy half: **both manifests were 307ing to `/login`**, so neither app could be installed by anyone — a browser fetches a manifest with no cookies — and a store's own domain was serving the admin manifest, because `.webmanifest` has a dot in it and the custom-domain branch checked for static files before refusing platform paths. `verify:icons` 16, `verify:permissions` 25. | done |
| 8 | **Edge hardening, and the half of it that is not in this repository.** `lib/edge.ts`: four variables all defaulting to the pre-Phase-7 behaviour, a trust gate that checks a secret Cloudflare adds (not an IP range — the socket's peer address never reaches Next), one chokepoint in front of `countryFrom` with `verify:edge` failing on a second caller, the forgeable headers dropped from an untrusted request, an https upgrade that fires only on an explicit `x-forwarded-proto: http`, and three response headers on every reply `proxy.ts` produces. `clientIp` now prefers the address the edge reported over counting hops. HSTS is absent from every committed config and `verify:edge` fails if that changes. The origin lock itself is `EDGE_HARDENING.md` §4c, with the break-glass path, because Dokploy's Traefik is shared with every other deployment on the box. Found D84 on the way: a Cloudflare-proxied domain cannot be connected in the platform admin at all. `verify:edge` 25. | done |
| 9 | **The runbook, and the configuration gap it was written to close.** `PHASE_7_DEPLOY_CHECKLIST.md` (off → verify → pilot → all, with a rollback table), `HUMAN_CHECKLIST.md`, D80's numbers above, and D78's §14 correction. The gap commit 8 reported was real but mis-attributed: `docker-compose.yml` is "reference only" per `DOCKPLOY_SETUP.md`, and **that** document — the actual production path, where environment is set in Dockploy's UI — listed 8 of the 49 variables `lib/env.ts` reads, missing all three that production refuses to boot without. Both are complete now, and `pnpm verify:config` (15 checks) compares every document against the code rather than trusting any of them. §14 itself named three variables nothing reads. | done |
| 10 | **The three testing artefacts, and what each one found.** `pentest-cross-tenant.ts` (31 attempts, each paired with the legitimate version of the same request so a refusal cannot pass vacuously, each judged by the response body rather than the status code) — it catches a `withBypass` leak planted on purpose, and it cannot catch a missing `tenantId` on an RLS-covered table, which is now written down. `load-test.ts` against a production build at 30/100/150/300: the dashboard and active-now budgets are comfortable, ingestion is over its 150 ms budget, and 300 concurrent fails 64% with the documented pool timeout on this laptop. `backup-restore-drill.ts` dumps, restores and checks the copy — row counts, forced RLS, and the runtime role, because `pg_dump` writes no `CREATE ROLE`. Its first run disagreed with `verify:aggregates` about `AnalyticsAuditLog`, so the exception list is now one declaration both read. | done |
| 10 -> merge | After commit 10: `analytics/phase-1` into `codex/new-brand-migration`, deployed with `ANALYTICS_ROLLOUT_MODE=off`, following `PHASE_7_DEPLOY_CHECKLIST.md`. **Done 2026-11-06** at `0b6cf63`, a clean fast-forward — `origin/codex` was already an ancestor, because the license `PROVIDER_UNAVAILABLE` fix had been folded in at `527fa6d`. `main` untouched (D81 still open). The test host crash-looped on `PLATFORM_PRIVACY_NAME`/`_EMAIL`, which the deploy checklist had listed and the environment had not: the environment really is the step that decides whether the container boots. Everything before `node server.js` had already succeeded, so the role script and all 15 migrations applied. | done |
| post-merge | Two fixes the deploy itself surfaced, on the same branch. **The Redis rate limiter** was `INCR` + `EXPIRE`: a fixed window where the in-memory fallback was trailing (so the shared limiter — production's — allowed up to 2x the budget across a boundary), and two round trips (a process dying between them left a bucket with a count and no TTL, which nothing clears, so that address was limited *permanently*, silently). Now one atomic Lua script over a sorted set under a versioned `rl:v2:` prefix; `verify:rate-limit` has 15 checks against a real Redis and fails without one, six of which fail against the old code. **The privacy refinement** was split in two: one refinement covering both variables could only file its issue against one path, so setting `PLATFORM_PRIVACY_NAME` and redeploying returned the identical error naming the variable just set. | done |
| post-merge | **The scheduled command had no entrypoint in the production image, and four runbooks said it did.** Found by looking: `AnalyticsScheduledRun` was empty on the test deployment while collection worked (25 events, a coherent funnel), so no aggregate existed and every report was blank. The runtime stage copies Next's standalone output, three global packages and one script — no pnpm, no tsx, no `scripts/` — so `pnpm analytics:scheduled` could never run there, and neither could `pnpm db:seed`, the documented way to create the first platform admin. Now `pnpm build:job` bundles both with esbuild (ESM, because the generated Prisma client reads `import.meta.url`), the Dockerfile copies them, and `pnpm verify:container-commands` (25 checks) fails if a runbook names something the image lacks — it found the `db:seed`, `demo:seed` and three `verify:*` instances on its first run. The verify suites and `demo:seed` are deliberately **not** bundled: they create and delete throwaway stores. The owner's "nothing has been measured yet" panel now names the third condition it was missing, in both languages, because two satisfied conditions and an empty report sent an operator looking in the wrong place. | done |
| 11 | The pilot. **Postponed until you say so.** Carries the five edge checks that need a live domain (P7-12 to P7-16). | postponed |
| 12 | `ANALYTICS_ROLLOUT_MODE=all`, launch-week monitoring, `PHASE_7_ACCEPTANCE.md`. **Postponed.** | postponed |

## 1. Scope

### In scope

1. **Staff accounts** (your decision): a third role, with a permission matrix that is one table
   rather than scattered checks, and an owner-driven invitation that does not need the email
   flow this product has never had.
2. **The nine pending custom-domain legs** — `checkout.ts`, `categories.ts`, `variants.ts`,
   `discounts.ts`, `social-links.ts`, `storefront-pages.ts`, `kinetic.ts`, `mirage.ts`,
   `prism.ts`. After commit 6, `PENDING_LEG` in `scripts/verify-e2e-policy.ts` is empty and the
   set can never grow again.
3. **A real test domain on Cloudflare**, with HTTPS forced at the edge, so `Secure` cookies,
   secure-context APIs, `cf-ipcountry`, and the tracker are exercised against the thing the
   pilot will actually run on.
4. **A real app icon set** for both PWA identities, replacing the `favicon.ico` placeholder that
   `lib/push/manifest.ts` currently admits to.
5. **Production VAPID and push-encryption keys**, generated once, never in the repository, with
   a written rotation policy — because rotating one of the two is free and rotating the other
   silently unsubscribes every device.
6. **The merge into `codex/new-brand-migration`** and the ordered deploy checklist that takes
   the platform from `off` to `pilot` to `all`.
7. **Security, performance, backup, and cross-tenant testing**, each leaving an artefact rather
   than a memory.
8. **The pilot itself**, with exit criteria written before it starts.

### Explicitly NOT in this phase

- **Shopper-facing push.** A different audience and a different consent basis; §13 put it after
  launch and nothing here changes that.
- **A self-service password reset by email.** Staff accounts are created by the owner with a
  first password, exactly as the platform admin creates owners today. Adding an email flow in
  this phase would mean adding mail infrastructure two weeks before a launch.
- **Coupon-to-campaign attribution** and **server-side conversion reporting**. Both still
  after-launch, as Phase 5 recorded.
- **Reordering storefront sections**, **pagination on admin products**, and the rest of
  [KNOWN_GAPS.md](KNOWN_GAPS.md)'s intentional MVP limits.

## 2. Decisions needed before coding

Twelve. The first four are the ones I would most like you to disagree with early rather than
late.

**D70 — A staff account is a `Role`, not a flag on `User`.**
`enum Role { PLATFORM_ADMIN, STORE_OWNER }` becomes `{ PLATFORM_ADMIN, STORE_OWNER, STAFF }`,
and `lib/roles.ts`'s `Role` union follows. The alternative — `User.isStaff` — would leave every
existing `role === "STORE_OWNER"` check silently true for staff, which is precisely the failure
mode to avoid. A new enum value makes every exhaustive `switch` in the codebase a compile error
until it is considered, and that is the point.

**D71 — A staff account belongs to exactly one tenant and can never be a platform admin.**
`tenantId` is required for `STAFF` (enforced in a check constraint as well as in code, because
this one is worth having the database refuse). `requirePlatformAdmin` rejects it. A staff
account is created by the **store owner**, with a first password the owner sets and
`mustChangePassword: true`, and `sessionVersion` works for staff exactly as it does for owners.

**D72 — The permission matrix is one exported table, and the default is deny.**

```ts
// lib/permissions.ts
export const ADMIN_CAPABILITIES = {
  "orders:read": ["STORE_OWNER", "STAFF"],
  "orders:advance": ["STORE_OWNER", "STAFF"],
  "orders:cancel": ["STORE_OWNER"],
  "products:read": ["STORE_OWNER", "STAFF"],
  "products:stock": ["STORE_OWNER", "STAFF"],
  "products:write": ["STORE_OWNER"],
  // …everything else: ["STORE_OWNER"]
} as const satisfies Record<Capability, readonly AdminRole[]>;
```

`requireCapability("orders:cancel")` is the only way a page or action is allowed to run, and
`verify:permissions`' static guard is extended to **fail on any `app/admin` page or action that
names no capability at all**. That inverts today's rule: a new screen built after this phase is
refused to staff until somebody writes down what it is for.

**D73 — What staff may do, concretely.** My proposal, and the one the matrix above encodes:

| Area | Staff | Why |
|---|---|---|
| Orders list and detail | **yes** | This is the job. They see the customer's name, phone, and address, because they cannot pack a box without them. |
| Advance an order Pending → Confirmed → Delivered | **yes** | Also the job. |
| Cancel an order | **no** | Cancellation restores stock and is final. It is a commercial decision. |
| Products and categories: read, and edit stock | **yes** | Receiving goods is the other half of the job. |
| Create/rename/delete a product, price, images | **no** | |
| Analytics, Marketing, integrations, tracked links | **no** | Revenue and traffic are the owner's. D60 already refuses staff an analytics *alert*; this refuses them the screen. |
| Content editor, theme, social links, delivery fees | **no** | |
| Discounts and coupons | **no** | |
| Staff management | **no** | Only the owner adds or removes staff. |
| Notifications | **new orders only** | Already built and enforced in the writer (`NOTIFIABLE_TYPES.STAFF`). This phase connects the screen to it. |

If you want a staff member who *can* cancel, or who *cannot* see a phone number, say so now —
both are one row in that table, but the second needs a redaction path through
`app/admin/(panel)/orders/[id]`, which is work.

**D73 is answered (2026-11-05).** Staff **do** see a customer's phone number - you cannot pack
a box without it - and cancelling is **owner-only**. Both are in the shipped table, and
`verify:staff` exercises each: the order-detail check asserts the phone number is on the page,
and `updateOrderStatusAction` picks "orders:cancel" for a cancellation and "orders:advance"
for anything else, choosing only after the status has been validated.

**D74 — One real test domain, Cloudflare proxied, Full (strict).**
One domain, bought for this, pointed at the Dockploy server, orange-cloud on. *Always Use HTTPS*
and *Automatic HTTPS Rewrites* on. Origin certificate installed so the edge-to-origin leg is
also TLS — Flexible would give the browser a padlock while the inner leg is plaintext, which
produces exactly the `Secure`-cookie behaviour we are trying to test and none of the safety.
**HSTS is turned on last**, after the pilot store has served traffic for a week, because it is
the one setting that cannot be undone quickly.

**D75 — `cf-ipcountry` is believed only if the request cannot have come from anywhere else.**
`lib/analytics/request.ts` reads `cf-ipcountry`, `x-vercel-ip-country`, `x-geo-country` and
trusts whichever appears. That is correct behind an edge and forgeable without one: anyone who
can reach the origin directly can set `cf-ipcountry: XX` and write a country of their choosing
into the analytics tables. The fix is not in the application — it is that **the origin accepts
connections only from Cloudflare's published ranges**, enforced at the reverse proxy, plus
`CF-Connecting-IP`/`cf-ipcountry` stripped from any request that arrives another way. A new
`pnpm verify:edge` asserts, against the live host, that a direct-to-origin request with a forged
country header is refused.

**SSH and the Dokploy dashboard stay outside that lock** (your instruction, 2026-11-05). The
restriction covers the HTTP origin only; port 22 and Dokploy's own port keep their existing
access. That is also the break-glass path this decision needed — the forgeable header arrives
over HTTP, and losing access to the box that serves it would be a worse failure than the one
being prevented.

**D76 — Icons: one source SVG, a generated set, two marks.**
`assets/icon-admin.svg` and `assets/icon-platform.svg` (different marks — a merchant and an
operator install two different apps, per §11.1), rendered by a script into 192, 512, and
maskable 512 PNGs under `public/icons/`, committed. Generated rather than hand-exported so the
set can be regenerated when branding changes, and committed rather than built at deploy time so
a manifest can never point at a file that the build forgot. Android refuses to install a
manifest whose icons 404, so a check asserts every `src` in both manifests resolves to a file
that exists.

**D77 — The two keys rotate differently, and the asymmetry is written down.**
`PUSH_ENCRYPTION_KEY` protects subscriptions at rest in a versioned envelope, so it can be
rotated with a re-encrypt pass. `PUSH_VAPID_PRIVATE_KEY` is the identity the push services
associate with every existing subscription: **rotating it silently breaks every installed
device**, and the devices do not find out — they just stop receiving. So the policy is: generate
once, store only in Dockploy's environment, and treat a rotation as a migration that forces
every owner to re-enable notifications, with a banner, not as an operational task.

**D78 — The code's env names win; §14 of the master plan is corrected.**
§14 lists `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`,
`PUSH_SUBSCRIPTION_ENCRYPTION_KEY`. `lib/env.ts` validates `PUSH_VAPID_PUBLIC_KEY`,
`PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`, `PUSH_ENCRYPTION_KEY`. Four names that differ
between the plan and the thing that reads them is how a production deploy comes up with push
silently unconfigured — `lib/env.ts` makes all four optional by design (P6-31), so nothing
fails, and no notification is ever sent. Phase 7 edits the master plan to match the code and the
deploy checklist names only the real variables.

**D79 — The merge happens with the rollout still `off`, and `pilot` is a separate, later change.**
`analytics/phase-1` → `codex/new-brand-migration`, deployed, verified healthy with
`ANALYTICS_ROLLOUT_MODE` absent (= `off`). Only then is `pilot` + `ANALYTICS_PILOT_TENANT_SLUG`
set, as its own environment change with its own restart. Two reasons: `lib/env.ts` refuses to
boot with `pilot` and no slug, so a combined change turns a configuration slip into a failed
deploy of everything; and if something is wrong with the merge, "is it the merge or is it
collection?" should not be a question.

**D80 — Pilot exit criteria are numeric and committed before the pilot starts.**
Written in commit 9, in `PHASE_7_DEPLOY_CHECKLIST.md` §8, before any data exists. The window is
**7 days** and at least **20 orders** — a quieter week is a dry run, not a pilot. Then:

| # | Criterion | Threshold |
|---|---|---|
| P7-27 | Analytics order count vs the authoritative `Order` table | exactly equal, **0** discrepancy |
| P7-27 | Analytics revenue vs the same | exactly equal, **0** cents |
| P7-28 | Contract rejections over the window | **0** |
| P7-29 | Operational drop rate | under **5%** |
| P7-30 | Aggregation lag without an alert firing | never above **20 minutes** |
| P7-31 | Push delivery failure rate to real devices | under **20%**, recorded either way |

The three percentages and the 20 minutes are not new numbers: they are the thresholds the code
already acts on (`ANALYTICS_INGESTION_FAILURE_PERCENT`, and `PLATFORM_THRESHOLDS` in
`lib/notifications/platform-alerts.ts`), so the pilot is held to the same line that decides
whether an alert fires. The two zeros are definitions rather than thresholds: a rejected batch
means the contract and the producer disagree, and a revenue figure that is *close* is a revenue
figure that is wrong.

**D81 — `main` is still not touched.** Phase 7 lands on `analytics/phase-1` and merges into
`codex/new-brand-migration`. Nothing in this plan pushes `main`. If the pilot is meant to run
from `main`, that is a decision for you to make explicitly at commit 9.

**D82 — The legal review is a gate, not a parallel task.** `ANALYTICS_ROLLOUT_MODE=all` does not
happen before you have sign-off on the joint-controller privacy content, the consent wording,
and the retention periods. It is the one item on the human checklist that can block commit 12.

**D83 — The origin verifies a secret, because it cannot verify an IP (commit 8).**
D75 says the fix is at the reverse proxy, and it is: Cloudflare's ranges only, edge headers
stripped from everything else. But that is a proxy configuration somebody will reasonably change
one day, and it is not something a script in this repository can hold down. So the application
keeps a half of its own, and the question is what it can actually check. **Not an IP range** —
inside Next every request's peer address is the local reverse proxy, so there is nothing to
compare. What it can check is a shared secret that a Cloudflare Transform Rule adds to every
request (`x-edge-token`) and a client reaching the origin directly cannot guess.

Three consequences worth writing down:

- `EDGE_TRUST_MODE=off` is the shipped default and means "nothing has been declared in front of
  this origin, so proxy metadata is believed" — the pre-Phase-7 behaviour, correct for `pnpm dev`
  and an explicit statement rather than an oversight.
- `lib/env.ts` refuses to boot in `cloudflare` mode with no secret. Trusting *nothing* would drop
  every visitor's country and silently fall back to hop counting, which looks exactly like a
  correctly guarded origin.
- `countryFromTrusted` is the only legitimate caller of `countryFrom`, and `verify:edge` fails if
  anything else calls it. Three readers and a comment asking everyone to remember is how the
  fourth one gets written.

Each function takes its configuration as an optional argument defaulting to the environment.
Nothing in the app passes one; `lib/env.ts` parses once per process, so behaviour that reads it
directly can only be verified by spawning a process per case, and `verify:edge` exercises all
four modes in one pass instead.

**D84 — The orange cloud and custom-domain verification conflict, and the conflict is documented
rather than resolved (commit 8).**
`lib/domain-check.ts`'s `checkDomainResolves` requires a domain's A record to equal
`SERVER_PUBLIC_IP` before `Tenant.domain` is saved. That gate is the whole of what makes the
field's "verified and live" contract true, and the proxy's rewrite, sitemaps, canonicals and
redirects all rely on it. A Cloudflare-proxied domain resolves to **Cloudflare**, so while the
orange cloud is on (D74's own instruction), that domain cannot be connected or re-saved in the
platform admin: the save is refused with `wrong-ip`.

The workaround is an ordering step — connect while DNS-only, then turn the proxy on; to change
it later, turn the proxy off, save, turn it back on. Written into `EDGE_HARDENING.md` §3 and §7
rather than fixed, because accepting "resolves into Cloudflare's ranges" would weaken the one
gate behind that contract, and would need exactly the range list that §4c argues against
committing. Found by reading `.env.example`'s own comment while adding the edge variables next
to it, not by trying it — so the first person to connect the pilot domain is the one who
confirms it.

## 3. The nine custom-domain legs

They are not nine equal pieces of work. Grouped by what each one is actually at risk of:

**Commit 4 — the ones where a failure loses money.**

- `checkout.ts`. The single most important leg in the repository. On a custom domain: the cart
  cookie's path and `Secure` flag, the consent cookie at a domain root (the Phase 2 bug), the
  order POST's origin check, `after()`'s new-order push firing from a different host, and the
  WhatsApp handoff URL. If exactly one leg existed, it would be this one.
- `categories.ts` and `variants.ts`. Catalogue navigation and variant selection, which is where
  a `fetch` built from a relative URL against the wrong origin shows up.

**Commit 5 — the ones where a failure loses data or looks broken.**

- `discounts.ts` — price computation is server-side, so the risk is the admin→storefront round
  trip across two origins.
- `social-links.ts` — a store's own domain is exactly where these are rendered.
- `storefront-pages.ts` — canonical URLs, Open Graph, and JSON-LD are *supposed* to differ per
  host; this asserts they differ correctly rather than pointing at the shared host.

**Commit 6 — the three templates with their own client behaviour.**

- `kinetic.ts`, `mirage.ts`, `prism.ts`. Each has template-specific client-side interaction, and
  a secure context is the thing that differs. This is the group where the Phase 3
  `crypto.randomUUID` class of bug lives.

Mechanics for all nine, already built: `onCustomDomain`, `assertDevOriginAllowed`,
`PRODUCTION_BUILD_HINT` from `scripts/e2e/custom-domain.ts`; each `*.test` hostname added to
`allowedDevOrigins` in `next.config.ts` or `next dev` serves the page and withholds its
JavaScript. Each commit removes its entries from `PENDING_LEG`, and `verify:e2e-policy` fails if
a suite gains a leg without the list shrinking — so the two cannot drift.

**A leg that cannot run is a failure.** Not a skip, not a skip reported as a pass. That rule is
in force for these nine exactly as for the rest, and the reason is in the header comment of
`scripts/verify-e2e-policy.ts`: the last time a custom-domain leg was added, its first run
skipped itself with a plausible-sounding excuse, and the defect it was written to find was real.

## 4. Staff accounts

### What it touches

A third principal is not a feature; it is a change to the isolation model. The surface:

- `prisma/schema.prisma` — `Role.STAFF`, a check constraint that `STAFF` implies a `tenantId`.
- `lib/roles.ts` — the `Role` union, `homeForRole` (staff go to `/admin/orders`, not `/admin`,
  because the dashboard is analytics).
- `lib/session.ts` — `requireOwner` must keep meaning *owner*, so staff get
  `requireTenantMember` for the shared parts and `requireCapability` for everything. Renaming
  `requireOwner` would be a 200-call-site change two weeks before launch; narrowing what it
  accepts is the safer move, and it fails loudly.
- `proxy.ts` — the `/admin/*` gate currently admits `STORE_OWNER`; it admits staff too, and the
  capability check inside each route does the real work. The proxy stays optimistic, as it is
  documented to be.
- **RLS**: nothing changes. Staff are scoped by the same `tenantId` session context as their
  owner, through the same `withTenant()`. This is the one piece of good news in this commit —
  the database-level isolation already covers a principal that did not exist when it was
  written, because it keys on the tenant and not on the user.
- 13 action files and 33 pages under `app/admin`, each of which must name a capability.
- `verify:permissions` — today's 22 checks are built around two roles. This is the suite that
  grows most.

### The order of work matters

Commit 1 adds the role and the gates and **grants staff nothing**. Commit 2 adds the matrix and
opens the specific doors in D73. Commit 3 adds the UI that can create one. A staff account that
exists before the matrix does can only be refused, which is the correct direction to fail.

## 5. New modules and files

| Path | Purpose |
|---|---|
| `lib/permissions.ts` | D72's capability table, `requireCapability`, `can()` for conditional UI. |
| `app/admin/(panel)/staff/{page,actions}.tsx` | Owner-only. Invite, set first password, revoke, list. |
| `assets/icon-{admin,platform}.svg` + `scripts/build-icons.ts` | D76. |
| `public/icons/*.png` | The committed generated set. |
| `lib/edge.ts` | D75/D83: the trust gate, the forgeable-header strip, the https upgrade, the response security headers. |
| `scripts/verify-edge.ts` | The 25 static checks over the above, and an explicit statement of which checks it leaves to the pilot. |
| `EDGE_HARDENING.md` | The Cloudflare and reverse-proxy runbook, in order, with the break-glass path (§8) and the line that records the date HSTS was enabled. |
| `scripts/verify-staff.ts` | The matrix exercised as a real staff session against every admin route, deny-by-default asserted. |
| `scripts/pentest-cross-tenant.ts` | §13's cross-tenant penetration test, as a script rather than an afternoon. |
| `scripts/load-test.ts` | §12.3's budgets against `next build && next start`, per CLAUDE.md. |
| `scripts/backup-restore-drill.ts` | P7-24: dump, restore into a scratch database, and check the copy rather than the exit code. |
| `scripts/_rls-exceptions.ts` | The one list of tenant-scoped tables deliberately left open, read by `verify:aggregates` and the drill. |
| `PHASE_7_DEPLOY_CHECKLIST.md` | The ordered merge → deploy → `pilot` → `all` runbook. |
| `PHASE_7_ACCEPTANCE.md` | The record, written last. |
| `HUMAN_CHECKLIST.md` | §8 below, as a file you can tick. |

## 6. Commit sequence

1. **`Role.STAFF`, the constraint, and the gates.** Schema, migration, `lib/roles.ts`,
   `lib/session.ts`, `proxy.ts`. Staff can log in and reach nothing. `verify:isolation` re-run
   to prove RLS is unchanged by a new principal.
2. **The capability matrix.** `lib/permissions.ts`, every admin page and action named,
   `verify:permissions` extended to fail on an unnamed route, `verify:staff` written.
3. **`/admin/staff`.** Owner invites and revokes; revocation bumps `sessionVersion` so a
   removed staff member's live session dies on their next request. Audited.
4. **Legs: `checkout`, `categories`, `variants`.**
5. **Legs: `discounts`, `social-links`, `storefront-pages`.**
6. **Legs: `kinetic`, `mirage`, `prism`.** `PENDING_LEG` empty.
7. **The icon set.** `build-icons.ts`, the PNGs, both manifests, the resolve check.
8. **Edge hardening.** Cloudflare settings documented, trusted-proxy guard, header stripping,
   `verify:edge`, HSTS *prepared but off*.
9. **Production keys and the runbook.** `PHASE_7_DEPLOY_CHECKLIST.md`, D78's master-plan
   correction, D80's exit criteria written down, `HUMAN_CHECKLIST.md`.
10. **Testing artefacts.** Load test at 30/100/150/300 concurrent against a production build;
    backup and *restore* drill; `pentest-cross-tenant.ts`.
11. **The pilot.** Merge, deploy at `off`, verify, switch to `pilot`, run it, compare analytics
    against authoritative orders, fix findings. This commit is a range, not a commit.
12. **Launch.** `all`, launch-week monitoring, `PHASE_7_ACCEPTANCE.md`.

## 7. Acceptance checklist

### Staff accounts

- P7-01 A staff account cannot be created without a tenant — refused by the database, not only
  by code.
- P7-02 A staff session reaching `/platform/*` is refused.
- P7-03 A staff session reaching another tenant's data is refused at the application layer and
  returns nothing at the database layer.
- P7-04 Every page and action under `app/admin` names a capability; a route that names none
  fails `verify:permissions` statically.
- P7-05 Each row of D73's table is exercised as a real staff session: allowed where allowed,
  refused where refused.
- P7-06 Revoking a staff account ends its live session on the next request.
- P7-07 A staff account receives a new-order notification and **no** analytics alert, through
  the real send path, not only through `NOTIFIABLE_TYPES`.
- P7-08 An owner's screens are unchanged: `verify:permissions` and `verify:isolation` pass at
  their pre-phase counts or higher.

### Custom domains

- P7-09 `PENDING_LEG` is empty and `verify:e2e-policy` passes with every suite having a leg.
  **Done (commits 4–6):** 44 checks, no gaps.
- P7-10 Checkout completes on a store's own domain, end to end: the consent decision at the
  domain root, the cart, the Server Action that places the order, the stock deduction and the
  delivery-fee snapshot. **Done (commit 4).** Amended: the `after()` new-order push is
  deliberately **not** in that leg. Nothing in that chain depends on the host — it runs after
  the response, against ids — and `verify:notifications` drives it with real devices and
  leases. An assertion that only fires when VAPID keys happen to be configured is a skip by
  another name, which rule 2 forbids. P7-31 is where a push from a real domain to a real device
  is accounted for.
- P7-11 No suite contains a skip path; `verify:e2e-policy`'s rule 2 still passes. **Done** —
  and it earned its keep: rule 2 failed commit 4 on the word "skip" inside a *comment*
  explaining why something was left out. The comment was reworded; the rule was not loosened.

### The edge

All five need the real domain and therefore run at the pilot, as the 2026-11-05 amendment says.
**Commit 8 landed the code, the configuration and the runbook they will be checked against**, and
`pnpm verify:edge` (25 checks, static) proves the application's half without pretending to prove
the edge's. `EDGE_HARDENING.md` §6 has the curl commands for each.

- P7-12 HTTP to a custom domain redirects to HTTPS at the edge. **Ready:** Cloudflare's *Always
  Use HTTPS* is §4a of the runbook, and `EDGE_FORCE_HTTPS` makes the origin refuse a plaintext
  request it somehow receives. `verify:edge` holds the behaviour that is easy to get wrong — it
  fires on an explicit `x-forwarded-proto: http` and **not** on an absent one, which is what the
  container's own healthcheck sends and what a redirect loop is made of.
- P7-13 A `Secure` cookie set on a custom domain is returned by the browser on the next request.
  **Needs TLS on the domain**, so it is a pilot check. `e2e:checkout`'s leg already proves the
  non-`Secure` half of it (the consent cookie at the domain root, read back after a reload) on
  `checkout-e2e.test`.
- P7-14 A direct-to-origin request carrying a forged `cf-ipcountry` is refused or has the header
  stripped — asserted against the live host. **The application half is done and checked:** in
  `cloudflare` mode a request with no `x-edge-token` gets `null` for its country and cannot
  rotate its rate-limit bucket with `cf-connecting-ip`, and the proxy drops both headers on the
  way in. The refusal itself is the Traefik middleware in §4c, which has not been applied to a
  live install — when it is, `curl -sI https://<origin-ip>/ -H "Host: <domain>"` is the check.
- P7-15 The tracker produces accepted batches on a custom domain (the Phase 3 regression, pinned
  for good). Still a pilot check on the real domain; `e2e:consent` and `e2e:checkout` pin it on
  a `.test` host, which is where the UUID regression would have been caught.
- P7-16 HSTS is present only after it is deliberately enabled, and its presence is recorded with
  a date. **Half done, and the half that can go wrong by accident:** `EDGE_HSTS_MAX_AGE` is 0 in
  `.env.example` and `docker-compose.yml`, `verify:edge` fails if either ever ships a non-zero
  value, and `lib/env.ts` refuses a max-age without `EDGE_FORCE_HTTPS`. The date line lives at
  the end of `EDGE_HARDENING.md` and currently reads "not yet enabled".

### The PWA

- P7-17 Every icon `src` in both manifests resolves to a committed file. **Done (commit 7):**
  `pnpm verify:icons`, 16 checks — each file exists, is a real PNG, and its own IHDR header
  agrees with the size the manifest advertises (a 512-byte placeholder named `icon-512.png`
  passed every other check in the repository). Extended beyond the original wording to cover
  the apple-touch icon, which no manifest names and iOS uses instead of the manifest.
- P7-18 Both manifests install on Android without an icon error. **Blocked on a real device
  (yours), but the two reasons it could not have worked are fixed and held down by checks.**
  Both manifests were 307ing to `/login`: a browser fetches a manifest with `credentials:
  "omit"`, so the role gate saw an anonymous request, and neither app could be installed by
  anyone, signed in or not. `verify:permissions` now fetches both with no session and fetches
  every icon they name. Separately, a store's own domain was serving the admin manifest,
  because the custom-domain branch's static-file passthrough ran before its platform-only
  refusal and `.webmanifest` has a dot in it; `e2e:checkout`'s leg now asserts both are 404
  there.
- P7-19 The merchant and platform apps install as two apps with two Home Screen icons.
  **Partly done (commit 7); the install itself is P7-33/P7-34 on your devices.** The two marks
  are different in silhouette and hue rather than one recoloured copy of the other, and
  `verify:icons` hashes both 512s and fails if they match — an operator who taps the wrong one
  of two identical icons is looking at another tenant's data before they notice. Each subtree
  also links its own apple-touch icon, without which an iPhone shows a screenshot of the page.

### Keys and configuration

- P7-20 A production boot with push configured validates all four `PUSH_*` variables and fails
  loudly if one is missing — rather than coming up with notifications silently off.
- P7-21 The master plan's §14 names the variables the code actually reads.
- P7-22 No secret is `NEXT_PUBLIC_*`; the VAPID public key is served from an authenticated
  route.

### Operations

- P7-23 Load test at 30/100/150 concurrent meets §12.3's budgets against a production build,
  with the numbers recorded. **Script done, numbers recorded, budgets NOT all met on a
  development machine** (`pnpm load-test`, 2026-11-06, production build on a laptop also
  running PostgreSQL and the load generator): storefront 30/100/150 concurrent pass with no
  failures (p50 1129/3545/4855 ms); 300 concurrent fails 64% with Prisma's `maxWait`, the same
  failure mode the earlier run recorded at 10%. The 30-day dashboard (p95 851 ms) and
  active-now (p95 67 ms) are inside their budgets; **ingestion is not** — p95 192 ms at 5
  concurrent against a 150 ms budget. The run that decides any of this is yours, on the VPS,
  and it is in HUMAN_CHECKLIST.md.
- P7-24 A database backup is restored into a scratch database and the app boots against it.
  **Half done: `pnpm drill:restore`, 6 checks, run today against the real database.** It dumps,
  creates a scratch database, restores, and then checks the copy rather than the exit code —
  all 36 tables' row counts match, every tenant-scoped table came back ENABLE + FORCE with its
  policies (28, plus the one documented exception), and the runtime role has its 144 grants.
  The booting half is yours: the drill prints the two commands, because a restore that passes
  every check and cannot serve a page has still failed.
- P7-25 `pentest-cross-tenant.ts` finds nothing, and its attempts are listed so a future reader
  knows what was tried. **Done: 31 attempts, all refused, against a production build.** Six
  id routes, eight list pages, the platform console, four anonymous paths, six host-header
  attacks on a store's own domain, the two internal endpoints, the public search API, and a
  final check that the target's rows are untouched. The script prints every attempt and, at the
  end, what it did **not** try and which suite covers that instead — including Server Action
  POSTs, which are not reachable from a script because Next's action ids are per-build.
- P7-26 Retention's first production run is a **dry run**, and its output is recorded before any
  real run.

### The pilot

- P7-27 The pilot store's analytics order count and revenue match the authoritative orders table
  exactly, for the whole pilot window.
- P7-28 Contract rejections over the pilot window: **zero**.
- P7-29 Operational drop rate under 5% of attempted batches.
- P7-30 Aggregation lag never exceeded 20 minutes without an alert firing.
- P7-31 Push delivery to the pilot owner's real devices: recorded, with a failure rate.
- P7-32 Every pilot finding is either fixed or written down with a reason it was not.

### Checked by a person, not a script

- P7-33 Real iPhone delivery (carried over from P6-32).
- P7-34 Real Android delivery (carried over from P6-33).
- P7-35 Every admin and report screen in Arabic, RTL, on a phone.
- P7-36 The production `app_user` role is real and restricted (the five queries in
  `DEPLOYMENT_CHECKLIST.md`).
- P7-37 Legal sign-off on privacy content, consent wording, and retention periods.

## 8. Your human tasks

The things I cannot do, with what each one needs to produce. This becomes
`HUMAN_CHECKLIST.md` in commit 9 so you can tick it somewhere durable.

**The edge (commit 8 is done; these turn it on):**

Amended 2026-11-05: this used to say "before commit 4". It was wrong — the legs needed no domain
of yours at all. Each suite drives its own `*.test` hostname that Chrome resolves to 127.0.0.1
via `--host-resolver-rules`, so commits 4–6 are done and none of them waited on you. What a real
domain is actually for is the edge: HTTPS, HSTS, a `Secure` cookie surviving a round trip, and a
`cf-ipcountry` header that can be believed — P7-12 to P7-16, which is commit 8 and the pilot.

Amended again 2026-11-05, after commit 8: the code and the runbook are in, so nothing below
blocks me any more — these are the steps only you can take, and `EDGE_HARDENING.md` is the
ordered version of them.

- [ ] **Buy the test domain** and tell me the name, so `allowedDevOrigins` and the edge checks can
      use it. A throwaway `.com` is fine; it does not need to be the real brand.
- [ ] **Connect it in the platform admin while it is still DNS-only (grey cloud).** This is an
      ordering constraint, not a preference: a proxied domain resolves to Cloudflare, and the
      save-time DNS check requires the A record to be this server's own IP, so the connection
      must happen before the orange cloud goes on (D84, `EDGE_HARDENING.md` §7).
- [ ] **Put it on Cloudflare**: nameservers moved, Always Use HTTPS on, origin certificate
      installed, Full (strict), the `x-edge-token` Transform Rule created — **then** orange-cloud
      on. Tell me when the padlock is real.
- [ ] **Generate `EDGE_SHARED_SECRET`** (`openssl rand -hex 32`) into the Transform Rule and
      Dockploy's environment, in that order, and nowhere else. Then `EDGE_TRUST_MODE=cloudflare`
      and `TRUSTED_PROXY_COUNT=2`.
- [ ] **Apply the origin lock** (`EDGE_HARDENING.md` §4c) and confirm it with the two curls in
      §6 — the labels there were written from Traefik's documentation and have never been
      applied to a live Dokploy install, so correct that section with what actually worked.
      Read §8 first: SSH and the Dokploy dashboard stay outside the lock, and that is the way
      back out.
- [ ] **Decide D73's table.** The one decision in this plan that is about your business rather
      than about code. Specifically: may staff cancel an order, and may staff see a customer's
      phone number?

**Before commit 11 (the pilot):**

- [ ] **Pick the pilot store.** One real store with real orders, whose owner knows they are in a
      pilot and will tell you when something looks wrong. A store with no orders proves nothing.
- [ ] **Generate the production keys** and put them in Dockploy only — never in a file in the
      repository, never pasted into a chat. The commands are in `.env.example`; I will have put
      the exact four variable names in the deploy checklist. Once generated, **the VAPID pair
      must never change** (D77).
- [ ] **Verify the production `app_user`** with the five queries in `DEPLOYMENT_CHECKLIST.md`.
      This is yours because it runs against the live database. All five must come back as
      documented; number 4 returning anything other than zeros means RLS is inert in production.
- [ ] **Run retention's first production pass as a dry run** and read the output before letting
      it delete anything.
- [ ] **Real-device delivery, iPhone**: install `/admin` to the Home Screen, enable
      notifications, place a real order, record how long it took and what the lock screen said.
      Then with the amount toggle on. Then in Arabic.
- [ ] **Real-device delivery, Android**: the same, plus confirm the install prompt appears and
      the icon is the new one.
- [ ] **Every screen in Arabic on your phone**, which you have already said you would do. The
      report screens, the marketing tabs, and the notification settings.
- [ ] **Backup and restore drill** — I can write the script; the restore has to happen against
      your infrastructure and you have to be the one who confirms the app came up.

**Before commit 12 (launch):**

- [ ] **Legal review.** Privacy content, consent wording, retention periods, and the
      joint-controller language. **This is a gate** (D82): `ANALYTICS_ROLLOUT_MODE=all` waits
      for it.
- [ ] **Decide whether `main` gets this** (D81), and say so.
- [ ] **Turn on HSTS**, after the pilot store has served a week of traffic (D74). Part of the postponed pilot stage.

## 9. Risks

**Staff accounts, this late.** Adding a principal to an auth model two weeks before a launch is
the thing in this plan most likely to cause an incident. The mitigations are the order of work
(a role that can do nothing, then a matrix, then a UI), deny-by-default, and the fact that RLS
keys on tenant rather than user so the database layer needs no change. The residual risk is a
route that quietly keeps working for staff because its capability was named carelessly — which
is why P7-05 exercises every row rather than trusting the table.

**Nine legs may find nine bugs.** That is the point of them, and it is also a schedule risk: the
last two times a custom-domain leg was added it found total data loss. Commits 4–6 should be
assumed to contain fixes, not just tests, and `checkout.ts` is first for that reason.

**A pilot store's owner is a real person having a real bad day** if something breaks. Worth
agreeing with them in advance what happens if it does — including that `isPaused` exists as a
kill switch independent of everything in this phase.

**The edge guard can lock you out.** Restricting the origin to Cloudflare's ranges (D75) is
correct and is also how a deploy becomes unreachable. It needs a documented break-glass path
before it is enabled.

## 10. What "Phase 7 complete" means

Every item in §7 passes or is recorded as not done with a reason; `PENDING_LEG` is empty and can
never grow; the pilot's numbers in P7-27–P7-31 are written down; §15 of the master plan is
satisfied item by item; `ANALYTICS_ROLLOUT_MODE=all` is live and the first week is monitored.

And `main` is untouched unless you have said otherwise.
