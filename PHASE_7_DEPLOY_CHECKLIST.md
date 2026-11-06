# Phase 7 deploy checklist

The ordered runbook from "commit 10 is done" to `ANALYTICS_ROLLOUT_MODE=all`. Every step is
either a command you can paste or a thing to read and confirm; where a step is yours alone it
also appears in [HUMAN_CHECKLIST.md](HUMAN_CHECKLIST.md), which is the tickable version.

Two documents this one does not repeat:

- [EDGE_HARDENING.md](EDGE_HARDENING.md) — Cloudflare, the origin lock, HSTS. §6 below says when.
- [ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md) — written for the Phases 2–3
  merge. Its connection arithmetic (§2) and `app_user` grant check (§4) still apply and are
  referenced rather than copied.

`pnpm verify:config` checks the parts of this document that can go stale: that every variable
required in production is named here, that the push variables are named as the code reads them,
that the three rollout stages appear in order, and that the dry-run flag it tells you to use
exists.

---

## 0. Before anything

- [ ] Commits 1–10 are on `analytics/phase-1` and every suite passes locally.
- [ ] `main` is untouched (D81). This merges into `codex/new-brand-migration`, and if you want
      `main` to have it, say so explicitly first — it is not assumed anywhere in Phase 7.
- [ ] You have read §1. It is the step that decides whether the container boots at all.

## 1. BEFORE MERGE — the environment

**This is the step that has gone wrong twice.** `lib/env.ts` is the only authority on what a
variable is called; everything else is checked against it (`pnpm verify:config`).

Production **refuses to boot** without these, and `lib/env.ts` names each one in the error:

| Variable | Why production requires it |
|---|---|
| `AUTH_SECRET` | Signs the session JWT |
| `PLATFORM_BASE_URL` | Sitemaps, canonicals and the platform-vs-custom-domain decision |
| `SERVER_PUBLIC_IP` | Custom-domain DNS verification compares against it |
| `REDIS_URL` | Rate limits and presence must be shared across instances |
| `R2_BUCKET` (and the other four `R2_*`) | Local-disk uploads do not survive a redeploy |
| `LICENSE_ENCRYPTION_KEY` | License secrets at rest |
| `LICENSE_HEARTBEAT_SECRET` | Authenticates the heartbeat endpoint |
| `ANALYTICS_SIGNING_SECRET` | Every store's consent cookie is signed with it |
| `PLATFORM_PRIVACY_NAME` and `PLATFORM_PRIVACY_EMAIL` | The platform is a joint controller and must be identifiable on every store's privacy page |

- [ ] Open the Dockploy environment for the `app` service and compare it against
      **DOCKPLOY_SETUP.md's "Quick Reference: All Environment Variables"**, which is now
      complete. That list — not `docker-compose.yml` — is the production path: the app is
      deployed from the Dockerfile with environment set in Dockploy's own UI, and the compose
      file is reference only (it matters for the load test in §4 and for anyone running
      `docker compose up`, where `environment:` is a whitelist and a variable not listed there
      never reaches the container).
- [ ] After the first deploy, **prove a value arrived** rather than assuming it:

      ```bash
      docker exec <app-container> printenv ANALYTICS_SIGNING_SECRET PLATFORM_PRIVACY_EMAIL
      ```

- [ ] `ANALYTICS_ROLLOUT_MODE=off`, or absent (which means `off`). Read the **current** value
      first: it has existed in production since Phase 1, and if it is already `all`, the merge
      starts collecting from every store the moment the container restarts.
- [ ] `ANALYTICS_PILOT_TENANT_SLUG` is **not** set yet. `lib/env.ts` refuses to boot with
      `pilot` and no slug, which is why the mode and the slug move together in §7 and not here.
- [ ] `TRUSTED_PROXY_COUNT` matches the deployment's shape — `1` today, `2` once Cloudflare is
      in front of Traefik (§6).
- [ ] The four `EDGE_*` variables are absent or at their defaults
      (`EDGE_TRUST_MODE=off`, `EDGE_FORCE_HTTPS=false`, `EDGE_HSTS_MAX_AGE=0`). The edge goes on
      after the deploy is healthy, not with it.
- [ ] Connection arithmetic re-checked: `ANALYTICS_DEPLOY_CHECKLIST.md` §2. Phase 5–7 added no
      new pool; `ANALYTICS_JOB_DATABASE_POOL_MAX=2` is the scheduled command's own.

### The push keys (D77 — read before generating)

- [ ] Generate **once**, into Dockploy's environment only. Never into a file in the repository,
      never pasted into a chat.

      ```bash
      npx web-push generate-vapid-keys          # PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY
      openssl rand -base64 32                   # PUSH_ENCRYPTION_KEY (32 bytes, base64)
      ```

