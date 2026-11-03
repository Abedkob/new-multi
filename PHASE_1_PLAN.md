# Phase 1 — Privacy, Controller Setup, and Consent

Implementation plan for Phase 1 of [STOREFRONT_ANALYTICS_MASTER_PLAN.md](STOREFRONT_ANALYTICS_MASTER_PLAN.md).
Branch: cut from `codex/new-brand-migration`. Nothing here is released publicly (§13: no phase ships alone).

Master-plan sections covered: §2.2 (behavior that must change), §2.3 (launch control),
§4.1–§4.4 (joint controllers, merchant privacy setup, consent banner, tenant cookies),
§4.7 (retention/privacy identifier, consent-receipt part only), §9.2 (tenant fields),
§9.3 (`AnalyticsConsentReceipt` only), §14 (Phase 1 env vars).

---

## 1. Scope

### In scope

1. Tenant privacy / locale / timezone / rollout-pause fields + migration + backfill for existing stores.
2. `AnalyticsConsentReceipt` table with forced RLS, following the `Coupon` migration pattern.
3. Tenant-scoped, signed, versioned consent cookie and its server/client read path.
4. Consent banner + "Manage choices" dialog, EN/AR, scoped RTL, theme-token styled, on all 13 templates.
5. `Cookie settings` entry in every storefront footer (one change: `templates/store-footer.tsx` is shared).
6. Storefront privacy page carrying the essence of the joint-controller arrangement (§4.1).
7. Gating the existing GA4 / Google Ads / Meta Pixel tags behind consent categories.
8. Removing the platform's own GA script from storefront routes (§2.2, first bullet).
9. Platform store-creation form: controller details, locale, timezone, agreement version/timestamp.
10. `ANALYTICS_ROLLOUT_MODE` / `ANALYTICS_PILOT_TENANT_SLUG` + platform-only emergency pause.
11. Verification: `PHASE_1_ACCEPTANCE.md`, `pnpm verify:consent`, `pnpm e2e:consent`.

### Explicitly NOT in this phase

- `store_visitor_*` / `store_session_*` cookies — minted by the ingestion endpoint, which is Phase 2 (§13).
  Phase 1 ships the cookie module that *can* mint them, unwired. (Decision **D3**.)
- Any analytics event, ingestion endpoint, presence, Redis work, aggregates, dashboards, PWA, push.
- The §8.1 Redis fail-open rate-limiter fix — Phase 2 in the master plan. (Decision **D6**.)

---

## 2. Decisions needed before coding

| # | Decision | Recommendation |
|---|---|---|
| **D1** | When `ANALYTICS_ROLLOUT_MODE=off` or a store is outside the pilot, do its existing GA/Ads/Meta tags still fire ungated? | **Gate third-party tags and show the banner for every store from day one, independent of rollout.** Rollout then gates only first-party collection (Phase 2+). Otherwise non-pilot stores keep firing ungated tags, which is the exact compliance hole §2.2 names. |
| **D2** | Consent + joint-controller wording. §4.1/§4.3 say final wording needs local legal review. | Ship structurally complete EN/AR copy marked `TODO(legal)` in one file (`lib/consent/copy.ts`), so replacing it later is a text edit, not a refactor. |
| **D3** | Visitor/session cookies now or in Phase 2? | Phase 2. They have no reader until ingestion exists, and minting identifiers nothing consumes is pure risk. |
| **D4** | Platform GA id `G-E98428QNRW` is hardcoded in `app/layout.tsx`. | Move to `PLATFORM_GA_ID` env (optional, format-validated). Removes a deploy-specific constant from source. |
| **D5** | Cookie name key: slug or opaque id? | `store_consent_<tenantKey>` where `tenantKey` = first 12 chars of base32url HMAC(tenantId). Slugs are renameable (orphaning consent); raw tenant ids leak internal identifiers into a client-readable cookie name. |
| **D6** | Fold the Redis fail-open fix (§8.1) into Phase 1? | No by default — it is Phase 2 and touches checkout. It is ~15 lines if you want it; say so and it goes in its own commit. |

---

## 3. Data model

### 3.1 `Tenant` additions (§9.2)

```prisma
analyticsTimezone         String    @default("Asia/Beirut")  // IANA, §3.7
defaultLocale             String    @default("en")           // "en" | "ar", §4.2
privacyControllerName     String?                            // merchant/controller display name
privacyEmail              String?                            // privacy contact
privacyPolicyUrl          String?                            // optional merchant policy
jointControllerVersion    String?                            // agreement version recorded
jointControllerRecordedAt DateTime?
jointControllerRecordedBy String?                            // platform operator user id
consentNoticeVersion      Int       @default(1)              // bump => re-prompt (§4.3)
analyticsPausedAt         DateTime?                          // platform-only emergency pause (§2.3)
analyticsPauseReason      String?
```

