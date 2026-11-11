/**
 * Rate limiter with Redis support for production (distributed across instances) and
 * in-memory fallback for development.
 *
 * When REDIS_URL is set, rate limits are shared across all app instances. When Redis is
 * unavailable or REDIS_URL is not set, falls back to in-memory (single-instance only).
 * Callers don't need to know which backend is active.
 */

import { edgeConfigFromEnv, trustedClientIp, type EdgeConfig } from "@/lib/edge";
import { env } from "@/lib/env";
import { redisRateLimit } from "@/lib/redis";

type Store = Map<string, number[]>;

const globalForRateLimit = globalThis as unknown as { __rateLimitStore?: Store };
const store: Store = (globalForRateLimit.__rateLimitStore ??= new Map());

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

/** Drop keys whose most recent hit is older than `maxAgeMs`, so idle keys don't accumulate. */
function sweep(now: number, maxAgeMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, hits] of store) {
    if (hits.length === 0 || hits[hits.length - 1] <= now - maxAgeMs) store.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Requests still allowed in the current window (0 when blocked). */
  remaining: number;
  limit: number;
  /** Milliseconds until the caller may retry (0 when allowed). */
  retryAfterMs: number;
};

/**
 * Records one hit against `key` and reports whether it is allowed. A key is blocked once it has
 * `limit` hits inside the trailing `windowMs`.
 *
 * Uses Redis when available (production); falls back to in-memory when Redis is not configured
 * or unavailable (development).
 */
export async function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  // Try Redis first (production with distributed rate limiting). When it cannot answer, fall
  // through to the in-memory limiter below rather than returning "allowed": a shared limiter
  // that is briefly unreachable should degrade to per-instance limits, not to no limits.
  if (env.REDIS_URL) {
    const result = await redisRateLimit(key, opts);
    if (result.available) {
      return {
        ok: result.allowed,
        remaining: result.remaining,
        limit: opts.limit,
        retryAfterMs: result.retryAfterMs,
      };
    }
  }

  // Fallback to in-memory (development, or Redis unreachable)
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  const hits = (store.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= opts.limit) {
    store.set(key, hits);
    const retryAfterMs = Math.max(0, hits[0] + opts.windowMs - now);
    sweep(now, opts.windowMs);
    return { ok: false, remaining: 0, limit: opts.limit, retryAfterMs };
  }

  hits.push(now);
  store.set(key, hits);
  sweep(now, opts.windowMs);
  return { ok: true, remaining: opts.limit - hits.length, limit: opts.limit, retryAfterMs: 0 };
}

