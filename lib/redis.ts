"use server";

import { createClient } from "redis";
import { env } from "@/lib/env";

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;
let redisConnecting: Promise<RedisClient | null> | null = null;

export async function getRedisClient(): Promise<RedisClient | null> {
  if (!env.REDIS_URL) return null;
  if (redisClient) return redisClient;
  if (redisConnecting) return redisConnecting;

  redisConnecting = connect();
  redisClient = await redisConnecting;
  redisConnecting = null;
  return redisClient;
}

async function connect(): Promise<RedisClient | null> {
  if (!env.REDIS_URL) return null;

  try {
    const client = createClient({
      url: env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
      },
    });

    client.on("error", (err) => {
      console.error("[redis] connection error:", err);
    });

    await client.connect();
    console.log("[redis] connected");
    return client;
  } catch (error) {
    console.error("[redis] failed to connect:", error);
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Distributed rate limiter using Redis. Atomically increments a counter for the given key
 * and checks if it exceeds the limit within the time window.
 *
 * Returns true if the request is allowed, false if it exceeds the rate limit.
 */
export async function redisRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const client = await getRedisClient();
  if (!client) return { allowed: true, remaining: opts.limit, retryAfterMs: 0 };

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

    return { allowed, remaining, retryAfterMs };
  } catch (error) {
    console.error("[redis] rate limit error:", error);
    // Fail open: allow the request if Redis is down
    return { allowed: true, remaining: opts.limit, retryAfterMs: 0 };
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
