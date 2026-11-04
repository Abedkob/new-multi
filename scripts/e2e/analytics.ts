/**
 * Phase 2 analytics, in a real browser plus a real load generator (pnpm e2e:analytics).
 *
 * Built before the tracker is wired into any storefront, because the claim it tests is the one
 * the whole design rests on: ANALYTICS CANNOT STARVE CHECKOUT. A separate pool is only a
 * sentence in a plan until something saturates it and a shopper still gets their order through.
 *
 * P2-30 does exactly that:
 *   1. Place a real order with the system idle, and time it. That is the baseline.
 *   2. Saturate ingestion with hundreds of concurrent batches.
 *   3. Place another real order while that is still in flight, and time it.
 *   4. Sample pg_stat_activity throughout, counting connections by application_name.
 *
 * The evidence is numbers, not absence of errors: how many connections analytics ever held
 * (must stay at or under its pool size), and how much slower checkout got (must be barely).
 *
 * Needs a running server started with ANALYTICS_ROLLOUT_MODE=all, and Chrome.
 *   pnpm exec next dev --port 3100            # with ANALYTICS_ROLLOUT_MODE=all in the env
 *   BASE_URL=http://localhost:3100 pnpm e2e:analytics
 */

import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { parse as parseEnvFile } from "dotenv";
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { prisma } from "../../lib/prisma";
import { createCategory } from "../../lib/data/categories";
import { createProduct } from "../../lib/data/products";
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventsPath,
  type AnalyticsEnvelope,
} from "../../lib/analytics/contract";
import { mintBootstrapToken } from "../../lib/analytics/token";
import { ANALYTICS_APPLICATION_NAME } from "../../lib/prisma-analytics";
import {
  buildStoredConsent,
  consentCookieName,
  encodeConsent,
} from "../../lib/consent/cookie";
import { GRANT_ALL } from "../../lib/consent/types";
import { env } from "../../lib/env";
import { BASE, launch, makeStore } from "./browser";

/** How many batches to fire at once. Comfortably more than the pool and the ceiling together. */
const SATURATION_BATCHES = 200;
const EVENTS_PER_BATCH = 10;

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/** A synthetic batch, signed the way a real browser's would be. */
function envelopeFor(tenantId: string): AnalyticsEnvelope {
  const now = Date.now();
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    sentAt: now,
    token: mintBootstrapToken(tenantId),
    events: Array.from({ length: EVENTS_PER_BATCH }, () => ({
      eventId: randomUUID(),
      type: "PAGE_VIEW" as const,
      occurredAt: now,
      pageKind: "home" as const,
    })),
  };
}

