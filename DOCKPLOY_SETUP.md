# Dockploy Deployment - Step by Step

Complete guide to deploy the multi-tenant platform on Dockploy from scratch.

---

## **Prerequisites**

Before starting, have these ready:

✅ Dockploy instance running (you mentioned you have this)
✅ Domain name registered (e.g., `shops.example.com`)
✅ GitHub account with access to the repo
✅ All code committed and pushed to `main` branch

---

## **Phase 1: Generate Required Values**

Generate these now — you'll need them in the Dockploy dashboard:

### 1.1: Generate AUTH_SECRET

```bash
openssl rand -base64 32
# Output: copy this value
```

**Example output:**
```
peo8EqIIDF5zz8Uc3GAG7vA5K6A+esUasBNjmiqqG1A=
```

### 1.2: Create Strong Passwords

Generate 3 strong passwords (use a password manager or `openssl rand -base64 16`):

1. **DB_PASSWORD** (PostgreSQL superuser `postgres`)
   - Example: `Tr0pic@lM@ng02024!`

2. **APP_DB_PASSWORD** (PostgreSQL restricted user `app_user`)
   - Example: `Sh@deTr33Frog2024!`

3. **REDIS_PASSWORD** (Redis authentication)
   - Example: `Cr1mson#Beagle2024!`

4. **PLATFORM_ADMIN_PASSWORD** (Initial platform admin)
   - Example: `AdminP@ssw0rd2024!`

### 1.3: Document These Values

**Save to a secure location (password manager):**
```
AUTH_SECRET=peo8EqIIDF5zz8Uc3GAG7vA5K6A+esUasBNjmiqqG1A=
DB_PASSWORD=Tr0pic@lM@ng02024!
APP_DB_PASSWORD=Sh@deTr33Frog2024!
REDIS_PASSWORD=Cr1mson#Beagle2024!
PLATFORM_ADMIN_PASSWORD=AdminP@ssw0rd2024!
PLATFORM_ADMIN_EMAIL=admin@yourdomain.com
PLATFORM_BASE_URL=https://shops.yourdomain.com
SERVER_PUBLIC_IP=YOUR.VPS.IP.ADDRESS
```

---

## **Phase 2: Create Dockploy Project**

### 2.1: Access Dockploy Dashboard

Go to your Dockploy instance dashboard.

### 2.2: Create New Project

**Menu → Projects → Create New Project**

Fill in:
- **Project Name:** `multitenant` (or your choice)
- **Description:** Multi-tenant e-commerce platform

**Click Create**

### 2.3: Add Repository

**Project → Settings → Repository**

- **Repository URL:** `https://github.com/Mahmoud-ctrl/MultiTenant.git`
- **Branch:** `main`
- **Authentication:** PAT (Personal Access Token) if private repo

**Save**

---

## **Phase 3: Create Services**

### 3.1: Add PostgreSQL Service

**Project → Services → Add Service**

**Basic Info:**
- **Name:** `postgres`
- **Image:** `postgres:16-alpine`

**Environment Variables:**
```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=DB_PASSWORD  (paste your generated password)
POSTGRES_DB=multitenant
```

**Ports:**
- **Container Port:** 5432
- **Expose:** NO (internal only, NOT publicly accessible)

**Volumes:**
- **Mount Path:** `/var/lib/postgresql/data`
- **Volume Name:** `postgres_data`

**Health Check:**
- **Command:** `pg_isready -U postgres`
- **Interval:** 10s
- **Timeout:** 5s
- **Retries:** 5

**Save & Continue**

### 3.2: Add Redis Service

**Project → Services → Add Service**

**Basic Info:**
- **Name:** `redis`
- **Image:** `redis:7-alpine`

**Command:**
```
redis-server --requirepass REDIS_PASSWORD
```
(Replace `REDIS_PASSWORD` with your generated password)

**Ports:**
- **Container Port:** 6379
- **Expose:** NO (internal only)

