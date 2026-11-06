"use server";

import { createClient, type RedisClientType } from "redis";
import { env } from "@/lib/env";

type RedisClient = RedisClientType;

let redisClient: RedisClient | null = null;
let redisConnecting: Promise<RedisClient | null> | null = null;
/** While this is in the future, Redis is treated as unavailable without trying to connect. */
let unavailableUntil = 0;

/** How long a connect may take before Redis is treated as unavailable for this request. */
const CONNECT_TIMEOUT_MS = 2000;
/** How long to stop retrying after a failed connect, so a down Redis costs one attempt. */
const UNAVAILABLE_COOLDOWN_MS = 30_000;

export async function getRedisClient(): Promise<RedisClient | null> {
  if (!env.REDIS_URL) return null;
  if (redisClient) return redisClient;
  if (Date.now() < unavailableUntil) return null;
  if (redisConnecting) return redisConnecting;

  redisConnecting = connect();
  redisClient = await redisConnecting;
  redisConnecting = null;
  if (!redisClient) unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
  return redisClient;
}

/**
 * The client being brought up, kept across calls.
 *
 * It survives a failed attempt on purpose: node-redis keeps retrying in the background, so when
 * Redis comes back a later call adopts the connection instead of starting another one.
 */
let warming: RedisClient | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings a client up, or gives up on it for this request — and never throws either way.
 *
 * The shape here is unusual and the reason is a node-redis failure mode that cost an afternoon.
 * A bounded `reconnectStrategy` (`false`, or an Error, after N tries) makes the library build an
 * `AggregateError` out of a list of collected errors that is by then null; the `TypeError` that
 * throws escapes asynchronously, where no `try`/`catch` of ours can reach it, and Next.js turns
 * it into an `uncaughtException` that aborts whatever request happened to trigger the connect.
 * So a Redis that is merely absent — a developer machine, a container that has not started yet —
 * would take down the page that touched it. It was found by the "here right now" tile (P5-27),
 * which is the first thing to ask Redis a question during a page render.
 *
 * So the strategy never gives up, and the WAITING is bounded instead: this polls `isReady` for
 * CONNECT_TIMEOUT_MS and then returns null, leaving the client to keep trying on its own. The
 * caller degrades immediately (the in-memory limiter, "temporarily unavailable"), and nothing is
 * ever thrown from a socket nobody is listening to any more.
 */
async function connect(): Promise<RedisClient | null> {
  if (!env.REDIS_URL) return null;
  if (warming?.isReady) return warming;

  if (!warming) {
    warming = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Unbounded, with a capped delay: see the note above on why giving up is the dangerous
        // option. One background timer per process is the cost, and the benefit is that a Redis
        // that comes back is picked up without a restart.
        reconnectStrategy: (retries) => Math.min(1000, 50 * (retries + 1)),
      },
    });
    warming.on("error", (err) => {
      // Logged, not thrown. An error event with no listener is an uncaughtException.
      console.error("[redis] connection error:", err instanceof Error ? err.message : err);
    });
    // Deliberately not awaited to completion: its rejection is handled here so that abandoning
    // the wait below can never leave an unhandled rejection behind.
    warming.connect().catch((error: unknown) => {
      console.error(
        "[redis] connect failed, falling back to in-memory limits:",
        error instanceof Error ? error.message : error,
      );
    });
  }

  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (warming.isReady) {
      console.log("[redis] connected");
      return warming;
    }
    await sleep(25);
  }
  return null;
}

/**
 * Whether rate limiting is currently falling back to in-memory (§11.10).
 *
 * Reports what is already known and connects to nothing. The first version of the platform
 * alert called `getRedisClient()` to find out, which costs a 2-second connect attempt per call,
 * logs a connection error every time, and leaves a client retrying in the background — load
 * created by the thing whose job is to notice load. This reads the state the module already
 * keeps: a client that is ready, or a failed attempt whose cooldown has not expired.
 *
 * The cost of not probing is that a fallback which starts and ends between two evaluations is
 * never reported. That is recorded in the acceptance record rather than papered over.
 */