- CHECK constraint on `defaultLocale IN ('en','ar')`; IANA zone validated in app code via `Intl.supportedValuesOf("timeZone")`.
- Existing stores: the migration backfills timezone/locale from `PLATFORM_TIMEZONE` / `PLATFORM_DEFAULT_LOCALE`; controller fields stay NULL and the platform store list shows an "Incomplete privacy setup" badge. §2.3 requires these filled before pilot, so `verify:consent` fails while any store in the rollout has NULL controller fields.

### 3.2 `AnalyticsConsentReceipt` (§4.7, §9.3)

```prisma
model AnalyticsConsentReceipt {
  id                 String   @id @default(cuid())
  tenantId           String
  publicRef          String   @unique   // shown in Cookie settings for privacy requests (§4.7)
  noticeVersion      Int
  analyticsGranted   Boolean
  advertisingGranted Boolean
  locale             String              // locale the notice was shown in
  decisionMethod     String              // BANNER_ACCEPT_ALL | BANNER_REJECT | MANAGE | FOOTER_WITHDRAW
  country            String?             // trusted proxy metadata only (§4.5)
  deviceClass        String?             // coarse: mobile | tablet | desktop
  decidedAt          DateTime @default(now())
  expiresAt          DateTime            // ~6 months, matches the cookie
}
```

No IP, no user-agent string, no visitor id — a receipt proves *a* decision was recorded, not who made it.
Retention (24 months after expiry, §4.7) is enforced by the Phase 4 scheduled command; Phase 1 only writes receipts.

### 3.3 Migration (`prisma/migrations/<ts>_analytics_consent/migration.sql`)

Hand-written, mirroring `20261103210000_checkout_coupons`:

