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

/** True when the runtime's ICU data knows this zone, so a bad PLATFORM_TIMEZONE fails at
 * startup instead of when the first daily report is bucketed (§3.7). */
function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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

/**
 * Exported so the verification scripts can assert the refinements (pilot mode needs a pilot
 * store, production needs a signing secret, a bad time zone is rejected) by parsing candidate
 * environments directly. Importing this module runs `load()` once against the real process
 * environment, so testing those rules any other way would mean spawning child processes.
 */
export const envSchema = z
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
    // --- Phase 6: admin Web Push (§11, D56) ------------------------------------------------
    // All optional, and the app must behave exactly as it does today without them (P6-31):
    // push is a convenience for the merchant, never a dependency of the shop. lib/push/keys.ts
    // reports "not configured" and every sender becomes a no-op that records why.
    PUSH_VAPID_PUBLIC_KEY: z.string().trim().min(1).optional(),
    PUSH_VAPID_PRIVATE_KEY: z.string().trim().min(1).optional(),
    // The "mailto:" or https URL a push service contacts about this application's pushes.
    PUSH_VAPID_SUBJECT: z.string().trim().min(1).optional(),
    // A subscription's endpoint is a capability: anyone holding it can push to that device
    // until it is revoked. Encrypted at rest with its own key, separate from the licence key so
    // that rotating one does not force the other.
    PUSH_ENCRYPTION_KEY: z.string().optional().refine((value) => {
      if (value === undefined || value === "") return true;
      const decoded = Buffer.from(value, "base64");
      return decoded.length === 32 && decoded.toString("base64") === value;
    }, "Must be a Base64-encoded 32-byte key"),
    // How long one push attempt may take before it is abandoned (D51). Short on purpose: this
    // runs inside after(), and a container may be shut down 10-30s after a response.
    PUSH_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(2_500),
    // --- Storefront analytics (STOREFRONT_ANALYTICS_MASTER_PLAN.md §14) -------------------
    // How far first-party analytics COLLECTION has rolled out. The consent banner and the
    // gating of third-party tags are deliberately NOT tied to this: they apply to every store
    // from day one, or a store outside the pilot would keep firing GA/Ads/Meta with no consent.
    ANALYTICS_ROLLOUT_MODE: z.enum(["off", "pilot", "all"]).default("off"),
    // The single store collection runs for while ANALYTICS_ROLLOUT_MODE=pilot.
    ANALYTICS_PILOT_TENANT_SLUG: z.string().trim().min(1).optional(),
    // HMAC key for the signed consent cookie (and, from Phase 2, the ingestion bootstrap token).
    // Required in production: without it consent decisions can't be signed, so they can't be
    // trusted. Generate with: openssl rand -base64 32
    ANALYTICS_SIGNING_SECRET: z.string().min(32, "Must be at least 32 characters").optional(),
    // Bumped when the signing secret is rotated; cookies carrying an older version re-prompt.
    ANALYTICS_SIGNING_KEY_VERSION: z.coerce.number().int().positive().max(999).default(1),
    // The PLATFORM's side of the joint-controller arrangement (§4.1/§4.2), shown on every
    // store's privacy page next to the merchant's own details.
    PLATFORM_PRIVACY_NAME: z.string().trim().min(1).optional(),
    PLATFORM_PRIVACY_EMAIL: z.string().trim().email("Must be an email address").optional(),
    PLATFORM_PRIVACY_URL: z
      .string()
      .trim()
      .url("Must be a full URL like https://example.com/privacy")
      .optional(),
    // Defaults a newly created store starts with (§4.2); each store can then differ.
    PLATFORM_DEFAULT_LOCALE: z.enum(["en", "ar"]).default("en"),
    PLATFORM_TIMEZONE: z
      .string()
      .trim()
      .min(1)
      .refine(isIanaTimeZone, "Must be an IANA time zone like Asia/Beirut")
      .default("Asia/Beirut"),
    // The platform owner's own GA4 property (this deployment's traffic, not a store's). Was
    // hardcoded in app/layout.tsx, which also ran it on storefront routes — see §2.2.
    // --- Phase 2: collection -------------------------------------------------------------
    // A deliberately small, separate pool so analytics can never exhaust the connections
    // checkout needs. See PRODUCTION.md for the per-instance arithmetic.
    ANALYTICS_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    ANALYTICS_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    // How many batches may be in flight in one process before further ones are dropped. It sits
    // in front of the pool so a burst becomes an immediate refusal rather than hundreds of
    // handlers each waiting out connectionTimeoutMillis. Defaults to twice the pool.
    ANALYTICS_MAX_IN_FLIGHT: z.coerce.number().int().min(1).max(500).optional(),
    // §11.10's ingestion alert: over this percentage of OPERATIONAL drops, with at least
    // ANALYTICS_INGESTION_MIN_BATCHES attempted in the window.
    ANALYTICS_INGESTION_FAILURE_PERCENT: z.coerce.number().min(0.1).max(100).default(5),
    ANALYTICS_INGESTION_MIN_BATCHES: z.coerce.number().int().min(1).max(10_000).default(20),
    // D29: contract rejections get their own, far lower threshold — a COUNT, not a percentage.
    // A 400 is never load and never consent: it means our own code sent something the contract
    // refuses, so a handful in a window is already a bug worth waking someone for.
    ANALYTICS_CONTRACT_REJECTION_ALERT: z.coerce.number().int().min(1).max(10_000).default(5),
    // How old an ingestion health window must be before a batch flushes it to
    // AnalyticsOperationalMetric (D34). One row per instance per window, not one per batch.
    ANALYTICS_HEALTH_FLUSH_MINUTES: z.coerce.number().int().min(0).max(60).default(5),
    // --- Phase 4: retention windows (§4.7, §14) -------------------------------------------
    // Deliberately env-driven rather than constants: §4.7's numbers are a policy decision that
    // a deployment in another jurisdiction may have to change without a code release.
    ANALYTICS_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    ANALYTICS_VISITOR_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(13),
    ANALYTICS_AGGREGATE_RETENTION_MONTHS: z.coerce.number().int().min(1).max(240).default(24),
    ANALYTICS_RECEIPT_RETENTION_MONTHS: z.coerce.number().int().min(1).max(240).default(24),
    // The scheduled command's own pool (lib/prisma-job.ts). Small because the job walks
    // tenants in bounded batches, and because every pool counts against one max_connections.
    ANALYTICS_JOB_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(2),
    ANALYTICS_SESSION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    ANALYTICS_ACTIVE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
    PLATFORM_GA_ID: z
      .string()
      .trim()
      .regex(/^G-[A-Z0-9]{4,20}$/, "Must be a GA4 measurement id like G-XXXXXXX")
      .optional(),
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
  // Half-configured push is worse than none: a public key with no private key means the browser
  // subscribes successfully and nothing is ever delivered, which looks like a broken phone.
  .refine(
    (v) =>
      [v.PUSH_VAPID_PUBLIC_KEY, v.PUSH_VAPID_PRIVATE_KEY, v.PUSH_VAPID_SUBJECT].every((k) => !k) ||
      [v.PUSH_VAPID_PUBLIC_KEY, v.PUSH_VAPID_PRIVATE_KEY, v.PUSH_VAPID_SUBJECT].every((k) => !!k),
    {
      message:
        "PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY and PUSH_VAPID_SUBJECT must be set together",
      path: ["PUSH_VAPID_PUBLIC_KEY"],
    },
  )
  // And a device whose keys cannot be encrypted must not be stored at all.
  .refine((v) => !v.PUSH_VAPID_PRIVATE_KEY || !!v.PUSH_ENCRYPTION_KEY, {
    message: "PUSH_ENCRYPTION_KEY is required once push is configured: a subscription is a secret",
    path: ["PUSH_ENCRYPTION_KEY"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.LICENSE_ENCRYPTION_KEY, {
    message: "LICENSE_ENCRYPTION_KEY is required in production to protect store license secrets",
    path: ["LICENSE_ENCRYPTION_KEY"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.LICENSE_HEARTBEAT_SECRET, {
    message: "LICENSE_HEARTBEAT_SECRET is required in production to secure provider heartbeat checks",
    path: ["LICENSE_HEARTBEAT_SECRET"],
  })
  .refine((v) => v.ANALYTICS_ROLLOUT_MODE !== "pilot" || v.ANALYTICS_PILOT_TENANT_SLUG, {
    message:
      "ANALYTICS_PILOT_TENANT_SLUG is required when ANALYTICS_ROLLOUT_MODE=pilot (otherwise the pilot collects from no store)",
    path: ["ANALYTICS_PILOT_TENANT_SLUG"],
  })
  .refine((v) => v.NODE_ENV !== "production" || v.ANALYTICS_SIGNING_SECRET, {
    message:
      "ANALYTICS_SIGNING_SECRET is required in production (consent cookies must be signed). Generate with: openssl rand -base64 32",
    path: ["ANALYTICS_SIGNING_SECRET"],
  })
  .refine((v) => v.NODE_ENV !== "production" || (v.PLATFORM_PRIVACY_NAME && v.PLATFORM_PRIVACY_EMAIL), {
    message:
      "PLATFORM_PRIVACY_NAME and PLATFORM_PRIVACY_EMAIL are required in production (the platform is a joint controller and must be identifiable on every store's privacy page)",
    path: ["PLATFORM_PRIVACY_NAME"],
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
      ANALYTICS_ROLLOUT_MODE:
        (raw.ANALYTICS_ROLLOUT_MODE as "off" | "pilot" | "all") || "off",
      ANALYTICS_PILOT_TENANT_SLUG: raw.ANALYTICS_PILOT_TENANT_SLUG || undefined,
      ANALYTICS_SIGNING_SECRET: raw.ANALYTICS_SIGNING_SECRET || undefined,
      ANALYTICS_SIGNING_KEY_VERSION: Number(raw.ANALYTICS_SIGNING_KEY_VERSION) || 1,
      PLATFORM_PRIVACY_NAME: raw.PLATFORM_PRIVACY_NAME || undefined,
      PLATFORM_PRIVACY_EMAIL: raw.PLATFORM_PRIVACY_EMAIL || undefined,
      PLATFORM_PRIVACY_URL: raw.PLATFORM_PRIVACY_URL || undefined,
      PLATFORM_DEFAULT_LOCALE: (raw.PLATFORM_DEFAULT_LOCALE as "en" | "ar") || "en",
      PLATFORM_TIMEZONE: raw.PLATFORM_TIMEZONE || "Asia/Beirut",
      ANALYTICS_DATABASE_POOL_MAX: Number(raw.ANALYTICS_DATABASE_POOL_MAX) || 5,
      ANALYTICS_MAX_BATCH_SIZE: Number(raw.ANALYTICS_MAX_BATCH_SIZE) || 20,
      ANALYTICS_MAX_IN_FLIGHT: Number(raw.ANALYTICS_MAX_IN_FLIGHT) || undefined,
      ANALYTICS_INGESTION_FAILURE_PERCENT: Number(raw.ANALYTICS_INGESTION_FAILURE_PERCENT) || 5,
      ANALYTICS_INGESTION_MIN_BATCHES: Number(raw.ANALYTICS_INGESTION_MIN_BATCHES) || 20,
      ANALYTICS_CONTRACT_REJECTION_ALERT: Number(raw.ANALYTICS_CONTRACT_REJECTION_ALERT) || 5,
      ANALYTICS_HEALTH_FLUSH_MINUTES:
        raw.ANALYTICS_HEALTH_FLUSH_MINUTES === undefined
          ? 5
          : Number(raw.ANALYTICS_HEALTH_FLUSH_MINUTES),
      ANALYTICS_RAW_RETENTION_DAYS: Number(raw.ANALYTICS_RAW_RETENTION_DAYS) || 90,
      ANALYTICS_VISITOR_RETENTION_MONTHS: Number(raw.ANALYTICS_VISITOR_RETENTION_MONTHS) || 13,
      ANALYTICS_AGGREGATE_RETENTION_MONTHS: Number(raw.ANALYTICS_AGGREGATE_RETENTION_MONTHS) || 24,
      ANALYTICS_RECEIPT_RETENTION_MONTHS: Number(raw.ANALYTICS_RECEIPT_RETENTION_MONTHS) || 24,
      ANALYTICS_JOB_DATABASE_POOL_MAX: Number(raw.ANALYTICS_JOB_DATABASE_POOL_MAX) || 2,
      ANALYTICS_SESSION_TIMEOUT_MINUTES: Number(raw.ANALYTICS_SESSION_TIMEOUT_MINUTES) || 30,
      ANALYTICS_ACTIVE_WINDOW_MINUTES: Number(raw.ANALYTICS_ACTIVE_WINDOW_MINUTES) || 5,
      PLATFORM_GA_ID: raw.PLATFORM_GA_ID || undefined,
      PUSH_VAPID_PUBLIC_KEY: raw.PUSH_VAPID_PUBLIC_KEY || undefined,
      PUSH_VAPID_PRIVATE_KEY: raw.PUSH_VAPID_PRIVATE_KEY || undefined,
      PUSH_VAPID_SUBJECT: raw.PUSH_VAPID_SUBJECT || undefined,
      PUSH_ENCRYPTION_KEY: raw.PUSH_ENCRYPTION_KEY || undefined,
      PUSH_TIMEOUT_MS: Number(raw.PUSH_TIMEOUT_MS) || 2_500,
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
        "ANALYTICS_ROLLOUT_MODE",
        "ANALYTICS_PILOT_TENANT_SLUG",
        "ANALYTICS_SIGNING_SECRET",
        "ANALYTICS_SIGNING_KEY_VERSION",
        "PLATFORM_PRIVACY_NAME",
        "PLATFORM_PRIVACY_EMAIL",
        "PLATFORM_PRIVACY_URL",
        "PLATFORM_DEFAULT_LOCALE",
        "PLATFORM_TIMEZONE",
        "PLATFORM_GA_ID",
        "ANALYTICS_DATABASE_POOL_MAX",
        "ANALYTICS_MAX_BATCH_SIZE",
        "ANALYTICS_MAX_IN_FLIGHT",
        "ANALYTICS_INGESTION_FAILURE_PERCENT",
        "ANALYTICS_INGESTION_MIN_BATCHES",
        "ANALYTICS_CONTRACT_REJECTION_ALERT",
        "ANALYTICS_HEALTH_FLUSH_MINUTES",
        "ANALYTICS_RAW_RETENTION_DAYS",
        "ANALYTICS_VISITOR_RETENTION_MONTHS",
        "ANALYTICS_AGGREGATE_RETENTION_MONTHS",
        "ANALYTICS_RECEIPT_RETENTION_MONTHS",
        "ANALYTICS_JOB_DATABASE_POOL_MAX",
        "ANALYTICS_SESSION_TIMEOUT_MINUTES",
        "ANALYTICS_ACTIVE_WINDOW_MINUTES",
        "PUSH_VAPID_PUBLIC_KEY",
        "PUSH_VAPID_PRIVATE_KEY",
        "PUSH_VAPID_SUBJECT",
        "PUSH_ENCRYPTION_KEY",
        "PUSH_TIMEOUT_MS",
      ] as const
    ).map((k) => [k, process.env[k] === "" ? undefined : process.env[k]]),
  );

  const parsed = envSchema.safeParse(input);
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
