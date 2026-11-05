# Production Deployment with Dockploy

This guide covers deploying the multi-tenant platform to production using Dockploy.

## Prerequisites

- Dockploy instance already set up and running
- Domain name registered (e.g., `shops.example.com`)
- A-record pointing to your Dockploy server's IP
- Docker and Docker Compose installed on the Dockploy server

## Environment Setup

### 1. Prepare Environment Variables

Create a `.env.production` file (or set via Dockploy dashboard) with these values:

```env
# Database
DB_PASSWORD="STRONG_PASSWORD_HERE"
APP_DB_PASSWORD="APP_USER_PASSWORD_HERE"

# Authentication
AUTH_SECRET="$(openssl rand -base64 32)"

# Platform Configuration
PLATFORM_BASE_URL="https://shops.example.com"
SERVER_PUBLIC_IP="YOUR_SERVER_PUBLIC_IP"
# 1 = one reverse proxy of your own; 2 = Cloudflare -> that proxy. See EDGE_HARDENING.md §5.
TRUSTED_PROXY_COUNT="1"

# The edge (Phase 7). Defaults below are the pre-Phase-7 behaviour: proxy metadata such as
# cf-ipcountry is believed, which is only safe while nothing can reach this origin directly.
# EDGE_HARDENING.md is the runbook, in the order these are turned on, with the break-glass path.
EDGE_TRUST_MODE="off"            # "cloudflare" once the Transform Rule below exists
# EDGE_SHARED_SECRET=""          # openssl rand -hex 32; same value in Cloudflare's Transform
                                 # Rule (header x-edge-token). Required by "cloudflare" mode.
EDGE_FORCE_HTTPS="false"         # "true" once the edge terminates TLS
EDGE_HSTS_MAX_AGE="0"            # by hand, LAST, after a week of pilot traffic (D74)

# Redis
REDIS_PASSWORD="STRONG_REDIS_PASSWORD"

# Platform Admin (created on first run)
PLATFORM_ADMIN_EMAIL="admin@example.com"
PLATFORM_ADMIN_PASSWORD="STRONG_ADMIN_PASSWORD"

# Storefront analytics and consent (required in production)
# ANALYTICS_SIGNING_SECRET signs each store's consent cookie. Generate a fresh one:
#   openssl rand -base64 32
# PLATFORM_PRIVACY_NAME/EMAIL identify the platform as a joint controller on every
# store's privacy page; the app refuses to start in production without them.
ANALYTICS_SIGNING_SECRET="GENERATE_A_32_CHAR_SECRET"
ANALYTICS_SIGNING_KEY_VERSION="1"
PLATFORM_PRIVACY_NAME="Your Company"
PLATFORM_PRIVACY_EMAIL="privacy@example.com"
PLATFORM_PRIVACY_URL="https://example.com/privacy"
PLATFORM_DEFAULT_LOCALE="en"
PLATFORM_TIMEZONE="Asia/Beirut"
# off | pilot | all. Gates first-party COLLECTION only: the consent notice and the
# gating of per-store GA/Ads/Meta tags apply to every store regardless.
ANALYTICS_ROLLOUT_MODE="off"
ANALYTICS_PILOT_TENANT_SLUG=""
# The platform's own GA4 property, loaded on admin/platform/login only - never a storefront.
PLATFORM_GA_ID=""

# Cloudflare R2 (optional for production image uploads)
# R2_ACCOUNT_ID="your-32-char-account-id"
# R2_ACCESS_KEY_ID="..."
# R2_SECRET_ACCESS_KEY="..."
# R2_BUCKET="shop-uploads"
# R2_PUBLIC_URL="https://pub-xxxxxxxx.r2.dev"
```

### 2. Create Dockploy Application

In Dockploy Dashboard:

1. **Create New Application**
   - Name: `multitenant`
   - Repository: `https://github.com/Mahmoud-ctrl/MultiTenant.git`
   - Branch: `main`
   - Dockerfile path: `./Dockerfile`

2. **Configure Services**
   - **App Service**
     - Image: `multitenant:latest`
     - Ports: `3000:3000`
     - Restart policy: `unless-stopped`
   - **Database** (PostgreSQL)
     - Image: `postgres:16-alpine`
     - Port: `5432:5432` (internal only, not exposed)
   - **Cache** (Redis)
     - Image: `redis:7-alpine`
     - Port: `6379:6379` (internal only, not exposed)

3. **Set Environment Variables**
   - Copy all values from `.env.production` above
   - Ensure sensitive values (passwords, secrets) are not logged

