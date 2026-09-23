# Dockploy Deployment Checklist

**Status:** Ready for Dockploy deployment
**Last Updated:** 2026-09-23

Fast-track checklist for deploying to Dockploy.

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

- [ ] **Seed Platform Admin**
  ```bash
  docker exec multitenant-app pnpm db:seed
  # Creates admin user from PLATFORM_ADMIN_* env vars
  ```

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
```bash
# SSH into Dockploy server and run:
docker exec multitenant-app pnpm verify:isolation
docker exec multitenant-app pnpm verify:commerce
docker exec multitenant-app pnpm verify:permissions
```

- [ ] All three verification scripts pass

### Monitoring
- [ ] Health checks active in Dockploy dashboard
- [ ] App shows "healthy" status
- [ ] Database shows "healthy" status
- [ ] Redis shows "healthy" status
- [ ] Logs show no errors

## Optional: Demo Store (2 min)

Create a demo store with sample data for testing:

```bash
docker exec multitenant-app pnpm demo:seed
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