async function main() {
  const store = await makeStore("Analytics");
  const T = store.tenant.id;
  const slug = store.tenant.slug;

  await prisma.tenant.update({
    where: { id: T },
    data: {
      privacyControllerName: "Analytics Test Ltd",
      privacyEmail: "privacy@analytics.test",
      analyticsTimezone: "Asia/Beirut",
      defaultLocale: "en",
    },
  });

  const category = await createCategory(T, { name: "Load", parentId: null });
  const product = await createProduct(T, {
    name: "Load Test Item",
    description: "For the pool isolation check",
    basePriceCents: 2500,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: category.id,
    variants: [{ attributes: {}, stock: 50, priceCentsOverride: null, imageUrl: null }],
  });

  // A consent cookie the endpoint will accept, built with the same code the app uses.
  const consentCookie = `${consentCookieName(T)}=${encodeConsent(
    buildStoredConsent({ noticeVersion: 1, grants: GRANT_ALL, locale: "en" }),
  )}`;
  const endpoint = `${BASE}${analyticsEventsPath(slug)}`;

  const postBatch = async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: consentCookie },
      body: JSON.stringify(envelopeFor(T)),
    });
    return response.status;
  };

  // Connection sampling, by application_name, straight from Postgres.
  const restricted = parseEnvFile(readFileSync(".env")).APP_DATABASE_URL;
  const monitor = new Client({ connectionString: restricted });
  await monitor.connect();
  const sampleConnections = async () => {
    const { rows } = await monitor.query<{ application_name: string; n: string }>(
      `select coalesce(nullif(application_name, ''), 'app') application_name, count(*) n
         from pg_stat_activity where datname = current_database() group by 1`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.application_name, Number(r.n)]));
    return {
      analytics: byName[ANALYTICS_APPLICATION_NAME] ?? 0,
      total: rows.reduce((sum, r) => sum + Number(r.n), 0),
    };
  };

  const { browser, context } = await launch();
  const page = await context.newPage();
  const home = `${BASE}/store/${slug}`;

  /** The real customer path, click by click, returning how long the submit took. */
  const placeOrder = async (p: Page, who: string): Promise<number> => {
    await p.goto(`${home}/products/${product.slug}`, { waitUntil: "load" });
    await p.locator('[data-testid="add-to-cart-button"]').click();
    await Promise.all([
      p.waitForURL(/\/cart$/),
      p.locator('[data-testid="cart-link"]').first().click(),
    ]);
    await p.waitForSelector('[data-testid="cart-line"]');
    await Promise.all([
      p.waitForURL(/\/checkout$/),
      p.click('[data-testid="go-to-checkout"]'),
    ]);
    await p.fill("#co-customerName", who);
    await p.fill("#co-customerPhone", "+961 70 000 000");
    await p.fill("#co-customerAddress", "1 Load Street");
    await p.fill("#co-deliveryLocation", "https://maps.example.com/?q=load");
    const started = Date.now();
    await Promise.all([
      p.waitForURL(/order-confirmation/),
      p.locator('button[type="submit"]').last().click(),
    ]);
    return Date.now() - started;
  };

  try {
    // ---------------------------------------------------------------- the endpoint is live
    const first = await postBatch();
    assert.equal(first, 202, `the endpoint should accept a valid batch, got ${first}`);
    // Give the write a moment, then confirm it actually landed — otherwise the saturation
    // below would be measuring rejections rather than work.
    await new Promise((r) => setTimeout(r, 500));
    const afterFirst = await prisma.analyticsEvent.count({ where: { tenantId: T } });
    assert.ok(
      afterFirst > 0,
      "No events were stored. Is the server running with ANALYTICS_ROLLOUT_MODE=all? " +
        "Collection is gated by the rollout, so an out-of-rollout store accepts and discards.",
    );
    ok("P2-06", `a valid batch returns 202 and persists its events (${afterFirst} rows)`);

    // ---------------------------------------------------------------- idempotency, before load
    // Deliberately before the flood: the flood exhausts the per-IP limit on purpose, and a
    // rate-limited batch is accepted and discarded, which would make this unmeasurable.
    const replayed = envelopeFor(T);
    const sendReplayed = () =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: consentCookie },
        body: JSON.stringify(replayed),
      }).then((r) => r.status);
    assert.equal(await sendReplayed(), 202);
    assert.equal(await sendReplayed(), 202);
    await new Promise((r) => setTimeout(r, 500));
    const duplicated = await prisma.analyticsEvent.count({
      where: { tenantId: T, eventId: { in: replayed.events.map((e) => e.eventId) } },
    });
    assert.equal(duplicated, EVENTS_PER_BATCH, "a replayed batch must not duplicate rows");
    ok("P2-07", `the same batch delivered twice stored ${duplicated} rows, not ${EVENTS_PER_BATCH * 2}`);

    // ---------------------------------------------------------------- baseline, system idle
    // The first pass through these routes compiles them, which has nothing to do with
    // database contention; timing it would make the comparison meaningless in both directions.
    const warmupMs = await placeOrder(page, "Warmup Shopper");
    const idleConnections = await sampleConnections();
    const baselineMs = await placeOrder(page, "Baseline Shopper");
    ok("P2-30", `warm-up order (route compilation) took ${warmupMs}ms and is excluded`);
    ok("P2-30", `baseline: an order placed with analytics idle took ${baselineMs}ms`);

    // ---------------------------------------------------------------- saturate, then order
    let peakAnalytics = 0;
    let peakTotal = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const sample = await sampleConnections();
        peakAnalytics = Math.max(peakAnalytics, sample.analytics);
        peakTotal = Math.max(peakTotal, sample.total);
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    const flood = Promise.all(
      Array.from({ length: SATURATION_BATCHES }, () => postBatch().catch(() => 0)),
    );
    // Let the flood build before the shopper starts, so the order really does compete with it.
    await new Promise((r) => setTimeout(r, 300));

    const underLoadPage = await context.newPage();
    const underLoadMs = await placeOrder(underLoadPage, "Loaded Shopper");
    const statuses = await flood;
    sampling = false;
    await sampler;
    await underLoadPage.close();

    const accepted = statuses.filter((s) => s === 202).length;
    const refused = statuses.length - accepted;

    // 1. Checkout still worked.
    const orders = await prisma.order.count({ where: { tenantId: T } });
    assert.equal(orders, 3, "warm-up, baseline and under-load orders must all exist");
    ok("P2-30", `the order placed under saturation succeeded (${SATURATION_BATCHES} batches concurrent)`);

    // 2. Checkout did not meaningfully slow down. The allowance is generous because this runs
    //    against a dev server, but a pool that was actually shared would blow well past it.
    const budgetMs = baselineMs * 3 + 2000;
    assert.ok(
      underLoadMs <= budgetMs,
      `checkout under load took ${underLoadMs}ms, over the ${budgetMs}ms budget (baseline ${baselineMs}ms)`,
    );
    ok(
      "P2-30",
      `checkout under saturation took ${underLoadMs}ms vs ${baselineMs}ms idle ` +
        `(${(underLoadMs / baselineMs).toFixed(2)}x, budget ${budgetMs}ms)`,
    );

    // 3. The pool held its ceiling. This is the real proof: however hard analytics was pushed,
    //    it never held more connections than its own small allowance.
    assert.ok(
      peakAnalytics <= env.ANALYTICS_DATABASE_POOL_MAX,
      `analytics held ${peakAnalytics} connections, above its pool of ${env.ANALYTICS_DATABASE_POOL_MAX}`,
    );
    ok(
      "P2-30",
      `analytics never exceeded its pool: peak ${peakAnalytics}/${env.ANALYTICS_DATABASE_POOL_MAX} ` +
        `connections (idle ${idleConnections.analytics}, database peak ${peakTotal} total)`,
    );

    // 4. Nothing was reported as a failure to the caller, even where work was dropped.
    assert.equal(refused, 0, `${refused} batches did not return 202`);
    const stored = await prisma.analyticsEvent.count({ where: { tenantId: T } });
    const offered = (SATURATION_BATCHES + 1) * EVENTS_PER_BATCH;
    ok(
      "P2-13",
      `every batch answered 202; ${stored}/${offered} events stored and the rest dropped ` +
        "silently at the concurrency ceiling, which is the designed behaviour for a burst " +
        "this far past capacity (GET /api/internal/analytics-health attributes each drop)",
    );

  } finally {
    await monitor.end().catch(() => {});
    await context.close();
    await browser.close();
    await store.remove();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log(`\n${checks} checks passed.`);
    process.exit(0);
  })
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => {});
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
