# Store license setup

## Production environment

Set these on the app service as runtime environment variables in Dockploy:

| Variable | Value |
| --- | --- |
| `LICENSE_API_BASE_URL` | `https://rlcphqlmnacxhzrffhjg.supabase.co/functions/v1/license-api` |
| `LICENSE_PRODUCT_CODE` | `idevelopit-ecom-subscription` |
| `LICENSE_APPLICATION_VERSION` | `0.1.0` (update when releasing a new app version) |
| `LICENSE_PLATFORM` | `linux` |
| `LICENSE_API_TIMEOUT_MS` | `10000` |
| `LICENSE_ENCRYPTION_KEY` | Generate a Base64 32-byte key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` |
| `LICENSE_HEARTBEAT_SECRET` | Generate a separate random secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` |

Keep both generated secrets stable. Changing `LICENSE_ENCRYPTION_KEY` without re-encrypting the database makes saved keys and activation tokens unreadable.

The Docker image applies Prisma migrations before starting Next.js. After deployment, open a store in **Platform → Stores**, enter its license key in **Store license**, and activate it. The browser never receives the full key or activation token.

## Heartbeat schedule

Create a Dockploy scheduled task that sends this request every five minutes. The app only contacts the provider when a store's `check_after` time is due.

```sh
curl -fsS -X POST "https://YOUR-APP-HOST/api/internal/license-heartbeat" \
  -H "Authorization: Bearer $LICENSE_HEARTBEAT_SECRET"
```

The response reports counts only. A heartbeat rejection disables that store's public pages and checkout. Temporary provider/network failures are allowed only through the provider's `offline_grace_until`. Manual pause remains a separate platform-admin control. Stores without an assigned license remain available during rollout.