// `async` is not optional here: this module is "use server", so EVERY export must be an async
// function. A synchronous one makes the whole module fail to compile — and since the storefront
// reaches lib/redis.ts through lib/rate-limit.ts, that meant a 500 on every shop page. Neither
// typecheck nor lint catches it; verify:integrations did, by asking for a storefront.
export async function redisFallbackActive(): Promise<boolean> {
  if (!env.REDIS_URL) return false;
  if (redisClient?.isReady) return false;
  return Date.now() < unavailableUntil;
}

/**
 * Closes the connection. Bounded, because quit() waits for a reply the server may never send:
 * against a Redis that has gone away it would hang, which is how a scheduled script or a
 * shutdown hook ends up never finishing.
 *
 * It tears down a client that never finished connecting too. That client is still retrying on a
 * timer, and a timer is enough to stop a verification script from ever exiting.
 */
export async function closeRedis(): Promise<void> {
  const client = redisClient ?? warming;
  redisClient = null;
  warming = null;
  if (!client) return;
  try {
    await Promise.race([client.quit(), sleep(1000)]);
  } catch {
    // Already gone; the forced teardown below is what matters.
  }
  try {
    client.destroy();
  } catch {
    // Not connected, or already destroyed.
  }
}

/**
 * Distributed rate limiter using Redis: a TRAILING window, evaluated in one atomic script.
 *
 * The result distinguishes a real verdict from "Redis could not answer". That distinction is the
 * point: an unreachable Redis used to be reported as `allowed: true`, which silently turned the
 * limiter off everywhere instead of falling back to the in-memory one. Callers that get
 * `available: false` must apply their own limit — see lib/rate-limit.ts.
 *
 * Two things this deliberately does NOT do any more, both found by `verify:rate-limit`:
 *
 * 1. **It is not `INCR` + `EXPIRE`.** Those are two round trips, and a process that died between
 *    them left a key holding a count with no TTL — which nothing clears, so that key was rate
 *    limited *permanently*. A narrow window with an unbounded consequence: one unlucky crash and
 *    an address could never log in or check out again, with nothing logged and no way to notice
 *    except a customer saying so. The script below always sets the key's lifetime in the same
 *    atomic step that writes to it, so a TTL cannot go missing.
 *
 * 2. **It is not a fixed window.** A counter keyed to a `windowSeconds` TTL resets wholesale, so
 *    a caller could spend the entire budget at the end of one window and the whole of it again
 *    immediately after — 16 login attempts in a few seconds against a documented limit of 8.
 *    Worse, the in-memory fallback has always been a trailing window, so the two backends
 *    answered the same question differently and production was the lenient one. This keeps one
 *    timestamp per hit in a sorted set and drops those older than the window, which is exactly
 *    what the in-memory limiter does with its array.
 *
 * A blocked hit is NOT recorded (it would push the window forward and extend a block for as long
 * as a client kept retrying) — again matching the in-memory path.
 */
export type RedisRateLimitResult =
  | { available: true; allowed: boolean; remaining: number; retryAfterMs: number }
  | { available: false };

/**
 * The whole decision, server-side, so it cannot interleave with another instance's.
 *
 * KEYS[1] the bucket · ARGV: now (ms), window (ms), limit, a unique member for this hit.
 * Returns {allowed, remaining, retryAfterMs}.
 */
const SLIDING_WINDOW_LUA = `
local bucket = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', bucket, '-inf', now - window)
local used = redis.call('ZCARD', bucket)

if used >= limit then
  local oldest = redis.call('ZRANGE', bucket, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then
    retry = math.ceil(tonumber(oldest[2]) + window - now)
    if retry < 0 then retry = 0 end
  end
  redis.call('PEXPIRE', bucket, window)
  return {0, 0, retry}
end

redis.call('ZADD', bucket, now, member)
redis.call('PEXPIRE', bucket, window)
return {1, limit - used - 1, 0}
`;

