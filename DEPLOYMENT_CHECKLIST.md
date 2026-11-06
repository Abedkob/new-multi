# Dockploy Deployment Checklist

**Status:** Ready for Dockploy deployment
**Last Updated:** 2026-09-23

Fast-track checklist for deploying to Dockploy.

Deploying the analytics phases (collection, funnel, order attribution) has its own ordered
checklist, including the one switch you cannot set after the merge:
[ANALYTICS_DEPLOY_CHECKLIST.md](ANALYTICS_DEPLOY_CHECKLIST.md).

## Pre-Deployment

### Code & Infrastructure
- [ ] All tests passing: `pnpm typecheck && pnpm lint`
- [ ] Recent commits reviewed
- [ ] Pushed to main branch: `git push origin main`
- [ ] Dockploy instance is running and accessible
- [ ] Domain registered and ready for DNS pointing
- [ ] Have access to Dockploy dashboard

### Environment Variables Ready
- [ ] Generate `AUTH_SECRET`: `openssl rand -base64 32`
- [ ] Generate `ANALYTICS_SIGNING_SECRET`: `openssl rand -base64 32` (required in production)
- [ ] Decide `PLATFORM_PRIVACY_NAME` / `PLATFORM_PRIVACY_EMAIL` (required in production - they
      appear on every store's privacy page)
- [ ] Confirm `PLATFORM_TIMEZONE` is the right reporting basis for new stores
- [ ] Set strong passwords:
  - `DB_PASSWORD` (PostgreSQL)
  - `APP_DB_PASSWORD` (RLS-bound app user)
  - `REDIS_PASSWORD` (Redis)
  - `PLATFORM_ADMIN_PASSWORD` (initial admin)
- [ ] Know these values:
  - `PLATFORM_BASE_URL` (your domain, e.g., `https://shops.example.com`)
  - `SERVER_PUBLIC_IP` (Dockploy server's public IP)
  - `PLATFORM_ADMIN_EMAIL` (initial admin email)
- [ ] R2 credentials ready (if using Cloudflare for image uploads)

## Dockploy Setup (5 min)

### Create Application in Dockploy

- [ ] **New Application**
  - Name: `multitenant`
  - Repository: `https://github.com/Mahmoud-ctrl/MultiTenant.git`
  - Branch: `main`
  - Dockerfile: `./Dockerfile`

- [ ] **Configure Environment Variables**
  - Add all values from "Environment Variables Ready" section above
  - Verify sensitive values are masked in logs

- [ ] **Configure Reverse Proxy**
  - Domain: your domain (e.g., `shops.example.com`)
  - Target: `app:3000`
  - Enable HTTPS (auto via Let's Encrypt)
  - Security headers enabled

- [ ] **Set Up Services**
  - PostgreSQL 16
  - Redis 7
  - App service

## First Deployment (10 min)

- [ ] **Click Deploy** in Dockploy dashboard
  - Docker builds image (~3-5 mins)
  - Containers start: postgres → redis → app
  - Watch logs for errors

- [ ] **Verify Containers Running**
  ```bash
  docker ps | grep multitenant
  # Should see: multitenant-db, multitenant-redis, multitenant-app (all running)
  ```

- [ ] **Database Migrations**
  ```bash
  docker logs multitenant-app | grep -i migration
  # Should see: "✓ Migration applied" or similar
  ```

- [ ] **Refresh the restricted database role**
  ```bash
  # Grants the RLS-bound app_user access to tables added by new migrations
  # (AnalyticsConsentReceipt in this release). Safe to re-run.
  psql -d <database> -v app_pw="<APP_PASSWORD>" -f scripts/sql/rls-role.sql
  ```
  Without this, consent decisions cannot be recorded in an RLS-enforced environment.

- [ ] **Verify the restricted role is real in production**

  Row-Level Security only bites for a role that is neither superuser nor BYPASSRLS. If
  `APP_DATABASE_URL` names a role that does not exist, or the app falls back to the owner,
  every RLS policy is inert and nothing says so. Run all five inside the database container:

  ```bash
  # 1. The role exists and is restricted — expect rolsuper=f, rolbypassrls=f, rolcanlogin=t
  docker exec -it multitenant-postgres psql -U postgres -d multitenant -c     "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname='app_user';"
  ```

  ```bash
  # 2. The app is actually connecting as it — expect app_user, not postgres
  docker exec -it multitenant-postgres psql -U postgres -d multitenant -c     "select usename, count(*) from pg_stat_activity where datname=current_database() group by 1;"
  ```

  ```bash
  # 3. Every tenant table has RLS enabled AND forced — expect zero rows back
  docker exec -it multitenant-postgres psql -U postgres -d multitenant -c     "select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname in ('Category','Product','ProductVariant','ProductImage','TenantContent','Order','OrderItem','DiscountCampaign','DiscountProduct','Coupon','CouponProduct','AnalyticsConsentReceipt') and not (relrowsecurity and relforcerowsecurity);"
  ```

  ```bash
  # 4. Fail-closed smoke test: as app_user with no tenant context, every count must be 0
  docker exec -it multitenant-postgres psql -U app_user -d multitenant -c     "select (select count(*) from \"Product\") products, (select count(*) from \"Order\") orders, (select count(*) from \"AnalyticsConsentReceipt\") receipts;"
  ```

  ```bash
  # 5. Connection headroom — compare max_connections against the app's pool size
  docker exec -it multitenant-postgres psql -U postgres -d multitenant -c     "show max_connections; select count(*) from pg_stat_activity where datname=current_database();"
  ```

  Step 4 is the one that catches a silently-disabled RLS: if it returns real counts, the app
  role is privileged and tenant isolation is resting on application code alone.

- [ ] **Verify consent before announcing anything**
  ```bash
  pnpm verify:consent   # 43 checks: cookie signing, RLS, contrast, tag gating, env
  ```
  Then load a storefront with DevTools open on the Network tab, filter for `google`, and
  reload: it must stay empty until Accept is clicked.

- [ ] **Seed Platform Admin**
  ```bash
  docker exec multitenant-app node dist/seed.mjs
  # Creates admin user from PLATFORM_ADMIN_* env vars
  ```

  **Not `pnpm db:seed`**, which is what this line said until Phase 7 and could never have run
  here: the runtime image has no pnpm and no tsx, and `prisma db seed` shells out to
  `tsx prisma/seed.ts`. The bundled entrypoint is built by `pnpm build:job` and held down by
  `pnpm verify:container-commands`.

- [ ] **Test App is Running**
  ```bash
  curl -I https://shops.example.com/login
  # Should return 200
  ```

## Verification (10 min)

### Functionality
- [ ] Login at `/login` with platform admin credentials
- [ ] Navigate to `/platform` (stores list)
- [ ] Create a test store
- [ ] Create a test product with variants
- [ ] Browse storefront at `/store/test-store`
- [ ] Add to cart and checkout (test order)
- [ ] View order in admin `/admin/orders`

### Security
- [ ] HTTPS working: `curl -I https://shops.example.com/login` → 200
- [ ] Certificate valid: check browser padlock
- [ ] HSTS header present: `curl -I https://shops.example.com | grep -i strict`
- [ ] Database only accessible internally (not exposed publicly)
- [ ] Redis only accessible internally (not exposed publicly)

### Verification Scripts

Run these **from a checkout**, not inside the container — they need the development toolchain
(pnpm, tsx, the TypeScript sources), none of which is in the runtime image. Point them at the
target with `DATABASE_URL`:

```bash
DATABASE_URL=<the deployment's URL> pnpm verify:isolation
```

```bash
DATABASE_URL=<the deployment's URL> pnpm verify:commerce
```

```bash
DATABASE_URL=<the deployment's URL> pnpm verify:permissions
```

Each of them **creates and deletes throwaway stores**, so prefer staging. Against production,
run them before the pilot store exists, and never during the pilot window — a suite's teardown
is not something to debug next to real orders.

`verify:isolation` additionally needs `APP_DATABASE_URL` to point at the restricted `app_user`
role; it refuses to run as a privileged role rather than reporting a green that means nothing.

- [ ] All three verification scripts pass

### Monitoring
- [ ] Health checks active in Dockploy dashboard
- [ ] App shows "healthy" status
- [ ] Database shows "healthy" status
- [ ] Redis shows "healthy" status
- [ ] Logs show no errors

## Optional: Demo Store (2 min)

Create a demo store with sample data for testing. A development command, run **from a checkout**
against the target — it is not in the runtime image, and a demo store on a production deployment
is a decision, not a step:

```bash
DATABASE_URL=<the deployment's URL> pnpm demo:seed
```

- [ ] "Demo Boutique" store created
- [ ] Sample products visible in admin
- [ ] Sample orders in orders list
- [ ] Storefront accessible at `/store/demo-boutique`

## DNS & Go-Live (5 min)

- [ ] Update DNS A-record to point to Dockploy server IP
- [ ] Wait for DNS propagation (5-10 mins typically)
- [ ] Verify DNS resolution:
  ```bash
  nslookup shops.example.com
  # Should resolve to Dockploy server IP
  ```

- [ ] Test domain access:
  ```bash
  curl -I https://shops.example.com/login
  # Should return 200 with valid certificate
  ```

- [ ] **🎉 Live!** App is now public at your domain

## Post-Launch Checklist (1st week)

### Daily
- [ ] Check app logs for errors: `docker logs -f multitenant-app`
- [ ] Verify all containers are "running" (not restarting)
- [ ] Spot-check storefront is loading
- [ ] No rate-limit false positives in logs

### Backups
- [ ] Configure automated backups in Dockploy (daily recommended)
- [ ] Test restore: restore latest backup to verify it works
- [ ] Document restore procedure

### Monitoring
- [ ] Set up external uptime monitoring (e.g., Uptime Robot)
- [ ] Configure alerts (email/Slack on failures)
- [ ] Monitor CPU/memory in Dockploy dashboard

### Documentation
- [ ] Save Dockploy access credentials securely
- [ ] Document emergency contacts and escalation
- [ ] Create runbook for common issues (see PRODUCTION.md Troubleshooting)

## Troubleshooting Quick Reference

| Problem | Quick Fix |
|---------|-----------|
| App won't start | `docker logs multitenant-app` — check env vars and DB ready |
| Can't login | Verify `PLATFORM_ADMIN_*` env vars match what you set |
| Database error | Restart: `docker restart multitenant-db` |
| Rate limiting too strict | Check `TRUSTED_PROXY_COUNT` (usually 1) |
| HTTPS not working | Wait 5-10 mins for cert, check Caddy logs |
| Migrations failed | Check logs, may need manual intervention |

## Key Files

- `Dockerfile` — Multi-stage build for production
- `docker-compose.yml` — Service definitions (for reference)
- `.dockerignore` — Clean Docker build
- `PRODUCTION.md` — Full deployment guide
- `CLAUDE.md` — Architecture reference
- `KNOWN_GAPS.md` — Known limitations

## Next: Ongoing Operations

After launch, refer to:
- **PRODUCTION.md → Monitoring** — Health checks and logs
- **PRODUCTION.md → Maintenance** — Weekly/monthly tasks
- **PRODUCTION.md → Scaling** — Adding more instances
- **KNOWN_GAPS.md** — Understand current limitations

---

**Total time: ~30 minutes from zero to live app** ✅
