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

async function connect(): Promise<RedisClient | null> {
  if (!env.REDIS_URL) return null;

  try {
    const client = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Bounded on purpose. An endless strategy means client.connect() against a dead server
        // never settles, so every caller awaiting getRedisClient() waits forever — which for the
        // rate limiter means login, checkout and coupon validation hang rather than degrade.
        // `false` gives up instead, which is what lets the in-memory limiter take over.
        reconnectStrategy: (retries) => (retries > 3 ? false : Math.min(retries * 50, 500)),
      },
    });

    client.on("error", (err) => {
      console.error("[redis] connection error:", err);
    });

    // A belt-and-braces bound: connectTimeout covers the socket, this covers the whole handshake
    // (auth, client setup) so no single step can stall a request indefinitely.
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("connect timed out")), CONNECT_TIMEOUT_MS * 2),
      ),
    ]);
    console.log("[redis] connected");
    return client;
  } catch (error) {
    console.error(
      "[redis] failed to connect, falling back to in-memory limits:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Closes the connection. Bounded, because quit() waits for a reply the server may never send:
 * against a Redis that has gone away it would hang, which is how a scheduled script or a
 * shutdown hook ends up never finishing.
 */
export async function closeRedis(): Promise<void> {
  const client = redisClient;
  redisClient = null;
  if (!client) return;
  try {
    await Promise.race([
      client.quit(),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
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
