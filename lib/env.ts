import { z } from "zod";

/**
 * Validated server environment, parsed once at process start so a missing or malformed variable
 * fails fast with a clear message instead of surfacing as a confusing error deep in a request.
 *
 * Server-only: this reads secrets (DATABASE_URL, AUTH_SECRET), so it must never be imported into
 * a client bundle. proxy.ts does import it (for PLATFORM_BASE_URL, to tell a custom domain apart
 * from the platform's own host) — safe because Next 16 runs Proxy on the Node.js runtime by
 * default, not Edge. auth.config.ts, the piece of the auth setup proxy.ts also pulls in, still
 * avoids this file (and any database/bcrypt import) on its own separate grounds — see its
 * docstring — not because of an Edge constraint that no longer applies here.
 *
 * Set SKIP_ENV_VALIDATION=1 to bypass (e.g. a Docker image build where the real values are only
 * injected at run time).
 */

const pgUrl = z
  .string()
  .min(1)
  .refine(
    (s) => /^postgres(ql)?:\/\//.test(s),
    "must be a postgres:// connection string",
  );

const R2_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
] as const;

const schema = z
  .object({
    // Owner/superuser role — migrations, seeds and dev scripts. Bypasses RLS.
    DATABASE_URL: pgUrl.optional(),
    // Restricted, RLS-bound role the Next.js runtime connects as. Falls back to DATABASE_URL.
    APP_DATABASE_URL: pgUrl.optional(),
    // Signs the Auth.js session JWT. Generate with `npx auth secret`.
    AUTH_SECRET: z
      .string()
      .min(16, "AUTH_SECRET must be at least 16 characters (generate with `npx auth secret`)"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // A PENDING order older than this many hours is auto-cancelled (stock restored) when the
    // owner next opens their Orders page.
    ORDER_PENDING_TTL_HOURS: z.coerce.number().int().positive().max(8760).default(24),
    // Origin the platform itself is served from, e.g. "https://shops.example.com" (no trailing
    // slash). Used to build absolute URLs for path-based stores (/store/[slug]/...) in sitemaps,
    // robots.txt and canonical tags — see lib/store-url.ts. A store with its own custom domain
    // (Tenant.domain) doesn't use this at all.
    PLATFORM_BASE_URL: z
      .string()
      .trim()
      .url("Must be a full origin like https://shops.example.com")
      .refine((v) => !v.endsWith("/"), "Must not end with a trailing slash")
      .optional(),
    // This server's own public IPv4 address. Connecting a custom domain
    // (app/platform/(admin)/stores/[slug]/actions.ts) requires its DNS to resolve to exactly
    // this IP before saving — see lib/domain-check.ts. Required in production: without it any
    // domain that resolves *anywhere* (a typo pointing at someone else's site) would be accepted
    // as "verified", and sitemaps/canonicals/redirects would start sending traffic there.
    // Optional in development, where the check falls back to "resolves to something".
    SERVER_PUBLIC_IP: z.ipv4("Must be a bare IPv4 address, e.g. 203.0.113.10").optional(),
    // How many reverse proxies you control sit in front of Next and append to X-Forwarded-For
    // (1 = nginx/Caddy alone; 2 = e.g. Cloudflare -> nginx). The rate limiter takes the client
    // IP from that many entries from the right — see lib/rate-limit.ts's clientIp().
    TRUSTED_PROXY_COUNT: z.coerce.number().int().min(1).max(10).default(1),
    // Cloudflare R2 bucket for owner-uploaded images (lib/storage.ts). All five or none: when
    // unset, uploads fall back to local disk (public/uploads/), which is development-only.
    R2_ACCOUNT_ID: z.string().trim().regex(/^[0-9a-f]{32}$/, "Must be the 32-character hex Cloudflare account ID").optional(),
    R2_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
    R2_BUCKET: z.string().trim().min(1).optional(),
    // Public origin the bucket is served from — the r2.dev URL or a custom domain, e.g.
    // "https://pub-xxxx.r2.dev" or "https://cdn.example.com" (no trailing slash).
    R2_PUBLIC_URL: z
      .string()
      .trim()
      .url("Must be a full origin like https://pub-xxxx.r2.dev")
      .refine((v) => !v.endsWith("/"), "Must not end with a trailing slash")
      .optional(),
    // Redis connection string for distributed rate limiting and domain cache. Required in
    // production when running multiple instances. Format: redis://:password@host:port or
    // redis://host:port (if no auth). Optional in development (falls back to in-memory).
    REDIS_URL: z.string().url("Must be a redis:// connection string").optional(),
    LICENSE_API_BASE_URL: z.string().url().default("https://rlcphqlmnacxhzrffhjg.supabase.co/functions/v1/license-api"),
    LICENSE_PRODUCT_CODE: z.string().trim().min(1).default("idevelopit-ecom-subscription"),
    LICENSE_APPLICATION_VERSION: z.string().trim().min(1).default("0.1.0"),
    LICENSE_PLATFORM: z.string().trim().min(1).default("linux"),
    LICENSE_API_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(10_000),
    LICENSE_ENCRYPTION_KEY: z.string().optional().refine((value) => {
      if (value === undefined || value === "") return true;
      const decoded = Buffer.from(value, "base64");
      return decoded.length === 32 && decoded.toString("base64") === value;
    }, "Must be a Base64-encoded 32-byte key"),
    LICENSE_HEARTBEAT_SECRET: z.string().min(32).optional(),
  })
  .refine((v) => v.APP_DATABASE_URL || v.DATABASE_URL, {
    message: "Set APP_DATABASE_URL (preferred for the runtime) or DATABASE_URL",
    path: ["APP_DATABASE_URL"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.PLATFORM_BASE_URL, {
    message: "PLATFORM_BASE_URL is required in production (sitemaps/canonicals need a real origin)",
    path: ["PLATFORM_BASE_URL"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.SERVER_PUBLIC_IP, {
    message: "SERVER_PUBLIC_IP is required in production (custom-domain DNS verification checks against it)",
    path: ["SERVER_PUBLIC_IP"],
  })
  .refine((v) => R2_KEYS.every((k) => v[k]) || R2_KEYS.every((k) => !v[k]), {
    message: `Set all of ${R2_KEYS.join(", ")} or none of them`,
    path: ["R2_BUCKET"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.R2_BUCKET, {
    message: "R2_* is required in production (local-disk uploads don't survive a redeploy)",
    path: ["R2_BUCKET"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.REDIS_URL, {
    message: "REDIS_URL is required in production (rate limiters and domain cache must be shared across instances)",
    path: ["REDIS_URL"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.LICENSE_ENCRYPTION_KEY, {
    message: "LICENSE_ENCRYPTION_KEY is required in production to protect store license secrets",
    path: ["LICENSE_ENCRYPTION_KEY"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.LICENSE_HEARTBEAT_SECRET, {
    message: "LICENSE_HEARTBEAT_SECRET is required in production to secure provider heartbeat checks",
    path: ["LICENSE_HEARTBEAT_SECRET"],
  });

function load() {
  if (process.env.SKIP_ENV_VALIDATION) {
    // Trust the raw values; still compute the effective URL below.
    const raw = process.env as Record<string, string | undefined>;
    return {
      DATABASE_URL: raw.DATABASE_URL,
      APP_DATABASE_URL: raw.APP_DATABASE_URL,
      AUTH_SECRET: raw.AUTH_SECRET ?? "",
      NODE_ENV: (raw.NODE_ENV as "development" | "test" | "production") ?? "development",
      ORDER_PENDING_TTL_HOURS: Number(raw.ORDER_PENDING_TTL_HOURS) || 24,
      PLATFORM_BASE_URL: raw.PLATFORM_BASE_URL || undefined,
      SERVER_PUBLIC_IP: raw.SERVER_PUBLIC_IP || undefined,
      TRUSTED_PROXY_COUNT: Number(raw.TRUSTED_PROXY_COUNT) || 1,
      REDIS_URL: raw.REDIS_URL || undefined,
      R2_ACCOUNT_ID: raw.R2_ACCOUNT_ID || undefined,
      R2_ACCESS_KEY_ID: raw.R2_ACCESS_KEY_ID || undefined,
      R2_SECRET_ACCESS_KEY: raw.R2_SECRET_ACCESS_KEY || undefined,
      R2_BUCKET: raw.R2_BUCKET || undefined,
      R2_PUBLIC_URL: raw.R2_PUBLIC_URL || undefined,
      LICENSE_API_BASE_URL: raw.LICENSE_API_BASE_URL || "https://rlcphqlmnacxhzrffhjg.supabase.co/functions/v1/license-api",
      LICENSE_PRODUCT_CODE: raw.LICENSE_PRODUCT_CODE || "idevelopit-ecom-subscription",
      LICENSE_APPLICATION_VERSION: raw.LICENSE_APPLICATION_VERSION || "0.1.0",
      LICENSE_PLATFORM: raw.LICENSE_PLATFORM || "linux",
      LICENSE_API_TIMEOUT_MS: Number(raw.LICENSE_API_TIMEOUT_MS) || 10_000,
      LICENSE_ENCRYPTION_KEY: raw.LICENSE_ENCRYPTION_KEY || undefined,
      LICENSE_HEARTBEAT_SECRET: raw.LICENSE_HEARTBEAT_SECRET || undefined,
    };
  }

  // Treat empty strings (e.g. `APP_DATABASE_URL=` in a .env) as unset, so `.optional()` applies
  // instead of failing the format check.
  const input = Object.fromEntries(
    (
      [
        "DATABASE_URL",
        "APP_DATABASE_URL",
        "AUTH_SECRET",
        "NODE_ENV",
        "ORDER_PENDING_TTL_HOURS",
        "PLATFORM_BASE_URL",
        "SERVER_PUBLIC_IP",
        "TRUSTED_PROXY_COUNT",
        "REDIS_URL",
        ...R2_KEYS,
        "LICENSE_API_BASE_URL",
        "LICENSE_PRODUCT_CODE",
        "LICENSE_APPLICATION_VERSION",
        "LICENSE_PLATFORM",
        "LICENSE_API_TIMEOUT_MS",
        "LICENSE_ENCRYPTION_KEY",
        "LICENSE_HEARTBEAT_SECRET",
      ] as const
    ).map((k) => [k, process.env[k] === "" ? undefined : process.env[k]]),
  );

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables:\n${issues}\n\nCheck your .env against .env.example.`,
    );
  }
  return parsed.data;
}

const parsed = load();

/** The connection string the Next.js runtime actually uses (restricted role when available). */
const databaseUrl = parsed.APP_DATABASE_URL ?? parsed.DATABASE_URL!;

// The schema requires PLATFORM_BASE_URL in production; this default only ever applies in
// development/test, where localhost is always correct.
const baseUrl = parsed.PLATFORM_BASE_URL ?? "http://localhost:3000";

// Running in production against the owner role (no restricted role set) silently disables the
// Row-Level Security that enforces tenant isolation. Warn loudly; don't hard-fail (some setups
// legitimately run a single trusted role).
if (parsed.NODE_ENV === "production" && !parsed.APP_DATABASE_URL) {
  console.warn(
    "[env] APP_DATABASE_URL is not set: the runtime is using DATABASE_URL, so Row-Level " +
      "Security is NOT enforced. See scripts/sql/rls-role.sql.",
  );
}

export const env = { ...parsed, databaseUrl, baseUrl };
