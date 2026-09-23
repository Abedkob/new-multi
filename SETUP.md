# Local setup

Follow these steps in order to get the project running on your machine. You'll need about 10 minutes.

## 1. Install the prerequisites

| Tool | Version | Check with |
| --- | --- | --- |
| Node.js | 22 or newer | `node -v` |
| pnpm | 10 or newer | `pnpm -v` (install: `npm install -g pnpm`) |
| PostgreSQL | 15 or newer | `psql --version` (or use Docker, see below) |
| Git | any | `git --version` |
| Google Chrome | optional | only needed for the `pnpm e2e:*` browser tests |

Use **pnpm** only. Don't use npm or yarn: the lockfile is `pnpm-lock.yaml`.

### No PostgreSQL installed? Use Docker

```bash
docker run --name multitenant-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=multitenant -p 5432:5432 -d postgres:16
```

With this container your connection string is:

```
postgresql://postgres:postgres@localhost:5432/multitenant
```

Later, start it again with `docker start multitenant-db`.

### Using a local PostgreSQL install

Create an empty database:

```bash
psql -U postgres -c "CREATE DATABASE multitenant;"
```

## 2. Clone the repo

```bash
git clone https://github.com/Mahmoud-ctrl/MultiTenant.git
cd MultiTenant
```

## 3. Create your `.env` file

**Do this before `pnpm install`.** The install step runs `prisma generate`, and that step fails without a `.env` file.

```bash
cp .env.example .env          # macOS / Linux / Git Bash
copy .env.example .env        # Windows cmd
```

Open `.env` and set these values:

```dotenv
# Your local database (the Docker one above, or your own)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/multitenant"

# Leave this EMPTY for local development (see "Row-Level Security" below)
APP_DATABASE_URL=""

# Any random string of 32+ characters. Generate one with:  npx auth secret
#   or:  openssl rand -base64 32
AUTH_SECRET="paste-your-generated-secret-here"

# The login you'll use for the platform admin panel
PLATFORM_ADMIN_EMAIL="you@example.com"
PLATFORM_ADMIN_PASSWORD="at-least-8-characters"

# Local origin
PLATFORM_BASE_URL="http://localhost:3000"
```

Everything else in `.env` can stay as it is or be left empty for local development:

- **`SERVER_PUBLIC_IP` and `TRUSTED_PROXY_COUNT`** only matter in production.
- **`R2_*`** controls image uploads. Leave all five commented out. Uploads will then go to `public/uploads/`, which git ignores.

> ⚠️ `.env` contains secrets. Git ignores it already, so never commit it.

## 4. Install, migrate, seed

```bash
pnpm install        # installs packages and generates the Prisma client
pnpm db:migrate     # creates all tables in your database
pnpm db:seed        # creates the platform admin from PLATFORM_ADMIN_* in .env
pnpm demo:seed      # optional but recommended: a full "Demo Boutique" store with products
```

`pnpm demo:seed` prints a **one-time password** for the demo store owner (`demo-owner@example.test`). Copy it from the terminal, because it's only shown the first time.

## 5. Run it

```bash
pnpm dev
```

Open these URLs:

| URL | What it is | Log in as |
| --- | --- | --- |
| http://localhost:3000/login | Login page | – |
| http://localhost:3000/platform | Platform admin: create stores, pick templates and colors | `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` |
| http://localhost:3000/admin | Store owner panel: products, content, orders | `demo-owner@example.test` + the one-time password (you'll be asked to change it) |
| http://localhost:3000/store/demo-boutique | Public storefront of the demo store | no login |

To try a different storefront template, log in as the platform admin and go to **Stores → Demo Boutique → Theme**.

## 6. Check that everything works (optional)

```bash
pnpm typecheck
pnpm lint
pnpm verify:isolation      # tenant isolation checks, no server needed
pnpm verify:templates      # needs `pnpm dev` running in another terminal + demo:seed
```

## Day-to-day: after pulling new changes

```bash
git pull
pnpm install        # if package.json / pnpm-lock.yaml changed
pnpm db:migrate     # if anything under prisma/migrations changed
```

Then **restart `pnpm dev`**. A running dev server keeps the old Prisma client and throws errors like
`Cannot read properties of undefined (reading 'create')` until you restart it.

If you change `prisma/schema.prisma` yourself, run `pnpm db:migrate`. It creates a new migration; give it a short name and commit the new folder under `prisma/migrations/`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `pnpm install` fails on `prisma generate` / "Environment variable not found: DATABASE_URL" | You don't have a `.env` file yet. Do step 3, then run `pnpm install` again. |
| "Invalid environment variables" when starting | The message names the variable that's wrong. Compare your `.env` with the one in step 3. `AUTH_SECRET` must be at least 16 characters. |
| `password authentication failed for user "app_user"` | `APP_DATABASE_URL` still has the placeholder from `.env.example`. Set it to `""` (see step 3). |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL isn't running. Start it, or run `docker start multitenant-db`. |
| `database "multitenant" does not exist` | Create it (step 1) or fix the name in `DATABASE_URL`. |
| Can't log in as platform admin | Check the email and password in `.env`, then run `pnpm db:seed` again. Re-running it resets the admin password to the value in `.env`. |
| Lost the demo owner's one-time password | Log in as platform admin and reset the owner's password from the store's page. You can also delete the demo store there and run `pnpm demo:seed` again. |
| Port 3000 already in use | Stop the other process, or run `pnpm dev -p 3001`. If you do, set `PLATFORM_BASE_URL` to match the new port. |
| `pnpm dev` shows a modified `AGENTS.md` / `CLAUDE.md` | That's normal: `next dev` writes those files. Commit them or ignore the change. |

## Row-Level Security (optional locally)

The database has Row-Level Security policies as a second layer of tenant isolation. They only apply when the app connects as a restricted, non-superuser role. Locally you normally skip this and leave `APP_DATABASE_URL` empty. The app then connects with `DATABASE_URL`, and everything works the same.

To test with RLS switched on:

```bash
psql -d multitenant -U postgres -v app_pw="choose-a-password" -f scripts/sql/rls-role.sql
```

Then set this in `.env` and restart `pnpm dev`:

```dotenv
APP_DATABASE_URL="postgresql://app_user:choose-a-password@localhost:5432/multitenant"
```

## Where to read next

- `README.md`: architecture, how tenant isolation works, who controls what, all scripts
- `KNOWN_GAPS.md`: what's intentionally not built yet
- `templates/`: storefront templates. Each one is `templates/<id>/index.tsx` and implements the same 11 sections. `templates/types.ts` defines the shared structure every template follows.