**Volumes:**
- **Mount Path:** `/data`
- **Volume Name:** `redis_data`

**Health Check:**
- **Command:** `redis-cli ping`
- **Interval:** 10s
- **Timeout:** 5s
- **Retries:** 5

**Save & Continue**

### 3.3: Add Next.js App Service

**Project → Services → Add Service**

**Basic Info:**
- **Name:** `app`
- **Build Type:** Docker
- **Dockerfile Path:** `./Dockerfile`
- **Build Context:** `/`

**Ports:**
- **Container Port:** 3000
- **Expose:** YES (publicly accessible via reverse proxy)

**Environment Variables:**

Copy all these and replace the placeholders:

```
NODE_ENV=production
DATABASE_URL=postgresql://postgres:DB_PASSWORD@postgres:5432/multitenant
APP_DATABASE_URL=postgresql://app_user:APP_DB_PASSWORD@postgres:5432/multitenant
AUTH_SECRET=AUTH_SECRET_VALUE
PLATFORM_BASE_URL=https://shops.yourdomain.com
SERVER_PUBLIC_IP=YOUR.VPS.IP.ADDRESS
TRUSTED_PROXY_COUNT=1
REDIS_URL=redis://:REDIS_PASSWORD@redis:6379
PLATFORM_ADMIN_EMAIL=admin@yourdomain.com
PLATFORM_ADMIN_PASSWORD=PLATFORM_ADMIN_PASSWORD
```

**R2 (Optional - skip if not using Cloudflare):**
```
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_URL=https://your-r2-url.r2.dev
```


**Storefront analytics, consent and privacy (Phase 1–5 — the first three are REQUIRED in
production; `lib/env.ts` refuses to boot without them):**
```
ANALYTICS_SIGNING_SECRET=<openssl rand -base64 32>
PLATFORM_PRIVACY_NAME=Your Company
PLATFORM_PRIVACY_EMAIL=privacy@yourdomain.com
PLATFORM_PRIVACY_URL=https://yourdomain.com/privacy
ANALYTICS_SIGNING_KEY_VERSION=1
ANALYTICS_ROLLOUT_MODE=off
PLATFORM_DEFAULT_LOCALE=en
PLATFORM_TIMEZONE=Asia/Beirut
```
Everything else analytics has a working default and only needs setting to override it:
`ANALYTICS_PILOT_TENANT_SLUG` (with `ANALYTICS_ROLLOUT_MODE=pilot` only — the app refuses to
boot with the mode and no slug), `ANALYTICS_DATABASE_POOL_MAX`,
`ANALYTICS_JOB_DATABASE_POOL_MAX`, `ANALYTICS_MAX_BATCH_SIZE`, `ANALYTICS_MAX_IN_FLIGHT`,
`ANALYTICS_INGESTION_FAILURE_PERCENT`, `ANALYTICS_INGESTION_MIN_BATCHES`,
`ANALYTICS_CONTRACT_REJECTION_ALERT`, `ANALYTICS_HEALTH_FLUSH_MINUTES`,
`ANALYTICS_RAW_RETENTION_DAYS`, `ANALYTICS_VISITOR_RETENTION_MONTHS`,
`ANALYTICS_AGGREGATE_RETENTION_MONTHS`, `ANALYTICS_RECEIPT_RETENTION_MONTHS`,
`ANALYTICS_SESSION_TIMEOUT_MINUTES`, `ANALYTICS_ACTIVE_WINDOW_MINUTES`, `PLATFORM_GA_ID`,
`ORDER_PENDING_TTL_HOURS`.

**Admin push (Phase 6 — optional, but all four together or none):**
```
PUSH_VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>
PUSH_VAPID_PRIVATE_KEY=<the private half; NEVER rotated, see D77>
PUSH_VAPID_SUBJECT=mailto:you@yourdomain.com
PUSH_ENCRYPTION_KEY=<openssl rand -base64 32>
PUSH_TIMEOUT_MS=2500
```
These four names are the ones `lib/env.ts` reads. They are optional by design, so a misspelling
gives you a working app with push silently off and no error anywhere — which is exactly what
D78 was written about.

