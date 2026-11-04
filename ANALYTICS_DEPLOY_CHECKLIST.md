# Deploying Phases 2–3 (analytics collection)

What merging `analytics/phase-1` into `codex/new-brand-migration` changes in a running
production deployment, in the order the steps must happen. Written for a Dockploy deployment
that auto-deploys on push, which means **some of these steps happen whether you do them or
not** — the ones marked **BEFORE MERGE** are the ones you cannot do afterwards.

Scope checked against the merge base `d0f1e48`, so "new" below means new *to production*, not
new to this branch. Phase 1 (consent, privacy, rollout controls) is already on the base branch
and is deliberately left out.

## 0. The short version

The deploy is **safe by default** and needs **no new environment variable**:

- Every one of the 5 new variables is optional and has a default.
- `ANALYTICS_ROLLOUT_MODE` defaults to `off`, so a variable you never set collects nothing.
- No new variable is *required in production*, so nothing added here can crash the container at
  boot the way a missing `ANALYTICS_SIGNING_SECRET` does.

Two things still need you:

1. **Confirm `ANALYTICS_ROLLOUT_MODE` is `off` in Dockploy before the merge** (§1). It already
   exists in production from Phase 1, so its value is whatever was set then — and if that value
   is `all`, this merge starts collecting from every store the moment the container restarts.
2. **Check `app_user` really got the grants on the four new tables after migrating** (§4). The
   container's ordering makes this work automatically, for one non-obvious reason; §4 says how
   to prove it rather than assume it.

## 1. BEFORE MERGE — the rollout switch

```bash
ANALYTICS_ROLLOUT_MODE=off
```

- [ ] Open the Dockploy environment for the app and read the **current** value.
- [ ] If it is absent, nothing to do: `lib/env.ts` defaults it to `off`.
- [ ] If it is `pilot` or `all`, set it to `off` **now, before the merge**, unless you intend
      collection to start with this deploy.

`off` means no first-party event is collected from any store. It does **not** silence the
consent banner or the per-store GA4/Ads/Meta gating — those are not tied to the rollout, by
design (`lib/analytics/rollout.ts`), so turning collection off does not take a store back to
tracking without consent.

Phase 3 is not a release. §13 of the master plan holds the launch until Phase 7, so the
intended state after this deploy is: code present, collection `off`.

## 2. BEFORE MERGE — connection arithmetic

This deploy adds a **second pool in every app instance**:

| Pool | Variable | Default |
|---|---|---|
| Application | hardcoded in `lib/prisma.ts` | 30 |
| Analytics ingestion | `ANALYTICS_DATABASE_POOL_MAX` | 5 |

- [ ] `instances × 35 + 2 (migrations, psql) ≤ Postgres max_connections`.
      One instance needs 35 and the Postgres default `max_connections` is 100, so a single-instance
      Dockploy deployment has room without changing anything.
- [ ] If you run more than two instances, raise `max_connections` **or** lower
      `ANALYTICS_DATABASE_POOL_MAX` — lower it, not the application pool, because analytics work
      is designed to be dropped and checkout is not.

The analytics pool also carries a 1s connection timeout and a 500ms `statement_timeout`, and a
concurrency ceiling of `4 × pool` in front of it. Those are deliberate: a burst becomes an
immediate refusal rather than a queue of waiting requests. Nothing to configure.

## 3. Environment variables (all optional)

New to production with this merge. Set none of them and you get the column on the right.

| Variable | Default | Why you would change it |
|---|---|---|
| `ANALYTICS_DATABASE_POOL_MAX` | 5 | §2's arithmetic |
| `ANALYTICS_MAX_BATCH_SIZE` | 20 | Events accepted per beacon |
| `ANALYTICS_MAX_IN_FLIGHT` | 4 × pool | Batches in flight per process before refusing |
| `ANALYTICS_SESSION_TIMEOUT_MINUTES` | 30 | The rolling session window |
| `ANALYTICS_ACTIVE_WINDOW_MINUTES` | 5 | How recent "active now" means |

- [ ] Copy the block from `.env.example` into Dockploy if you want them pinned explicitly
      rather than defaulted. Pinning is the better habit, since a default that changes in a
      later phase then cannot change behaviour under you.

Already required in production from Phase 1, so **verify they are still set** — the container
refuses to boot without them, and a crash-loop right after a merge looks like this merge's
fault:

- [ ] `ANALYTICS_SIGNING_SECRET` (32+ chars)
- [ ] `PLATFORM_PRIVACY_NAME`, `PLATFORM_PRIVACY_EMAIL`
- [ ] `APP_DATABASE_URL` (the restricted role — without it RLS silently does not run)

Not yet used by any code, and listed in §14 of the master plan for **Phase 4**. Do not add them
now; they would validate as unknown keys and mean nothing:
`ANALYTICS_RAW_RETENTION_DAYS`, `ANALYTICS_AGGREGATE_RETENTION_MONTHS`,
`ANALYTICS_VISITOR_RETENTION_MONTHS`, `ANALYTICS_JOB_DATABASE_POOL_MAX`,
`ANALYTICS_INGESTION_FAILURE_PERCENT`.

## 4. Migrations

Three new ones, applied in this order:

