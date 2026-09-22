import { z } from "zod";

/**
 * Validated server environment, parsed once at process start so a missing or malformed variable
 * fails fast with a clear message instead of surfacing as a confusing error deep in a request.
 *
 * Server-only: this reads secrets (DATABASE_URL, AUTH_SECRET), so it must never be imported into
 * client or Edge bundles. The Edge middleware (proxy.ts -> auth.config.ts) deliberately avoids it.
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
  })
  .refine((v) => v.APP_DATABASE_URL || v.DATABASE_URL, {
    message: "Set APP_DATABASE_URL (preferred for the runtime) or DATABASE_URL",
    path: ["APP_DATABASE_URL"],
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

// Running in production against the owner role (no restricted role set) silently disables the
// Row-Level Security that enforces tenant isolation. Warn loudly; don't hard-fail (some setups
// legitimately run a single trusted role).
if (parsed.NODE_ENV === "production" && !parsed.APP_DATABASE_URL) {
  console.warn(
    "[env] APP_DATABASE_URL is not set: the runtime is using DATABASE_URL, so Row-Level " +
      "Security is NOT enforced. See scripts/sql/rls-role.sql.",
  );
}

export const env = { ...parsed, databaseUrl };
