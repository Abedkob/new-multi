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

# Stage 3: Runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_PATH=/usr/local/lib/node_modules

# Make the Prisma CLI available for the startup migration step.
RUN npm install -g prisma@7.10.0 dotenv@18.0.2

# Standalone output contains only the traced runtime files and dependencies.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/login', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3000

CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
