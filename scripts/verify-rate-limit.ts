/**
 * Rate limiter verification (pnpm verify:rate-limit).
 *
 * Covers the Redis-backed limiter, which is the one production uses and the one that was wrong.
 * It needs a reachable Redis and **fails** when there is none — a limiter check that skips itself
 * is worse than no check, because it reports green for the backend nobody tested.
 *
 * Point it somewhere disposable:
 *
 *   REDIS_URL=redis://localhost:6380 pnpm verify:rate-limit
 *
 * Every key it touches is prefixed with a random run id and deleted at the end, so it is safe
 * against a shared instance — but it is still somebody's Redis, so prefer your own.
 *
 * The two defects this exists to hold down, both in the pre-fix `INCR` + `EXPIRE` version:
 *
 *   - it was a FIXED window while the in-memory fallback was a trailing one, so the shared
 *     limiter was the lenient one and allowed up to 2x the budget across a boundary.
 *     `not-a-fixed-window` is that bug, written as the sequence that distinguishes the two: what
 *     it measures is how MUCH a boundary releases, since "anything at all" is correct for a
 *     trailing window too. Run against the old code it fails 4-of-4 against an expected 1, and
 *     takes `window-releases`, `partial-release` and `blocked-no-extend` with it.
 *
 *   - a key could hold a count with NO TTL (two round trips, a crash between them), and nothing
 *     clears it: that address was rate limited forever, silently.
 *
 * Be clear about the second one: `ttl-always` and `ttl-while-blocked` **do not fail against the
 * old implementation**, because its happy path does set the TTL — the bug needed a process to
 * die between two commands, which no test here can stage. They assert the invariant the single
 * atomic script now guarantees structurally. The fix is that there is no longer a moment when a
 * key exists without an expiry, not that a check caught it.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { closeRedis, redisRateLimit } from "../lib/redis";

const RUN = `verify-rl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Mirrors lib/redis.ts's own prefix, so the cleanup sees what the limiter wrote. */
const BUCKET_PREFIX = "rl:v2:";

let passed = 0;
let failed = 0;

