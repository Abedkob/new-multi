/**
 * Load test against §12.3's budgets (P7-23): pnpm load-test
 *
 *   BASE_URL=http://localhost:3003 pnpm load-test
 *   BASE_URL=... pnpm load-test --levels=30,100,150 --seconds=20
 *
 * **Run it against `next build && next start`, never `next dev`.** Dev recompiles per route,
 * serves unminified bundles and skips every production cache, so its numbers are a measurement
 * of the compiler. CLAUDE.md's existing figures (30 concurrent: p50 550ms; 300: 10% fail) were
 * taken against a production build and this is what re-takes them.
 *
 * What it measures, and which budget each one belongs to:
 *
 *   storefront  the shopper's page, at each concurrency level — the pool's limit (max: 30 in
 *               lib/prisma.ts) is what the 300-user row is really about
 *   ingest      POST to the analytics endpoint: §12.3's "ingestion p95 under 150 ms"
 *   dashboard   the owner's 30-day reports: §12.3's "30-day dashboard p95 under 1.5 seconds"
 *   presence    the active-now lookup: §12.3's "under 300 ms"
 *
 * Each level reports p50, p95, p99, the failure count and the status spread, because an average
 * hides exactly the thing a load test is for. A non-2xx is a failure and is counted; so is a
 * socket error, which is what saturation actually looks like from a client.
 *
 * The fixture store is created before the run and deleted after, so the numbers are not a
 * measurement of somebody's demo data.
 */

import "dotenv/config";
import "./_owner";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { createCategory } from "../lib/data/categories";
import { createProduct } from "../lib/data/products";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { mintBootstrapToken } from "../lib/analytics/token";
import { buildStoredConsent, consentCookieName, encodeConsent } from "../lib/consent/cookie";
import { ANALYTICS_SCHEMA_VERSION } from "../lib/analytics/contract";
import { localDayOf, localDayToDate, shiftLocalDay } from "../lib/analytics/local-day";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ORIGIN = new URL(BASE);
const ZONE = "Asia/Beirut";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const LEVELS = (arg("levels") ?? "30,100,150,300").split(",").map((n) => Number(n.trim()));
const SECONDS = Number(arg("seconds") ?? 15);

type Attempt = { ms: number; status: number };

function hit(
  path: string,
  options: { method?: string; body?: string; cookie?: string } = {},
): Promise<Attempt> {
  const started = performance.now();
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: ORIGIN.hostname,
        port: ORIGIN.port,
        path,
        method: options.method ?? "GET",
        headers: {
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.body
            ? {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(options.body)),
              }
            : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ ms: performance.now() - started, status: res.statusCode ?? 0 }));
      },
    );
    // A socket error is what saturation looks like from out here, so it is a failure with a
    // duration rather than an exception that ends the run.
    req.on("error", () => resolve({ ms: performance.now() - started, status: 0 }));
    if (options.body) req.write(options.body);
    req.end();
  });
}

const quantile = (sorted: number[], q: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

type Summary = {
  label: string;
  concurrency: number;
  count: number;
  failures: number;
  p50: number;
  p95: number;
  p99: number;
  statuses: Record<string, number>;
  rps: number;
};

/** `concurrency` workers, each looping for `seconds`, so the level is sustained rather than a burst. */
async function run(
  label: string,
  concurrency: number,
  seconds: number,
  make: (n: number) => Promise<Attempt>,
): Promise<Summary> {
  const attempts: Attempt[] = [];
  const until = Date.now() + seconds * 1000;
  const started = performance.now();
  let n = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < until) attempts.push(await make(n++));
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  const sorted = attempts.map((a) => a.ms).sort((x, y) => x - y);
  const statuses: Record<string, number> = {};
  for (const a of attempts) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
  return {
    label,
    concurrency,
    count: attempts.length,
    failures: attempts.filter((a) => a.status < 200 || a.status >= 400).length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    statuses,
    rps: attempts.length / elapsed,
  };
}

const ms = (n: number) => `${Math.round(n)}ms`;
function print(s: Summary, budget?: { p95: number; what: string }) {
  const spread = Object.entries(s.statuses)
    .map(([code, n]) => `${code === "0" ? "socket error" : code}×${n}`)
    .join(" ");
  // A latency verdict on a level that failed is a lie waiting to be quoted: the first run of
  // this script called a 100%-405 presence level "within budget" because 405s are fast.
  const verdict = !budget
    ? ""
    : s.failures > 0
      ? `  NO VERDICT (${s.failures} failed; latency of a refusal is not latency)`
      : s.p95 <= budget.p95
        ? `  within budget (${budget.what})`
        : `  OVER BUDGET (${budget.what})`;
  const pct = s.count ? ((s.failures / s.count) * 100).toFixed(1) : "0.0";
  console.log(
    `  ${s.label.padEnd(10)} ${String(s.concurrency).padStart(3)} concurrent  ` +
      `n=${String(s.count).padStart(5)}  ${String(Math.round(s.rps)).padStart(4)}/s  ` +
      `p50 ${ms(s.p50).padStart(7)}  p95 ${ms(s.p95).padStart(7)}  p99 ${ms(s.p99).padStart(7)}  ` +
      `fail ${s.failures} (${pct}%)  [${spread}]${verdict}`,
  );
}