/**
 * Keys are versioned because the shape changed. The old limiter stored a plain integer under the
 * caller's key; a sorted-set command against one of those is a `WRONGTYPE` error, which this
 * function reports as `available: false` — so for the lifetime of the old keys every limit would
 * have quietly degraded to per-instance. A new prefix means the two never meet.
 */
const BUCKET_PREFIX = "rl:v2:";

/** Makes each hit a distinct sorted-set member; two hits in the same millisecond must both count. */
let hitCounter = 0;

export async function redisRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RedisRateLimitResult> {
  const client = await getRedisClient();
  if (!client) return { available: false };

  try {
    const now = Date.now();
    const member = `${now}-${(hitCounter = (hitCounter + 1) % Number.MAX_SAFE_INTEGER)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const reply = (await client.eval(SLIDING_WINDOW_LUA, {
      keys: [BUCKET_PREFIX + key],
      arguments: [String(now), String(opts.windowMs), String(opts.limit), member],
    })) as [number, number, number];

    const [allowed, remaining, retryAfterMs] = reply.map(Number);
    return {
      available: true,
      allowed: allowed === 1,
      remaining: Math.max(0, remaining),
      retryAfterMs: Math.max(0, retryAfterMs),
    };
  } catch (error) {
    console.error("[redis] rate limit error, falling back to in-memory limits:", error);
    // Not "allowed": the caller applies its own limit instead of none at all.
    return { available: false };
  }
}

/**
 * Get a value from Redis cache.
 */
export async function redisGet<T = unknown>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const value = await client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("[redis] get error:", error);
    return null;
  }
}

/**
 * Set a value in Redis cache with optional expiration.
 */
export async function redisSet<T = unknown>(
  key: string,
  value: T,
  opts?: { exSeconds?: number },
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;

  try {
    await client.set(key, JSON.stringify(value), {
      EX: opts?.exSeconds,
    });
    return true;
  } catch (error) {
    console.error("[redis] set error:", error);
    return false;
  }
}

/**
 * Delete a key from Redis.
 */
export async function redisDel(...keys: string[]): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;

  try {
    await client.del(keys);
    return true;
  } catch (error) {
    console.error("[redis] delete error:", error);
    return false;
  }
}

/**
 * Active-visitor presence (§8.2). A sorted set per store: member is an opaque session id, score
 * is the moment of last visible activity. No IP, no page, no history — the set answers "how
 * many" and can answer nothing else.
 *
 * Every result distinguishes a real answer from "Redis could not say", because reporting zero
 * when we simply do not know tells a merchant nobody is in their shop. That is a different and
 * far more damaging claim than admitting the number is unavailable.
 */
export type PresenceResult = { available: true; count: number } | { available: false };

const presenceKey = (tenantId: string) => `analytics:presence:${tenantId}`;

/** Records activity and prunes anything already outside the window. Best effort. */
export async function touchPresence(
  tenantId: string,
  sessionId: string,
  windowMs: number,
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  try {
    const now = Date.now();
    const key = presenceKey(tenantId);
    await client.zAdd(key, [{ score: now, value: sessionId }]);
    await client.zRemRangeByScore(key, 0, now - windowMs);
    // Nothing should outlive the window by much; this is only a backstop against a key leaking
    // if a store goes quiet forever.
    await client.expire(key, Math.ceil((windowMs * 4) / 1000));
    return true;
  } catch (error) {
    console.error("[redis] presence touch failed:", error);
    return false;
  }
}

/** How many sessions were active inside the window. */
export async function countPresence(tenantId: string, windowMs: number): Promise<PresenceResult> {
  const client = await getRedisClient();
  if (!client) return { available: false };
  try {
    const now = Date.now();
    const key = presenceKey(tenantId);
    await client.zRemRangeByScore(key, 0, now - windowMs);
    const count = await client.zCount(key, now - windowMs, "+inf");
    return { available: true, count };
  } catch (error) {
    console.error("[redis] presence count failed:", error);
    return { available: false };
  }
}