**Licensing (Phase 4 — the last two are REQUIRED in production):**
```
LICENSE_ENCRYPTION_KEY=<base64 32 bytes>
LICENSE_HEARTBEAT_SECRET=<32+ chars>
```
`LICENSE_API_BASE_URL`, `LICENSE_PRODUCT_CODE`, `LICENSE_APPLICATION_VERSION`,
`LICENSE_PLATFORM` and `LICENSE_API_TIMEOUT_MS` all have defaults — see `LICENSE_SETUP.md`.

**The edge (Phase 7 — all optional; defaults are the pre-Phase-7 behaviour):**
```
EDGE_TRUST_MODE=off
EDGE_FORCE_HTTPS=false
EDGE_HSTS_MAX_AGE=0
```
Plus `EDGE_SHARED_SECRET` once `EDGE_TRUST_MODE=cloudflare`. Turn these on in the order in
`EDGE_HARDENING.md`, after the deploy is healthy — not with it.

**Dependencies:**
- Add `postgres` (wait for PostgreSQL to be healthy)
- Add `redis` (wait for Redis to be healthy)

**Health Check:**
- **Command:** `wget --quiet --tries=1 --spider http://localhost:3000/login`
- **Interval:** 30s
- **Timeout:** 10s
- **Retries:** 3
- **Start Period:** 40s

**Restart Policy:** `unless-stopped`

**Save & Continue**

---

## **Phase 4: Configure Reverse Proxy**

### 4.1: Add Domain & HTTPS

**Project → Reverse Proxy → Add Route**

**Basic Info:**
- **Domain:** `shops.yourdomain.com` (your actual domain)
- **Target Service:** `app:3000` (the Next.js app)

