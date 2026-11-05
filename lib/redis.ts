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
 * Distributed rate limiter using Redis. Atomically increments a counter for the given key
 * and checks if it exceeds the limit within the time window.
 *
 * The result distinguishes a real verdict from "Redis could not answer". That distinction is the
 * point: an unreachable Redis used to be reported as `allowed: true`, which silently turned the
 * limiter off everywhere instead of falling back to the in-memory one. Callers that get
 * `available: false` must apply their own limit — see lib/rate-limit.ts.
 */
export type RedisRateLimitResult =
  | { available: true; allowed: boolean; remaining: number; retryAfterMs: number }
  | { available: false };

export async function redisRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RedisRateLimitResult> {
  const client = await getRedisClient();
  if (!client) return { available: false };

  try {
    const windowSeconds = Math.ceil(opts.windowMs / 1000);
    const current = await client.incr(key);

    // Set expiration on first hit
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }

    const remaining = Math.max(0, opts.limit - current);
    const allowed = current <= opts.limit;

    let retryAfterMs = 0;
    if (!allowed) {
      const ttl = await client.ttl(key);
      retryAfterMs = ttl > 0 ? ttl * 1000 : opts.windowMs;
    }

    return { available: true, allowed, remaining, retryAfterMs };
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