async function main() {
  if (/:3000\b/.test(BASE) && !process.env.ALLOW_PORT_3000) {
    console.warn(
      `[load-test] BASE_URL is ${BASE}. If that is a dev server, the numbers are meaningless —\n` +
        `            build first (pnpm build && pnpm start) and point this at that port.\n`,
    );
  }

  const run_ = Date.now().toString(36);
  const password = generateTempPassword();
  const store = await createStoreWithOwner({
    storeName: `Load ${run_}`,
    ownerName: "Load Owner",
    ownerEmail: `load-${run_}@example.test`,
    passwordHash: await hashPassword(password),
  });
  const T = store.tenant.id;
  await prisma.user.update({ where: { id: store.user.id }, data: { mustChangePassword: false } });
  await prisma.tenant.update({ where: { id: T }, data: { analyticsTimezone: ZONE } });

  try {
    // A storefront with something on it: an empty store under-reads the database.
    const category = await createCategory(T, { name: "Load", parentId: null });
    const products: Array<{ slug: string }> = [];
    for (let i = 0; i < 12; i++) {
      products.push(
        await createProduct(T, {
          name: `Load Item ${i}`,
          description: "x".repeat(200),
          basePriceCents: 1000 + i,
          imageUrl: "",
          images: [],
          isBestSeller: i < 4,
          categoryId: category.id,
          variants: [{ attributes: {}, stock: 100, priceCentsOverride: null, imageUrl: null }],
        }),
      );
    }
    // 30 days of aggregates, so the dashboard reads what a real one reads.
    const today = localDayOf(new Date(), ZONE);
    await prisma.analyticsDailyMetric.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        tenantId: T,
        localDay: localDayToDate(shiftLocalDay(today, -i)),
        timeZone: ZONE,
        sessions: 40 + i,
        visitors: 35 + i,
        productViewSessions: 20 + i,
        addToCartSessions: 8,
        cartViewSessions: 6,
        checkoutSessions: 3,
        orders: 2,
        orderValueCents: 15_000,
      })),
    });

    const consent = `${consentCookieName(T)}=${encodeConsent(
      buildStoredConsent({
        noticeVersion: 1,
        grants: { analytics: true, advertising: true },
        locale: "en",
      }),
    )}`;

    // The owner's session, for the dashboard level.
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    const jar = new Map<string, string>();
    const absorb = (res: Response) => {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    };
    absorb(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const cookieOf = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    absorb(
      await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie: cookieOf(), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrfToken, email: store.user.email, password }),
      }),
    );
    const ownerCookie = cookieOf();

    const storefront = `/store/${store.tenant.slug}`;
    const ingestPath = `${storefront}/analytics/events`;
    const presencePath = `${storefront}/analytics/presence`;

    console.log(`\nLoad test — ${BASE}, ${SECONDS}s per level, store ${store.tenant.slug}\n`);

    // Warm every path once: the first hit of a route pays for its own cold start, and that
    // belongs in nobody's p95.
    for (const p of [storefront, `${storefront}/shop`, "/admin/analytics"]) {
      await hit(p, { cookie: p.startsWith("/admin") ? ownerCookie : consent });
    }

    console.log("  Storefront — the shopper's page (CLAUDE.md's table)\n");
    const storefrontRuns: Summary[] = [];
    for (const level of LEVELS) {
      const s = await run("storefront", level, SECONDS, (n) =>
        hit(n % 3 === 0 ? storefront : `${storefront}/products/${products[n % 12].slug}`, {
          cookie: consent,
        }),
      );
      storefrontRuns.push(s);
      print(s);
    }

    console.log("\n  §12.3's own budgets\n");
    // Two levels on purpose. §12.3 says "under expected load", and expected load for one small
    // store is a handful of beacons in flight, not thirty sustained writers — which is a
    // saturation test wearing the same name. Reporting both is the only way to tell "this path
    // is slow" from "I just overloaded a laptop".
    const ingestLevels = [5, 30];
    const ingestRuns: Summary[] = [];
    for (const level of ingestLevels) ingestRuns.push(await run("ingest", level, SECONDS, () =>
      hit(ingestPath, {
        method: "POST",
        cookie: consent,
        body: JSON.stringify({
          schemaVersion: ANALYTICS_SCHEMA_VERSION,
          sentAt: Date.now(),
          token: mintBootstrapToken(T),
          events: [
            { eventId: randomUUID(), type: "PAGE_VIEW", occurredAt: Date.now(), pageKind: "home" },
          ],
        }),
      }),
    ));
    for (const r of ingestRuns) print(r, { p95: 150, what: "ingestion p95 under 150 ms" });

    const dashboard = await run("dashboard", 10, SECONDS, () =>
      hit("/admin/analytics?period=28", { cookie: ownerCookie }),
    );
    print(dashboard, { p95: 1500, what: "30-day dashboard p95 under 1.5 s" });

    const presence = await run("presence", 10, SECONDS, () =>
      hit(presencePath, {
        method: "POST",
        cookie: consent,
        body: JSON.stringify({ token: mintBootstrapToken(T) }),
      }),
    );
    print(presence, { p95: 300, what: "active-now lookup under 300 ms" });

    console.log(`
  Read these with the environment in mind: a single machine running the database, Redis (or
  not), the server and this client at once measures contention between them as much as the app.
  The shape across levels is the signal — where p95 turns up, and where failures start.
`);
  } finally {
    await prisma.tenant.delete({ where: { id: store.tenant.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: store.user.id } }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