/** Named policies, so the three call sites stay consistent and easy to tune in one place. */
export const RATE_LIMITS = {
  // Login: brute-force protection, keyed per IP (never per email, which would let an attacker
  // lock a victim out).
  login: { limit: 8, windowMs: 5 * 60_000 },
  // Guest checkout: stops one source tying up stock with a flood of pending orders.
  checkout: { limit: 10, windowMs: 10 * 60_000 },
  coupon: { limit: 20, windowMs: 10 * 60_000 },
  // Public search endpoint: generous enough for real typing, bounded against scraping.
  search: { limit: 30, windowMs: 60_000 },
  // Recording a storefront consent decision, keyed per IP. Generous: a visitor may legitimately
  // accept, reopen Cookie settings, change their mind and withdraw within one session, and a
  // shared office connection multiplies that. Note what being blocked does and does not do —
  // the decision is still honoured (the cookie is always written, because losing a visitor's
  // choice to a rate limit would be the worst possible failure here); only the receipt insert
  // is skipped, so the limit protects the table, never the visitor.
  consent: { limit: 30, windowMs: 10 * 60_000 },
  // --- Analytics ingestion ----------------------------------------------------------------
  // Limited primarily per VISITOR, not per IP. Carrier-grade NAT means a large share of mobile
  // traffic — most of it, on Lebanese mobile networks — arrives from a handful of shared
  // addresses. An IP-shaped limit tight enough to be meaningful would throttle a whole carrier
  // and quietly delete the measurement for exactly the audience most stores care about, while
  // an attacker just rotates addresses. The visitor cookie is signed and minted by us, so it is
  // both the fairer key and the harder one to forge.
  //
  // A browsing visitor flushes at most one batch per ten seconds (the tracker's flush interval),
  // so six a minute is normal and this is ten times that.
  analyticsVisitor: { limit: 60, windowMs: 60_000 },
  // Per IP, as an abuse backstop only — set high enough that a shared carrier address carrying
  // hundreds of real shoppers never reaches it, and low enough to stop one machine hammering.
  analyticsIp: { limit: 3_000, windowMs: 60_000 },
  // Cookieless batches cannot be keyed by visitor yet, and each one can mint a visitor row, so
  // identity creation gets its own bound — keyed per STORE AND address, so a burst at one
  // storefront cannot consume another's allowance.
  //
  // The number is large because the failure mode is silent and bad. Measured: with this at
  // 300/min, a burst of new arrivals from a single address exhausted it and then every
  // following batch from those visitors was still cookieless, so they kept missing. A
  // sustained run that should have lost 0.04% of events lost 11.37%, and nothing in the
  // response said so. On a carrier NAT, "hundreds of genuinely new visitors from one address in
  // a minute" is a normal campaign morning, not an attack. The per-store limit below is the
  // real bound on how fast rows can be created.
  analyticsNewVisitorIp: { limit: 1_200, windowMs: 60_000 },
  // And per store, so one busy or abused storefront cannot fill the table on everyone's behalf.
  analyticsTenant: { limit: 3_000, windowMs: 60_000 },
  // Importing an image from a pasted link makes the server fetch an outside URL: keyed per
  // tenant, so an owner account can't be used as a download proxy.
  imageImport: { limit: 40, windowMs: 10 * 60_000 },
  // Parsing a spreadsheet is the most expensive thing a signed-in owner can ask this server to do
  // - a zip to inflate, XML to walk, and a read of the whole catalogue to resolve against - and
  // the preview is the half they can repeat freely without writing anything. Keyed per tenant
  // like imageImport, because the actor is an authenticated member of one store rather than an
  // address. Twenty in ten minutes is far beyond any real editing session.
  catalogueImport: { limit: 20, windowMs: 10 * 60_000 },
} as const;

/**
 * Best-effort client IP from proxy headers. Falls back to "local" when nothing is present (e.g.
 * `next dev`), which simply means those requests share one bucket.
 *
 * Never the FIRST x-forwarded-for entry: that one is whatever the client sent, and a reverse
 * proxy that appends (nginx's `$proxy_add_x_forwarded_for`, most others) keeps it — so an
 * attacker could rotate it per request and never hit a limit. Each trusted proxy appends the
 * address it received the request from, so the real client is the entry TRUSTED_PROXY_COUNT
 * places from the right (1 = a single reverse proxy in front of Next; 2 = e.g. Cloudflare ->
 * nginx -> Next). Anything further left is client-controlled and ignored.
 *
 * Behind a declared edge (EDGE_TRUST_MODE), the address that edge reported is used instead and
 * the hop counting is not consulted at all — see `trustedClientIp`. The count is one number that
 * has to match the deployment's shape, and getting it wrong by one puts either every visitor or
 * the whole internet into a single bucket, quietly.
 *
 * `edge` is for `verify:edge`, which exercises both paths in one process; nothing in the app
 * passes it. See lib/edge.ts's docstring for why that argument exists at all.
 */
export function clientIp(headers: Headers, edge?: EdgeConfig): string {
  const fromEdge = trustedClientIp(headers, edge ?? edgeConfigFromEnv());
  if (fromEdge) return fromEdge;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = hops[Math.max(0, hops.length - env.TRUSTED_PROXY_COUNT)];
    if (ip) return ip;
  }
  return headers.get("x-real-ip")?.trim() || "local";
}

/** Human-friendly "try again in …" from a retry delay. */
export function retryAfterText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