- [ ] Set all four, with these exact names — they are what `lib/env.ts` reads, and all four are
      optional by design (P6-31), so a misspelling produces a working app with push silently off
      rather than an error:
      `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`
      (`mailto:you@yourdomain.com`), `PUSH_ENCRYPTION_KEY`.
- [ ] Understand the asymmetry before you store them: `PUSH_ENCRYPTION_KEY` can be rotated with
      a re-encrypt pass, and **`PUSH_VAPID_PRIVATE_KEY` cannot**. It is the identity every
      installed device subscribed to; changing it stops every existing device receiving
      anything, and the devices are not told. Treat a rotation as a migration that makes every
      owner re-enable notifications, with a banner — not as an operational task.
- [ ] Confirm the pair reached the app: `/admin/notifications` offers to enable notifications
      instead of saying push is not configured.

## 2. The merge

- [ ] `analytics/phase-1` → `codex/new-brand-migration`. Nothing is force-pushed and `main` is
      not touched.
- [ ] Dockploy auto-deploys on push, so treat the merge as the deploy: §1 must be finished
      first.

## 3. Migrations and the restricted role

- [ ] Migrations run (`pnpm db:deploy` in the container's start command, as today).
- [ ] **Prove `app_user` got the grants** on every new table: the four queries in
      `ANALYTICS_DEPLOY_CHECKLIST.md` §4 plus the five in `DEPLOYMENT_CHECKLIST.md`. Query 4
      returning anything other than zeros means RLS is inert in production, which is the one
      failure in this list that looks like success.
- [ ] `pnpm verify:aggregates`' P4-23a is the static half of the same rule: a tenant-scoped
      table with no forced policy fails the check before it can ship.

## 4. After the deploy, still at `off`

- [ ] The app is up, `/login` answers, an owner can sign in.
- [ ] `curl -sI https://<platform-host>/` shows `x-content-type-options`, `referrer-policy`,
      `permissions-policy` — and **no** `strict-transport-security` (§6 is where that changes).
- [ ] Both manifests answer with no session, and every icon they name resolves:
      `pnpm verify:permissions` covers it locally; in production
      `curl -s https://<host>/admin/manifest.webmanifest | head` is the quick version.
- [ ] A storefront still renders, a product page still renders, an order can still be placed.
      Collection is `off`, so no analytics row should appear for any of it.
- [ ] Load test against the production build, not `next dev`:

      ```bash
      BASE_URL=https://<host> pnpm load-test --levels=30,100,150,300
      ```

      Compare with the two sets of numbers in CLAUDE.md. The laptop run over-reports contention
      badly — this is the one that counts, and P7-23 is where it gets written down.
- [ ] Restore drill (`pnpm drill:restore`) against this database, then the half it cannot do:
      boot the app against the restored copy and place an order. Note that `pg_dump` writes no
      `CREATE ROLE`, so a restore onto a fresh machine needs `scripts/sql/rls-role.sql` before
      the runtime can connect at all.
- [ ] `BASE_URL=https://<host> pnpm pentest:cross-tenant` — 31 attempts, all of which must be
      refused, against the real deployment rather than a laptop.

## 5. The scheduled command

- [ ] Dockploy scheduled command, every five minutes, same image:

      ```bash
      node dist/analytics-scheduled.mjs
      ```

      **Not `pnpm analytics:scheduled`**, which is the development spelling. It is what this
      document said for seven phases, and it could never have worked: the runtime image has no
      `tsx`, no `scripts/` directory and no TypeScript sources, so the scheduled command had no
      entrypoint at all. Nothing aggregated, `AnalyticsScheduledRun` stayed empty, and the
      rollout being `off` is the only reason an empty report looked expected. The bundle is built
      by `pnpm build:job` in the Dockerfile's builder stage, and
      `pnpm verify:container-commands` fails if this document ever names something the image
      does not contain.
- [ ] Confirm it before scheduling it, in the deployed container:

      ```bash
      docker exec <app-container> node dist/analytics-scheduled.mjs --stage=aggregate-recompute
      ```

      Then `SELECT stage, "finishedAt", error FROM "AnalyticsScheduledRun" ORDER BY "startedAt" DESC LIMIT 5;`
      — a row with no error is the proof. Zero rows means the command is still not running, and
      a scheduler that reports success while writing no row is the failure this step exists to
      catch.
- [ ] 10–30 second graceful shutdown configured, so `after()` callbacks finish.
- [ ] **Retention's first production run is a dry run** (P7-26). Either way works; the second is
      the one to use from a scheduler:

      ```bash
      node dist/analytics-scheduled.mjs --stage=retention --dry-run
      ```

      or set `ANALYTICS_RETENTION_DRY_RUN=true` for the scheduled command's first run.
- [ ] Record what it reported, and only then let it run for real. A deletion count that is
      wildly larger than expected is the signal, and it is only visible before the deletion.

## 6. The edge

All of [EDGE_HARDENING.md](EDGE_HARDENING.md), in its §3 order. The parts that interact with
this document:

- [ ] Connect the pilot store's domain **while it is still DNS-only** (D84). A proxied domain
      resolves to Cloudflare and the save-time DNS check will refuse it.
- [ ] Transform Rule, then `EDGE_SHARED_SECRET` + `EDGE_TRUST_MODE=cloudflare`, then orange
      cloud, then `EDGE_FORCE_HTTPS=true`, then `TRUSTED_PROXY_COUNT=2`.
- [ ] The origin lock, with §8's break-glass path read first.
- [ ] P7-12 to P7-16 are checked here, against the live host, with the curls in §6 of that
      document. **HSTS stays off** until §9 of it — a week after the pilot starts serving.

## 7. Switching to `pilot` (D79)

Its own environment change, with its own restart, after the deploy above has been healthy.

- [ ] `ANALYTICS_PILOT_TENANT_SLUG=<the store's slug>` **and** `ANALYTICS_ROLLOUT_MODE=pilot`,
      set together — `lib/env.ts` refuses to boot with the mode and no slug, so a half-done
      change is a failed deploy of everything rather than a silent mistake.
- [ ] Confirm the store collects and no other store does: one storefront visit to the pilot
      store and one to another store, then check that only the first produced rows.
- [ ] The pilot owner knows they are in a pilot and knows `isPaused` exists as a kill switch
      independent of everything in this phase.

## 8. The exit criteria (D80)

Written before any data exists, which is the whole point. The pilot window is **7 days** and at
least **20 orders**; a quieter week is not a pilot, it is a dry run.

| # | Criterion | Threshold |
|---|---|---|
| P7-27 | Analytics order count vs the authoritative `Order` table | **exactly equal**, 0 discrepancy |
| P7-27 | Analytics revenue vs the same | **exactly equal**, 0 cents |
| P7-28 | Contract rejections over the window | **0** |
| P7-29 | Operational drop rate (batches attempted vs accepted) | **under 5%** |
| P7-30 | Aggregation lag without an alert firing | **never above 20 minutes** |
| P7-31 | Push delivery failure rate to the owner's real devices | **under 20%**, and recorded either way |

Where each number comes from: the two 20s and the 5 are the thresholds the code already acts on
(`PLATFORM_THRESHOLDS` in `lib/notifications/platform-alerts.ts` and
`ANALYTICS_INGESTION_FAILURE_PERCENT`), so the pilot is held to the same line the alerts are. The
two zeros are not thresholds but definitions: a rejected batch means the contract and the
producer disagree, and a revenue figure that is close is a revenue figure that is wrong.

- [ ] Each row above has a number written next to it before `all` is considered.
- [ ] Every pilot finding is either fixed or written down with the reason it was not (P7-32).

## 9. Switching to `all`

- [ ] **Legal sign-off first** (D82): privacy content, consent wording, retention periods, the
      joint-controller language. This is a gate, not a parallel task.
- [ ] `ANALYTICS_ROLLOUT_MODE=all`, its own change, its own restart.
- [ ] Watch the first week: contract rejections, drop rate, scheduled-run failures, and the
      platform alerts that fire on transition.
- [ ] HSTS on, last, a week after the pilot started serving (EDGE_HARDENING.md §9), and record
      the date there.

## 10. Rollback

In the order you would actually want them.

| Situation | What to do |
|---|---|
| Collection is wrong or noisy | `ANALYTICS_ROLLOUT_MODE=off`. Code stays, collection stops, consent and the per-store GA4/Meta gating are unaffected (they are not tied to the rollout, by design). |
| One store is in trouble | `isPaused` on that tenant. A kill switch independent of licensing and of the rollout. |
| Push is misbehaving | Clear nothing. Owners can disable per device; `PUSH_*` left set but a sender failure never costs an order. Do **not** rotate `PUSH_VAPID_PRIVATE_KEY` as a fix — it silently unsubscribes every device. |
| The edge lock refuses real visitors | EDGE_HARDENING.md §8: SSH in, remove the `cf-only` middleware, redeploy that service. SSH and the Dockploy dashboard are deliberately outside the lock. |
| The deploy will not boot | Read the error: `lib/env.ts` names the variable. §1's table is the list of things it can be. |
| The merge itself is suspect | Revert the merge commit on `codex/new-brand-migration`. The rollout being `off` is what makes this a code-only revert rather than a data decision. |
