/**
 * A small in-memory rate limiter (sliding-window log) plus a client-IP helper.
 *
 * Scope: this counts per Node process, so it protects a SINGLE app instance. It is the right
 * primitive for the current single-instance deployment and stops the obvious abuse (login
 * brute-force, checkout spam, an unbounded public search endpoint). Once the app runs more than
 * one instance, back the same `rateLimit()` interface with a shared store (Redis/Upstash) so the
 * window is counted across instances — callers below won't need to change.
 *
 * Memory is bounded: each key holds at most `limit` timestamps, and stale keys are swept out.
 */

import { env } from "@/lib/env";

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
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
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
  // Public search endpoint: generous enough for real typing, bounded against scraping.
  search: { limit: 30, windowMs: 60_000 },
  // Importing an image from a pasted link makes the server fetch an outside URL: keyed per
  // tenant, so an owner account can't be used as a download proxy.
  imageImport: { limit: 40, windowMs: 10 * 60_000 },
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
 */
export function clientIp(headers: Headers): string {
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