**SSL/TLS:**
- **Enable HTTPS:** YES (auto-provision with Let's Encrypt)
- **Email for Let's Encrypt:** your-email@yourdomain.com

**Security Headers:**
Enable these automatically (or add manually):
```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: no-referrer-when-downgrade
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

**Save**

### 4.2: Configure DNS

**In your domain registrar (GoDaddy, Namecheap, etc.):**

Create an **A record:**
- **Host:** `shops` (or leave blank for apex domain)
- **Type:** A
- **Value:** Your Dockploy server's public IP
- **TTL:** 3600

Wait 5-15 minutes for DNS propagation.

**Verify DNS:**
```bash
nslookup shops.yourdomain.com
# Should resolve to your Dockploy server IP
```

---

## **Phase 5: First Deployment**

### 5.1: Build & Deploy

**Project → Overview → Deploy**

Dockploy will:
1. Pull latest code from GitHub `main` branch
2. Build Docker image from `Dockerfile` (~5-10 minutes)
3. Start PostgreSQL, wait for health check
4. Start Redis, wait for health check
5. Start Next.js app, run health checks

**Watch the logs:**
- Click each service to see real-time logs
- Look for `✓ Ready` or similar success messages

### 5.2: Run Database Setup

Once app is healthy, run setup commands:

**In Dockploy's terminal or container shell:**

```bash
# Run migrations
docker exec multitenant-app pnpm db:migrate

# Seed platform admin
docker exec multitenant-app pnpm db:seed

# (Optional) Create demo store
docker exec multitenant-app pnpm demo:seed
```

**Or through Dockploy UI:**
- **Project → Services → app → Terminal**
- Run the above commands

---

## **Phase 6: Verify Deployment**

### 6.1: Check Services Health

**In Dockploy Dashboard:**
- `postgres` → Status should be ✅ Running
- `redis` → Status should be ✅ Running
- `app` → Status should be ✅ Running

### 6.2: Test HTTPS

```bash
curl -I https://shops.yourdomain.com/login
# Should return: HTTP/1.1 200 OK
# With valid SSL certificate
```

### 6.3: Access the App

**In your browser:**
- Go to: `https://shops.yourdomain.com/login`
- Email: `admin@yourdomain.com` (from `PLATFORM_ADMIN_EMAIL`)
- Password: Your `PLATFORM_ADMIN_PASSWORD`

**Should see:**
- ✅ Login page loads
- ✅ Login successful → Platform admin dashboard
- ✅ Can navigate to `/platform`
- ✅ Can create stores

### 6.4: Test Core Features

1. **Create a store** from platform admin
2. **Login as store owner** (if created test owner)
3. **Browse storefront** at `/store/[slug]`
4. **Add product** to cart
5. **Complete checkout** (test order)

### 6.5: Check Logs

**For any errors:**
- **Project → Services → app → Logs**
- Look for errors containing "error", "Error", "failed"
- Common issues documented in PRODUCTION.md Troubleshooting

---

## **Phase 7: Go Live!**

Once everything is verified:

### 7.1: Enable GitHub Auto-Deploy (Optional)

**Project → Repository → Webhooks**
- Enable: Push to `main` branch automatically deploys
- Future updates: just push to main, Dockploy rebuilds

### 7.2: Configure Backups

**Project → Services → postgres → Backups**
- **Schedule:** Daily at 2 AM UTC
- **Retention:** 30 days

### 7.3: Set Up Monitoring (Optional)

- **External Uptime Monitoring:** Uptime Robot, Pingdom
- **Alert on Container Restart:** Check Dockploy alerts
- **Log Aggregation:** View logs in Dockploy or export to external service

### 7.4: Document Everything

Save to your password manager / docs:
```
Project: Multitenant E-Commerce
Live URL: https://shops.yourdomain.com
Admin Console: https://shops.yourdomain.com/platform
Dockploy Dashboard: https://your-dockploy-url/projects/multitenant
Admin Email: admin@yourdomain.com
Database: multitenant (PostgreSQL 16)
Cache: Redis 7
Backups: Daily
```

---

## **Common Issues & Fixes**

| Issue | Cause | Fix |
|-------|-------|-----|
| Can't resolve domain | DNS not propagated | Wait 15 mins, verify with `nslookup` |
| App returns 500 error | Missing env var | Check all env vars are set, restart app |
| `ECONNREFUSED` in logs | Service not ready | Wait for health checks, check logs |
| Certificate not provisioning | HTTP port blocked | Ensure port 80 is open to Let's Encrypt |
| Login fails | Wrong password | Run `docker exec ... pnpm db:seed` again |
| Migrations won't run | App not healthy | Check logs, restart container |

---

## **What's Next After Launch**

- [ ] Create your first real store
- [ ] Upload products and images
- [ ] Test complete order flow
- [ ] Set up Google Analytics / Meta Pixel
- [ ] Add custom domain for store (if different from platform)
- [ ] Schedule regular backups
- [ ] Monitor performance metrics

---

## **Quick Reference: All Environment Variables**

```
NODE_ENV=production
DATABASE_URL=postgresql://postgres:PASSWORD@postgres:5432/multitenant
APP_DATABASE_URL=postgresql://app_user:PASSWORD@postgres:5432/multitenant
AUTH_SECRET=<32+ char random string>
PLATFORM_BASE_URL=https://shops.yourdomain.com
SERVER_PUBLIC_IP=x.x.x.x
TRUSTED_PROXY_COUNT=1
REDIS_URL=redis://:PASSWORD@redis:6379
PLATFORM_ADMIN_EMAIL=admin@yourdomain.com
PLATFORM_ADMIN_PASSWORD=<strong password>
R2_ACCOUNT_ID=<required in production>
R2_ACCESS_KEY_ID=<required in production>
R2_SECRET_ACCESS_KEY=<required in production>
R2_BUCKET=<required in production>
R2_PUBLIC_URL=<required in production>
ANALYTICS_SIGNING_SECRET=<required in production>
PLATFORM_PRIVACY_NAME=<required in production>
PLATFORM_PRIVACY_EMAIL=<required in production>
PLATFORM_PRIVACY_URL=<optional>
LICENSE_ENCRYPTION_KEY=<required in production>
LICENSE_HEARTBEAT_SECRET=<required in production>
ANALYTICS_SIGNING_KEY_VERSION=1
ANALYTICS_ROLLOUT_MODE=off
ANALYTICS_PILOT_TENANT_SLUG=<only with ANALYTICS_ROLLOUT_MODE=pilot>
PLATFORM_DEFAULT_LOCALE=en
PLATFORM_TIMEZONE=Asia/Beirut
PLATFORM_GA_ID=<optional>
ORDER_PENDING_TTL_HOURS=24
ANALYTICS_DATABASE_POOL_MAX=5
ANALYTICS_JOB_DATABASE_POOL_MAX=2
ANALYTICS_MAX_BATCH_SIZE=20
ANALYTICS_MAX_IN_FLIGHT=<optional>
ANALYTICS_INGESTION_FAILURE_PERCENT=5
ANALYTICS_INGESTION_MIN_BATCHES=20
ANALYTICS_CONTRACT_REJECTION_ALERT=5
ANALYTICS_HEALTH_FLUSH_MINUTES=5
ANALYTICS_RAW_RETENTION_DAYS=90
ANALYTICS_VISITOR_RETENTION_MONTHS=13
ANALYTICS_AGGREGATE_RETENTION_MONTHS=24
ANALYTICS_RECEIPT_RETENTION_MONTHS=24
ANALYTICS_SESSION_TIMEOUT_MINUTES=30
ANALYTICS_ACTIVE_WINDOW_MINUTES=5
PUSH_VAPID_PUBLIC_KEY=<optional, all four together>
PUSH_VAPID_PRIVATE_KEY=<optional, NEVER rotated>
PUSH_VAPID_SUBJECT=mailto:you@yourdomain.com
PUSH_ENCRYPTION_KEY=<optional, required once push is on>
PUSH_TIMEOUT_MS=2500
LICENSE_API_BASE_URL=<has a default>
LICENSE_PRODUCT_CODE=<has a default>
LICENSE_APPLICATION_VERSION=<has a default>
LICENSE_PLATFORM=linux
LICENSE_API_TIMEOUT_MS=10000
EDGE_TRUST_MODE=off
EDGE_SHARED_SECRET=<only with EDGE_TRUST_MODE=cloudflare>
EDGE_FORCE_HTTPS=false
EDGE_HSTS_MAX_AGE=0
```

This list is every variable `lib/env.ts` reads, and `pnpm verify:config` fails if it ever stops
being — it compares this section against the code and against `.env.example`. It was 8 of 49
until Phase 7 commit 9, which would have left a fresh deploy refusing to boot on
`ANALYTICS_SIGNING_SECRET` with no hint of why.

**This is the production path, not `docker-compose.yml`.** The app is deployed from the
Dockerfile with its environment set in Dockploy's UI; the compose file is reference only (and
also complete now, for `docker compose up` and for the load test, where `environment:` is a
whitelist and a variable not listed there never reaches the container).

---

## **Files You Need**

All these are already in the repo, Dockploy uses them automatically:

- ✅ `Dockerfile` — Production build instructions
- ✅ `docker-compose.yml` — Service definitions (reference only)
- ✅ `.dockerignore` — What to exclude from image
- ✅ `prisma/schema.prisma` — Database schema
- ✅ `prisma/migrations/` — All database migrations

---

**Questions?** Refer to `PRODUCTION.md` or `DEPLOYMENT_CHECKLIST.md`

**Ready?** Start with Phase 1! 🚀