4. **Configure Reverse Proxy** (Caddy/Nginx)
   - Domain: `shops.example.com`
   - Target: `app:3000`
   - Enable HTTPS/TLS (auto-provisioning via Let's Encrypt)
   - Add security headers:
     ```
     X-Content-Type-Options: nosniff
     X-Frame-Options: SAMEORIGIN
     Referrer-Policy: no-referrer-when-downgrade
     Strict-Transport-Security: max-age=31536000; includeSubDomains
     ```

### Rotating the consent signing secret

Changing `ANALYTICS_SIGNING_SECRET` invalidates every stored consent decision: visitors are
asked again rather than the platform honouring a grant it can no longer verify. Bump
`ANALYTICS_SIGNING_KEY_VERSION` alongside it so the change is recorded.

## Deployment Process

### First Deployment

1. **Deploy via Dockploy Dashboard**
   - Click "Deploy" → selects latest commit from `main`
   - Docker builds image (~3-5 mins, depends on network)
   - Containers start: postgres → redis → app

2. **Database Migrations**
   - Dockploy automatically runs migrations on first start
   - Check logs: `docker logs multitenant-app`
   - Verify RLS policies applied: see `scripts/sql/rls-role.sql`

3. **Seed Platform Admin**
   - After app is healthy, run:
   ```bash
   docker exec multitenant-app pnpm db:seed
   ```
   - Admin account created from `PLATFORM_ADMIN_*` env vars

4. **Optional: Create Demo Store**
   ```bash
   docker exec multitenant-app pnpm demo:seed
   ```
   - Test store "Demo Boutique" with sample products

### Subsequent Deployments

```bash
# Dockploy automatically handles:
# 1. Pulls latest code from main branch
# 2. Rebuilds Docker image
# 3. Runs migrations
# 4. Restarts app container with zero downtime (via health checks)
```

Trigger via:
- Dockploy Dashboard (manual redeploy button)
- GitHub webhook (auto-deploy on push to main)
- CLI: `dockploy deploy multitenant`

## Monitoring

### View Logs

```bash
# App logs
docker logs -f multitenant-app

# Database logs
docker logs -f multitenant-db

# Redis logs
docker logs -f multitenant-redis
```

### Health Checks

Dockploy monitors container health via endpoints:
- **App:** `GET /login` (200 = healthy)
- **PostgreSQL:** SQL connection check
- **Redis:** PING command

Auto-restarts container if unhealthy.

### Performance Metrics

Monitor in Dockploy dashboard:
- CPU/Memory usage
- Network I/O
- Container uptime
- Restart count

## Database Backups

### Automatic Backups (Recommended)

Configure in Dockploy:
1. Go to Application → Backups
2. Set schedule (e.g., daily at 2 AM UTC)
3. Retention policy (e.g., keep last 30 days)

### Manual Backup

```bash
docker exec multitenant-db pg_dump -U postgres multitenant | gzip > backup-$(date +%Y%m%d_%H%M%S).sql.gz
```

### Restore from Backup

```bash
# Stop app
docker stop multitenant-app

# Restore database
gunzip < backup-2026-09-23_020000.sql.gz | docker exec -i multitenant-db psql -U postgres multitenant

# Restart app
docker start multitenant-app
```

## Scaling Considerations

### Single Instance (Current)
- Handles ~300 concurrent users
- PostgreSQL connection pool: `max: 30`
- Redis for distributed rate limiting (ready for multi-instance)

### Multi-Instance (Future)

To run multiple app instances behind a load balancer:

1. **Update Docker Compose** (in Dockploy):
   ```yaml
   app:
     deploy:
       replicas: 3  # Run 3 instances
   ```

2. **Configure Load Balancer** in Dockploy:
   - Round-robin to all app instances
   - Health checks on each

3. **Database Connection Pooling**:
   - Application pool: `max: 30` per instance (`lib/prisma.ts`)
   - Analytics ingestion pool: `max: 5` per instance, deliberately small so analytics can never
     starve checkout — **35 per instance in total**
   - `postgres:16-alpine` ships `max_connections = 100` with 3 reserved for superusers, so
     **97 are usable**. Budget roughly 4 more for the scheduled command, migrations on deploy
     and an operator's psql session:

     | App instances | Peak app connections | With overhead | Verdict |
     |---|---|---|---|
     | 1 | 35 | ~39 / 97 | comfortable |
     | 2 | 70 | ~74 / 97 | tight but workable |
     | 3 | 105 | ~109 / 97 | **exceeds the limit** |

   - **For more than 2 instances, add PgBouncer or raise `max_connections`.** (This was ">3"
     before the ingestion pool existed; 3 instances no longer fit.)
   - **The scheduled analytics command must open only its own jobs pool (`max: 2`).** If its
     entry point imports `lib/prisma`, it opens a second 30-connection pool and the arithmetic
     above stops holding. Keep that process on `lib/prisma-analytics.ts` alone.

4. **Rate Limiting** (already distributed):
   - Redis handles shared rate limits across instances
   - No additional config needed

## Troubleshooting

| Issue | Fix |
|-------|-----|
| App won't start (crashloop) | Check logs: `docker logs multitenant-app`. Common: missing env vars, DB not ready. Restart: `docker restart multitenant-app` |
| Database connection errors | Verify `DATABASE_URL` and `APP_DATABASE_URL` match container names. Restart PostgreSQL: `docker restart multitenant-db` |
| RLS policies not enforced | Verify `APP_DATABASE_URL` is set (not empty). Check `SELECT * FROM pg_policies;` in database. |
| Redis connection refused | Verify `REDIS_URL` password matches `REDIS_PASSWORD` env var. Restart Redis: `docker restart multitenant-redis` |
| Migrations stuck | Check if migrations lock file exists. Clear: `docker exec multitenant-db rm /var/lib/postgresql/data/.migration_lock` (if present). Retry: `docker exec multitenant-app pnpm db:migrate` |
| HTTPS certificate not provisioning | Ensure A-record points to Dockploy server. Check Caddy logs. Wait 5-10 mins for Let's Encrypt propagation. |
| Rate limiting too aggressive | Check `TRUSTED_PROXY_COUNT` is correct (1 = direct, 2 = Cloudflare + proxy). Adjust in env vars. |

## Security Checklist

- [ ] All passwords are strong (32+ chars, random, no reuse)
- [ ] `AUTH_SECRET` is a cryptographically random 32+ character string
- [ ] Database exposed only to app container (no public port)
- [ ] Redis exposed only to app container (no public port)
- [ ] HTTPS/TLS enabled and auto-renewing
- [ ] `APP_DATABASE_URL` is set (RLS enforced, not using superuser)
- [ ] Environment variables not logged in Dockploy output
- [ ] Regular backups are tested and restorable
- [ ] Firewall allows only 80 (HTTP, for ACME) and 443 (HTTPS)

## Maintenance

### Weekly
- Review app logs for errors
- Verify backups completed
- Spot-check a customer storefront

### Monthly
- Update base images: `docker pull postgres:16-alpine`, `docker pull redis:7-alpine`, `docker pull node:22-alpine`
- Review rate limit effectiveness (adjust thresholds if needed)
- Test backup restore to ensure recovery works

### Quarterly
- Review security policies (passwords, SSH keys, access)
- Audit RLS policies: `SELECT * FROM pg_policies;`
- Performance review (monitor connection pool, response times)

## Rollback

If a deployment breaks production:

1. **Stop broken deployment**
   ```bash
   docker stop multitenant-app
   ```

2. **Revert to previous image**
   - In Dockploy: select previous build/tag
   - Click "Deploy"

3. **Run migrations backward** (if schema changed)
   ```bash
   docker exec multitenant-app pnpm db:migrate resolve  # Last resort; usually migrations are forward-only
   ```

4. **Verify health**
   - App starts and passes health checks
   - Spot-check functionality

## Performance Optimization

### Database
- Connection pool is at `max: 30` (safe for single-instance)
- For >3 instances, add PgBouncer between app and PostgreSQL

### Redis
- Memory limit set to `512mb` with `maxmemory-policy allkeys-lru`
- Persistence enabled (RDB snapshot + AOF)
- Adequate for rate limiting + domain cache

### App
- Multi-stage Docker build (dev deps not in final image)
- Health checks with 40s startup grace period
- Graceful shutdown on SIGTERM

## Next Steps After Launch

1. **Set up external monitoring:** Uptime Robot, Datadog, New Relic
2. **Configure alerting:** Slack/email on container restart, failed health checks
3. **Document runbook:** Access procedures, escalation contacts
4. **Plan auto-scaling:** Monitor CPU/memory, adjust replica count as traffic grows
5. **Schedule security audits:** Monthly review of logs, access patterns

---

**Questions?**
- Refer to `CLAUDE.md` for architecture and code structure
- Check `KNOWN_GAPS.md` for known limitations
- See `README.md` for feature overview
- Dockploy docs: [https://dockploy.dev](https://dockploy.dev)