async function check(id: string, what: string, body: () => Promise<void>) {
  try {
    await body();
    console.log(`  ok   ${id.padEnd(20)} ${what}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${id.padEnd(20)} ${what}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let keySeq = 0;
/** A key no other check has touched, so one check can never inherit another's window. */
const freshKey = (name: string) => `${RUN}:${name}:${(keySeq += 1)}`;

/** Spends `n` hits and returns how many were allowed. */
async function spend(key: string, n: number, opts: { limit: number; windowMs: number }) {
  let allowed = 0;
  for (let i = 0; i < n; i += 1) {
    const result = await redisRateLimit(key, opts);
    assert.equal(result.available, true, "Redis must answer; it was reported unavailable");
    if (result.available && result.allowed) allowed += 1;
  }
  return allowed;
}

async function main() {
  if (!process.env.REDIS_URL) {
    console.error(
      "\nREDIS_URL is not set. This check needs a real Redis and will not pretend otherwise.\n" +
        "  docker run -d --rm -p 6380:6379 --name verify-redis redis:7-alpine\n" +
        "  REDIS_URL=redis://localhost:6380 pnpm verify:rate-limit\n",
    );
    process.exit(1);
  }

  // A direct client for the assertions that are ABOUT Redis state (TTLs, key shapes) rather than
  // about the limiter's answers.
  const probe = createClient({ url: process.env.REDIS_URL });
  probe.on("error", () => {});
  await probe.connect();

  console.log(`\nRate limiter: the Redis path (run id ${RUN})\n`);

  await check("answers", "a reachable Redis produces a verdict, not a fallback", async () => {
    const result = await redisRateLimit(freshKey("answers"), { limit: 3, windowMs: 5_000 });
    assert.equal(result.available, true, "available should be true against a reachable Redis");
    assert.ok(result.available && result.allowed, "the first hit must be allowed");
  });

  await check("budget", "exactly `limit` hits are allowed, and the next is not", async () => {
    const key = freshKey("budget");
    const opts = { limit: 5, windowMs: 10_000 };
    assert.equal(await spend(key, 5, opts), 5, "all 5 within budget should be allowed");
    const over = await redisRateLimit(key, opts);
    assert.ok(over.available && !over.allowed, "the 6th hit must be refused");
  });

  await check("remaining", "remaining counts down and floors at 0", async () => {
    const key = freshKey("remaining");
    const opts = { limit: 3, windowMs: 10_000 };
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await redisRateLimit(key, opts);
      assert.ok(r.available);
      if (r.available) seen.push(r.remaining);
    }
    assert.deepEqual(seen, [2, 1, 0, 0], `remaining went ${seen.join(",")}`);
  });

  await check("retry-after", "a refusal says when, within the window", async () => {
    const key = freshKey("retry");
    const opts = { limit: 2, windowMs: 4_000 };
    await spend(key, 2, opts);
    const blocked = await redisRateLimit(key, opts);
    assert.ok(blocked.available && !blocked.allowed);
    if (blocked.available) {
      assert.ok(blocked.retryAfterMs > 0, "retryAfterMs must be positive when blocked");
      assert.ok(
        blocked.retryAfterMs <= opts.windowMs,
        `retryAfterMs ${blocked.retryAfterMs} exceeds the window ${opts.windowMs}`,
      );
    }
  });

  // ---------------------------------------------------------------- defect 1: the missing TTL
  await check("ttl-always", "one hit leaves a key that expires on its own", async () => {
    const key = freshKey("ttl");
    await redisRateLimit(key, { limit: 5, windowMs: 3_000 });
    const ttl = await probe.pTTL(BUCKET_PREFIX + key);
    assert.ok(
      ttl > 0,
      `PTTL was ${ttl}: -1 means a key with no expiry, which is the permanent-lockout bug`,
    );
  });

  await check("ttl-while-blocked", "a blocked key still expires", async () => {
    const key = freshKey("ttlblocked");
    const opts = { limit: 1, windowMs: 3_000 };
    await spend(key, 1, opts);
    await redisRateLimit(key, opts); // refused
    const ttl = await probe.pTTL(BUCKET_PREFIX + key);
    assert.ok(ttl > 0, `PTTL was ${ttl} on a blocked key; it must still be set to expire`);
  });

  // ------------------------------------------------------- defect 2: fixed vs trailing window
  await check("not-a-fixed-window", "a boundary does not hand back the whole budget", async () => {
    // The sequence that tells the two apart. One hit starts the clock; the rest of the budget is
    // spent just before a fixed window would roll over; then we wait past that rollover.
    //
    // What is measured after the boundary is HOW MUCH is released, not whether anything is. A
    // trailing window releases exactly the hits that aged out — here the single one at t=0, so
    // one slot. A fixed counter keyed to a TTL from t=0 has expired wholesale and hands back the
    // entire budget, which is the 2x-the-limit burst this check exists to catch.
    const key = freshKey("sliding");
    const opts = { limit: 4, windowMs: 1_000 };

    await spend(key, 1, opts); // t ~= 0, starts any TTL
    await sleep(900);
    assert.equal(await spend(key, 3, opts), 3, "t~900: the rest of the budget should be allowed");
    await sleep(250); // t ~= 1150: past where a fixed window keyed to t=0 would have expired

    const releasedAfterBoundary = await spend(key, opts.limit, opts);
    assert.equal(
      releasedAfterBoundary,
      1,
      `${releasedAfterBoundary} of ${opts.limit} slots were released at the boundary; a trailing ` +
        `window releases only the hit that aged out, a fixed one releases the whole budget`,
    );
  });

  await check("window-releases", "the budget does come back once the window passes", async () => {
    const key = freshKey("release");
    const opts = { limit: 2, windowMs: 700 };
    await spend(key, 2, opts);
    const blocked = await redisRateLimit(key, opts);
    assert.ok(blocked.available && !blocked.allowed, "should be blocked immediately after");
    await sleep(800);
    const after = await redisRateLimit(key, opts);
    assert.ok(after.available && after.allowed, "a hit after the full window must be allowed");
  });

  await check("partial-release", "hits age out one at a time, not all at once", async () => {
    const key = freshKey("partial");
    const opts = { limit: 2, windowMs: 1_000 };
    await spend(key, 1, opts); // t ~= 0
    await sleep(600);
    await spend(key, 1, opts); // t ~= 600, budget now full
    const blocked = await redisRateLimit(key, opts);
    assert.ok(blocked.available && !blocked.allowed, "t~600: budget is spent");
    await sleep(500); // t ~= 1100: the FIRST hit has aged out, the second has not
    const one = await redisRateLimit(key, opts);
    assert.ok(one.available && one.allowed, "the aged-out hit should free exactly one slot");
    const two = await redisRateLimit(key, opts);
    assert.ok(two.available && !two.allowed, "but only one: the second hit is still in window");
  });

  await check("blocked-no-extend", "retrying while blocked does not extend the block", async () => {
    const key = freshKey("noextend");
    const opts = { limit: 1, windowMs: 1_200 };
    await spend(key, 1, opts);
    const first = await redisRateLimit(key, opts);
    assert.ok(first.available && !first.allowed);
    // Hammer it. If a refused hit were recorded, the window would keep moving forward and the
    // block would outlast the window for as long as a client kept trying.
    for (let i = 0; i < 15; i += 1) await redisRateLimit(key, opts);
    await sleep(1_300);
    const after = await redisRateLimit(key, opts);
    assert.ok(
      after.available && after.allowed,
      "still blocked after the window: refused hits are being recorded",
    );
  });

  await check("same-millisecond", "two hits in one millisecond both count", async () => {
    const key = freshKey("samems");
    const opts = { limit: 2, windowMs: 10_000 };
    // Sequential but same-ms in practice; the member must be unique or one would overwrite the
    // other in the sorted set and the budget would silently double.
    await Promise.all([redisRateLimit(key, opts), redisRateLimit(key, opts)]);
    const third = await redisRateLimit(key, opts);
    assert.ok(
      third.available && !third.allowed,
      "a third hit was allowed: same-millisecond hits are collapsing into one member",
    );
  });

  await check("concurrent", "50 parallel callers cannot exceed the budget", async () => {
    const key = freshKey("concurrent");
    const opts = { limit: 10, windowMs: 10_000 };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => redisRateLimit(key, opts)),
    );
    const allowed = results.filter((r) => r.available && r.allowed).length;
    assert.equal(allowed, 10, `${allowed} of 50 were allowed; the budget is 10`);
  });

  console.log("       (the next check provokes a real WRONGTYPE; the logged error is expected)");
  await check("wrongtype-degrades", "a key of the old shape degrades, never allows", async () => {
    // The pre-fix limiter stored a plain integer. If one were ever read by the new code the
    // sorted-set command errors — and the contract is that an error means "could not answer",
    // so the caller applies its own limit rather than none.
    const key = freshKey("wrongtype");
    await probe.set(BUCKET_PREFIX + key, "7");
    const result = await redisRateLimit(key, { limit: 1, windowMs: 1_000 });
    assert.equal(
      result.available,
      false,
      "a WRONGTYPE error must report unavailable, so the in-memory limiter takes over",
    );
  });

  await check("key-namespace", "new buckets cannot collide with old counters", async () => {
    const key = freshKey("namespace");
    await redisRateLimit(key, { limit: 1, windowMs: 2_000 });
    assert.equal(
      await probe.exists(key),
      0,
      "an unprefixed key exists: the version prefix is not being applied",
    );
    assert.equal(await probe.exists(BUCKET_PREFIX + key), 1, "the prefixed bucket should exist");
    assert.equal(
      await probe.type(BUCKET_PREFIX + key),
      "zset",
      "the bucket should be a sorted set of hit timestamps",
    );
  });

  // Leave nothing behind, including on a shared instance.
  const mine = await probe.keys(`*${RUN}*`);
  if (mine.length) await probe.del(mine);
  const left = await probe.keys(`*${RUN}*`);
  await check("no-leak", "the run removes every key it created", async () => {
    assert.deepEqual(left, [], `left behind: ${left.join(", ")}`);
  });

  await probe.quit();
  await closeRedis();

  console.log(`\n${passed} checks passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nverify:rate-limit could not run:", error);
  await closeRedis().catch(() => {});
  process.exit(1);
});