- `CREATE TABLE "AnalyticsConsentReceipt"` + `CHECK` on `decisionMethod` and `locale`.
- `CREATE UNIQUE INDEX "AnalyticsConsentReceipt_id_tenantId_key"` (composite-FK target convention).
- `CREATE INDEX ... ("tenantId", "decidedAt")`.
- `FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE`.
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation`, identical in shape to `Coupon`.
- `ALTER TABLE "Tenant" ADD COLUMN ...` for §3.1 plus the backfill `UPDATE`.

**`scripts/sql/rls-role.sql` must be re-run** after this migration so `app_user` can reach the new table
(`ALTER DEFAULT PRIVILEGES` covers new tables, but re-running is the documented, safe step). This goes in the deploy notes.

---

## 4. New modules

| File | Purpose |
|---|---|
| `lib/consent/types.ts` | `ConsentCategories = { essential: true; analytics: boolean; advertising: boolean }`, `ConsentDecision`, notice-version type. Pure, client-safe. |
| `lib/consent/cookie.ts` | Cookie name (`tenantKey` via HMAC, **D5**), HMAC-signed payload encode/decode, version compare, TTL, `Secure`/`SameSite=Lax`, path scoping (`/store/<slug>` on the platform domain, `/` on a custom domain, §4.4). Server-only. |
| `lib/consent/copy.ts` | Full EN/AR notice, category descriptions, button labels, privacy-page body, `TODO(legal)` markers (**D2**). |
| `lib/consent/read.ts` | `readConsent(tenant, cookieStore)` for Server Components; returns the decision plus `needsPrompt` (missing, or `consentNoticeVersion` bumped). |
| `lib/analytics/rollout.ts` | `rolloutIncludes(tenant)` from `ANALYTICS_ROLLOUT_MODE` + `ANALYTICS_PILOT_TENANT_SLUG`, and `analyticsPaused(tenant)`. |
| `components/consent/consent-provider.tsx` | Client context holding the decision; reads the readable consent cookie, exposes `useConsent()`. |
| `components/consent/consent-banner.tsx` | Banner + Manage dialog. Accept all / Reject non-essential / Manage choices, no preselected non-essential box, equal prominence, EN/AR switch, `dir="rtl"` scoped to the banner, theme tokens + `readableOn()` from `lib/theme.ts`. |
| `components/consent/cookie-settings-link.tsx` | Footer entry that reopens the dialog (withdrawal as easy as acceptance, §4.3). |
| `app/actions/consent.ts` | `recordConsentAction` — Server Action: validates categories, writes the signed cookie, inserts the receipt through `withTenant()`, returns `publicRef`. |
| `app/store/[slug]/privacy/page.tsx` | Joint-controller essence, both controllers' details, cookie table, retention, privacy identifier (§4.1, §4.7). |
| `lib/i18n/storefront/{en,ar}.ts` | Storefront-facing strings. Separate from the admin dictionaries: `admin_locale` is the owner's dashboard language, not the shopper's (§4.3 requires the shopper to switch independently). |

---

## 5. Changes to existing files

| File | Change |
|---|---|
| `app/layout.tsx` | **Remove** the platform GA `<Script>` pair. Platform GA moves into a `components/platform-analytics.tsx` mounted only in the platform layout, the admin layout, and the login route — never under `/store/*` (§2.2). Id from `PLATFORM_GA_ID` (**D4**). |
| `lib/analytics.tsx` | Split `AnalyticsConfig` consumption by consent category: GA4 => `analytics`, Google Ads + Meta Pixel => `advertising`. `gtagFor()` currently configures `gaId` and `adsId` together — it must take the granted set and configure only granted ids. `<Script>` tags render **only** after the relevant grant, so nothing is requested pre-consent (Google basic consent behavior, §4.3). `useTrack()` stays a no-op when ungranted. |
| `app/store/[slug]/layout.tsx` | Read consent server-side, wrap the shell in `ConsentProvider`, pass granted categories into `StoreAnalytics`, render `ConsentBanner` when `needsPrompt`. Keep the existing `canServeTenant()` short-circuit ahead of all of it. |
| `templates/store-footer.tsx` | Add `Cookie settings` to all three layouts (`centered`, `columns`, `editorial`) — covers all 13 templates in one place. |
| `prisma/schema.prisma` | §3.1 + §3.2. |
| `lib/env.ts` | `ANALYTICS_ROLLOUT_MODE` (off / pilot / all, default off), `ANALYTICS_PILOT_TENANT_SLUG`, `ANALYTICS_SIGNING_SECRET` (min 32, **required in production**), `ANALYTICS_SIGNING_KEY_VERSION`, `PLATFORM_PRIVACY_NAME/EMAIL/URL`, `PLATFORM_DEFAULT_LOCALE`, `PLATFORM_TIMEZONE`, `PLATFORM_GA_ID`. Same `.refine()` production-required style already used for `LICENSE_*`. Plus a refine: pilot mode requires `ANALYTICS_PILOT_TENANT_SLUG`. |
| `lib/validation.ts` | `createStoreSchema` gains controller name/email/optional URL/locale/timezone; new `tenantPrivacySchema` for later edits. |
| `app/platform/(admin)/stores/new/*` | Collect §4.2 fields; record `jointControllerVersion` + `RecordedAt` + `RecordedBy` from the authenticated admin (`requirePlatformAdmin()`). |
| `app/platform/(admin)/stores/[slug]/` | New `privacy/` route to edit controller details, locale, timezone; emergency analytics pause control next to the existing `store-pause-control.tsx`. |
| `.env.example`, `PRODUCTION.md`, `DEPLOYMENT_CHECKLIST.md` | New vars + the `rls-role.sql` re-run step. |
| `package.json` | `verify:consent`, `e2e:consent`. |

---

## 6. Commit sequence

Each commit is independently reviewable and leaves `typecheck` + `lint` green.

1. **env + rollout plumbing** — `lib/env.ts`, `lib/analytics/rollout.ts`, `.env.example`.
2. **schema + migration** — Prisma models, hand-written SQL with RLS, backfill, `rls-role.sql` note.
3. **consent core** — `lib/consent/*`, `app/actions/consent.ts`, storefront dictionaries.
4. **consent UI** — provider, banner, manage dialog, footer link, privacy page, RTL + theme styling.
5. **tag gating** — `lib/analytics.tsx` category split, storefront layout wiring, platform-GA relocation out of the root layout.
6. **platform privacy setup** — store-creation fields, per-store privacy route, emergency pause.
7. **verification** — `PHASE_1_ACCEPTANCE.md`, `scripts/verify-consent.ts`, `scripts/e2e/consent.ts`, package scripts.

---

## 7. Acceptance checklist

Written to `PHASE_1_ACCEPTANCE.md` in commit 7. Every item is binary and names its own evidence.
Nothing is reported complete without pasted command output.

### No tracking before consent (the compliance core)

| # | Item | Evidence |
|---|---|---|
| P1-01 | Zero network requests to `googletagmanager.com`, `google-analytics.com`, `connect.facebook.net`, `doubleclick.net` before a consent choice, on a store with all three ids configured | `e2e:consent` (request-log assertion, not source inspection) |
| P1-02 | No `<script>` with a tracking src exists in the pre-consent DOM | `e2e:consent` |
| P1-03 | No analytics cookie is set pre-consent; only the essential consent cookie after a choice | `e2e:consent` |
| P1-04 | Platform GA does not execute on `/store/*` | `verify:consent` (static: no platform-GA mount reachable from the storefront tree) + `e2e:consent` request log |
| P1-05 | Accepting analytics only => GA4 loads, Ads + Meta do not | `e2e:consent` |
| P1-06 | Accepting advertising only => Ads + Meta load, GA4 does not | `e2e:consent` |
| P1-07 | `useTrack()` events are inert while the relevant category is ungranted | `verify:consent` |

### Withdrawal and versioning

| # | Item | Evidence |
|---|---|---|
| P1-08 | Footer `Cookie settings` present on all 13 templates | `verify:consent` (renders each template's footer) |
| P1-09 | Withdrawal takes no more clicks than acceptance | `e2e:consent` (click-count assertion) |
| P1-10 | After withdrawal, no further tracking requests leave the page | `e2e:consent` |
| P1-11 | Bumping `consentNoticeVersion` re-prompts a visitor with a stored decision | `e2e:consent` |
| P1-12 | A tampered or unsigned consent cookie is rejected and re-prompts | `verify:consent` |
| P1-13 | Consent cookie: `Secure`, `SameSite=Lax`, ~6-month TTL, correct path scope | `verify:consent` |

### Banner correctness

| # | Item | Evidence |
|---|---|---|
| P1-14 | No non-essential category is preselected | `e2e:consent` |
| P1-15 | Accept and Reject have comparable prominence (same size class, both in the primary row) | `verify:consent` (static class assertion) + screenshot |
| P1-16 | EN/AR switch works inside the banner; Arabic sets `dir="rtl"` scoped to the banner only | `e2e:consent` |
| P1-17 | Banner text/background contrast >= 4.5:1 for all 13 template defaults and all `COLOR_SCHEMES` | `verify:consent` (computed ratio per combination) |
| P1-18 | Keyboard reachable: focus trap in the dialog, Esc closes, focus returns to the trigger | `e2e:consent` |
| P1-19 | Renders correctly at 375px without horizontal scroll | `e2e:consent` (mobile viewport) |

### Commerce must not regress

| # | Item | Evidence |
|---|---|---|
| P1-20 | Rejecting analytics leaves storefront, cart, checkout and the WhatsApp button fully functional — a real order completes | `e2e:consent` |
| P1-21 | `verify:isolation`, `verify:commerce`, `verify:coupons`, `verify:templates` still pass | their own output |
| P1-22 | `typecheck` + `lint` clean | their own output |

### Data layer

| # | Item | Evidence |
|---|---|---|
| P1-23 | A consent receipt row is written per decision, with the right method/version/locale | `verify:consent` |
| P1-24 | Receipt rows are invisible across tenants under RLS (the `app_user` role) | `verify:consent` (cross-tenant read returns 0) |
| P1-25 | No receipt column holds IP, full user-agent, or a visitor identifier | `verify:consent` (column allowlist) |
| P1-26 | Tenant deletion cascades receipts | `verify:consent` |
| P1-27 | Existing stores backfilled with timezone + locale; stores in rollout with NULL controller fields are reported | `verify:consent` |
| P1-28 | Pilot rollout mode without a pilot slug fails startup | `verify:consent` |
| P1-29 | Missing `ANALYTICS_SIGNING_SECRET` fails startup in production | `verify:consent` |

### Known-incomplete, reported not hidden

| # | Item | Why |
|---|---|---|
| P1-30 | Legal wording is placeholder `TODO(legal)` | §4.1/§4.3 require local legal review (**D2**) |
| P1-31 | Screen-reader pass not performed | ARIA/focus is assertable; real assistive-technology testing is a human or auditor task |
| P1-32 | Custom-domain cookie path scoping untested end to end | Needs real DNS pointed at the server; only the platform-domain path is locally testable |

---

## 8. Risks

- **Dev server caches the Prisma client** — restart `pnpm dev` after the migration (CLAUDE.md gotcha), or every consent write throws.
- **`rls-role.sql` not re-run** => the new table is unreachable by `app_user` and consent writes fail in RLS environments. Deploy note + a `verify:consent` check.
- **`lib/analytics.tsx` is the riskiest edit.** It carries careful load-order logic (queue stubs installed before the real libraries arrive) and SPA dedupe behavior. The category split must keep the stub/replay path intact; the one-time `configured` set now has to be per-category.
- **`app/layout.tsx` GA removal touches every route.** Admin and platform must keep their platform GA, so commit 5 verifies both still emit it while `/store/*` does not.
- **Banner on 13 templates** — footers are shared, but each template's surface colors differ. P1-17 is a computed check across every template x scheme combination rather than eyeballing.
- **`e2e:consent` needs a running server + Chrome** and creates/removes a throwaway store, like the existing `e2e:*` scripts.

---

## 9. What "Phase 1 complete" means

`PHASE_1_ACCEPTANCE.md` with every item P1-01..P1-29 showing passing evidence, P1-30..P1-32
declared open, and `pnpm verify:consent && pnpm e2e:consent && pnpm typecheck && pnpm lint`
reproducible by you from a clean checkout. Phase 1 is not a release — §13 holds the public
launch until Phase 7.
