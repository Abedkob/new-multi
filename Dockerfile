# Multi-stage build for Next.js 16
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npm install -g pnpm && DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm run db:generate

# Build Next.js app
RUN pnpm run build

# Bundle the scheduled command (scripts/build-job.mjs). Next's standalone output contains only
# what the WEB process imports, so without this the job the runbooks tell an operator to schedule
# has no entrypoint in the image at all.
RUN pnpm run build:job

# Stage 3: Runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_PATH=/usr/local/lib/node_modules
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Make the Prisma CLI and the PostgreSQL client library available to the startup bootstrap.
RUN npm install -g prisma@7.10.0 dotenv@18.0.2 pg@8.23.0

# Standalone output contains only the traced runtime files and dependencies.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY scripts/ensure-app-role.cjs ./scripts/ensure-app-role.cjs

# The operational commands (scripts/build-job.mjs), run here as:
#
#   node dist/analytics-scheduled.mjs [--dry-run] [--stage=<name>]   §5 of the deploy checklist
#   node dist/seed.mjs                                               the first platform admin
#
# `pnpm analytics:scheduled` and `pnpm db:seed` are the DEVELOPMENT spellings and neither exists
# in this image: they need pnpm, tsx and the TypeScript sources, none of which are copied here.
# `prisma db seed` is no better — prisma.config.ts has it shell out to `tsx prisma/seed.ts`.
# scripts/verify-container-commands.ts fails if a runbook tells an operator to run something in
# the container that is not present in this stage.
COPY --from=builder /app/dist ./dist


# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/login', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3000

CMD ["sh", "-c", "node scripts/ensure-app-role.cjs && prisma migrate deploy && node server.js"]
