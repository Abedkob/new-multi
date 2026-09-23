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
TRUSTED_PROXY_COUNT="1"

# Redis
REDIS_PASSWORD="STRONG_REDIS_PASSWORD"

# Platform Admin (created on first run)
PLATFORM_ADMIN_EMAIL="admin@example.com"
PLATFORM_ADMIN_PASSWORD="STRONG_ADMIN_PASSWORD"

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

3. **Database Connection Pooling** (already handled):
   - PostgreSQL: `max: 30` per instance
   - At 3 instances: 90 max connections (within Postgres limit of 100)
   - For >3 instances, add PgBouncer or increase Postgres `max_connections`

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