| Migration | What it does | Lock |
|---|---|---|
| `20261104160000_analytics_collection` | Creates `AnalyticsVisitor`, `AnalyticsSession`, `AnalyticsEvent` + indexes, FORCE RLS + `tenant_isolation` policy on each | New tables; brief `ACCESS EXCLUSIVE` on `Tenant` for the foreign keys |
| `20261104180000_order_attribution` | 8 nullable columns on `Order` | Brief `ACCESS EXCLUSIVE` on `Order` |
| `20261104190000_order_attribution_revision` | Drops `analyticsVisitorId`, adds `isReturningVisitor`, `firstTouchMedium`, `firstTouchCampaign` | Brief `ACCESS EXCLUSIVE` on `Order` |

- [ ] Nothing to run by hand. The container's command is
      `node scripts/ensure-app-role.cjs && prisma migrate deploy && node server.js`, so both
      happen at boot.
- [ ] No backfill. Every added column is nullable and old orders are *supposed* to read null:
      they were placed before attribution existed, and writing a guess into a snapshot column
      would be inventing history.
- [ ] The two `ALTER TABLE "Order"` steps are metadata-only (nullable add, drop), so they are
      milliseconds even on a large table — but they do take an exclusive lock, so checkout
      writes wait for that moment. Deploy outside your busiest hour if you can.

**The grants question.** `ensure-app-role.cjs` runs its `GRANT ... ON ALL TABLES` **before**
`prisma migrate deploy` creates these tables, so that statement cannot cover them. They are
granted anyway, by the `ALTER DEFAULT PRIVILEGES` in the same script — which applies to tables
created *later by the role that ran it*. Both commands run as `DATABASE_URL`, so they match and
it works.

That coupling is invisible and would break the day migrations are applied by some other
superuser (a manual `psql` as `postgres` against a database owned by someone else). So prove it
rather than trust it, after the first boot:

```bash
psql "$DATABASE_URL" -c "SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee = 'app_user' AND table_name LIKE 'Analytics%' GROUP BY table_name;"
```

- [ ] Four rows, each `DELETE,INSERT,SELECT,UPDATE`: `AnalyticsConsentReceipt`,
      `AnalyticsEvent`, `AnalyticsSession`, `AnalyticsVisitor`.
- [ ] If any is missing, re-run the role script — it is idempotent and its
      `GRANT ... ON ALL TABLES` will now see the new tables:
      `psql "$DATABASE_URL" -v app_pw="$APP_DB_PASSWORD" -f scripts/sql/rls-role.sql`

## 5. `rls-role.sql` — you probably do not need it

- [ ] **No action** if the deployment already runs the container command above:
      `scripts/ensure-app-role.cjs` does exactly what `scripts/sql/rls-role.sql` does (creates
      `app_user` `NOSUPERUSER NOBYPASSRLS`, grants, default privileges) and runs on every boot.
- [ ] The new tables' RLS **policies** come from the migration itself, not from this script, so
      there is nothing to re-apply for them.
- [ ] Run it by hand only in the two cases above: a grant missing in §4, or a database whose
      migrations were applied by a role other than `DATABASE_URL`.

Verify RLS is actually on, which is the thing that silently does not happen:

```bash
psql "$DATABASE_URL" -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname LIKE 'Analytics%' AND relkind = 'r' ORDER BY relname;"
```

- [ ] All four tables `t | t`. Same query with `relname = 'TenantLicense'` must also be `t | t`
      once `20261105230000_tenant_license_rls` has run — and the app must be on the matching
      code (see §7).
- [ ] `APP_DATABASE_URL` points at `app_user`, not the owner. RLS does not apply to a superuser
      or a `BYPASSRLS` role, so an app connected as the owner has no isolation at the database
      layer at all — only the application's WHERE clauses.

## 6. After the deploy

- [ ] Container booted (no env validation failure in the logs).
- [ ] A storefront loads and a test order completes.
- [ ] `SELECT count(*) FROM "AnalyticsEvent";` is **0**, which is what `off` is supposed to
      produce. A non-zero count here means the rollout switch is not what §1 says it is.
- [ ] Logs carry no `[analytics] invalid envelope:` lines. One means a browser is sending
      something the contract refuses — a real bug, which until this phase was invisible.
- [ ] Logs carry no `[analytics] batch dropped:` lines.

## 7. Rollback

- [ ] **To stop collection:** set `ANALYTICS_ROLLOUT_MODE=off` and restart. This is the whole
      kill switch; there is also a per-store `analyticsPausedAt` for silencing one store.
- [ ] **To roll back the code:** redeploy the previous image. The three migrations above stay
      applied and that is fine — the older code neither reads nor writes those columns and tables.
- [ ] **One exception, and it is silent.** `20261105230000_tenant_license_rls` puts
      `TenantLicense` under RLS, and the code in the same change reads the licence through
      `getLicenseAccessSnapshot` instead of an `include` on `getTenantBySlug`. Older code still
      uses the include, which under the policy returns null for every store — and
      `isLicenseActive(null)` is `true` by design during the opt-in rollout. So rolling the code
      back **while that migration stays applied stops licence enforcement with no error**: every
      store serves, expired or not. Roll that migration back with the code
      (`ALTER TABLE "TenantLicense" DISABLE ROW LEVEL SECURITY;`
      `DROP POLICY tenant_isolation ON "TenantLicense";`) or decide deliberately to run
      unenforced until you roll forward again.
- [ ] **Do not** write a down-migration to drop the `Order` columns. Dropping a column that a
      later deploy writes into loses attribution for every order placed in between, and the
      columns are harmless when unread.
