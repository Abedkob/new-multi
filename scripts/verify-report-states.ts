/**
 * Phase 5 verification: the states nobody designs for (pnpm verify:report-states —
 * P5-25 to P5-31, P5-34).
 *
 * Every screen in this phase was built against a store with data. The states below are the ones
 * a real merchant meets first, and each of them has a wrong answer that looks finished:
 *
 *   - **Nothing measured yet** shown as a grid of zeros, which reads "nobody came to your shop"
 *     when the truth is "nothing has been counted yet" (P5-25).
 *   - **Traffic but no orders** shown as an empty page, when traffic, WhatsApp, products and
 *     searches are exactly what that merchant needs to look at (P5-26).
 *   - **Redis down** shown as 0 visitors here right now, which is a claim about the store rather
 *     than about the platform (P5-27).
 *   - **A chart with no table**, which is a number a screen reader cannot read (P5-29).
 *   - **Arabic that falls back to English**, or a phone that gets five of eight columns
 *     (P5-30, P5-31).
 *
 * Needs the server running (BASE_URL). Admin-only, so there is no custom-domain leg: P5-34's
 * refusal is proven instead (D47).
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { localDayOf, localDayToDate } from "../lib/analytics/local-day";
import { ADMIN_LOCALE_COOKIE } from "../lib/i18n/locale";
import { ar } from "../lib/i18n/dictionaries/ar";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BEIRUT = "Asia/Beirut";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(6)} ${message}`);
};

class Session {
  private jar = new Map<string, string>();
  constructor(private readonly extra: Record<string, string> = {}) {}
  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i < 0) continue;
      const value = pair.slice(i + 1);
      if (value === "") this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), value);
    }
  }
  private get cookie() {
    return [...Object.entries(this.extra), ...this.jar]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  async get(path: string) {
    const res = await fetch(BASE + path, { redirect: "manual", headers: { cookie: this.cookie } });
    this.absorb(res);
    return { status: res.status, location: res.headers.get("location") ?? "", body: await res.text() };
  }
  async login(email: string, password: string) {
    const csrf = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: this.cookie } });
    this.absorb(csrf);
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: this.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password }),
    });
    this.absorb(res);
    assert.ok(
      [...this.jar.keys()].some((k) => k.includes("session-token")),
      "login did not produce a session cookie",
    );
    return this;
  }
  /** The same session, with the admin dashboard switched to another language. */
  withLocale(locale: string) {
    const clone = new Session({ ...this.extra, [ADMIN_LOCALE_COOKIE]: locale });
    for (const [k, v] of this.jar) clone.jar.set(k, v);
    return clone;
  }
}

function requestWithHost(path: string, host: string) {
  const url = new URL(BASE);
  return new Promise<{ status: number }>((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path, method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * P5-29, structurally: no screen in this phase draws a chart that is not already a table.
 *
 * The rule is enforced at the source rather than by inspecting rendered SVG, because the way
 * this requirement is normally broken is by reaching for a charting library — at which point the
 * table becomes a second, hand-maintained copy of the data that drifts.
 */
function chartAlternativeChecks() {
  const screens = [
    "app/admin/(panel)/analytics/page.tsx",
    "app/admin/(panel)/analytics/products/products-table.tsx",
    "app/admin/(panel)/analytics/funnel/funnel-table.tsx",
    "app/admin/(panel)/analytics/acquisition/acquisition-table.tsx",
    "app/admin/(panel)/analytics/searches/searches-view.tsx",
    "app/admin/(panel)/analytics/heatmap/heatmap-grid.tsx",
    "app/admin/(panel)/marketing/results/results-table.tsx",
    "app/admin/(panel)/marketing/campaigns/campaign-table.tsx",
    "components/admin/analytics/series-table.tsx",
    "components/admin/analytics/data-table.tsx",
  ];
  const LIBRARIES = ["recharts", "chart.js", "d3", "victory", "nivo", "apexcharts"];
  for (const screen of screens) {
    const source = readFileSync(screen, "utf8");
    for (const library of LIBRARIES) {
      assert.ok(
        !source.includes(`from "${library}`),
        `${screen} imports ${library}: a chart library means the table becomes a second copy`,
      );
    }
    assert.ok(!/<svg|<canvas/.test(source), `${screen} draws a chart instead of a table`);
  }
  // The three screens that do draw something visual draw it inside a table row, and the bar
  // itself is hidden from assistive technology: the number next to it is the content.
  for (const withBars of [
    "components/admin/analytics/series-table.tsx",
    "app/admin/(panel)/analytics/funnel/funnel-table.tsx",
  ]) {
    const source = readFileSync(withBars, "utf8");
    assert.ok(source.includes("<table"), `${withBars} must be a real table`);
    assert.ok(
      source.includes('aria-hidden="true"'),
      `${withBars}'s bar must be hidden from assistive technology`,
    );
    assert.ok(source.includes('scope="row"'), `${withBars}'s rows must be headed`);
  }
  const grid = readFileSync("app/admin/(panel)/analytics/heatmap/heatmap-grid.tsx", "utf8");
  assert.ok(
    grid.includes('scope="row"') && grid.includes('scope="col"') && grid.includes("<caption"),
    "the heatmap must be a table with both axes headed and a caption",
  );
  ok("P5-29", `all ${screens.length} report screens are tables, with the bars marked decorative`);

  // P5-31, structurally: one column definition feeds both layouts, so a column cannot exist on
  // a desktop and be missing on a phone.
  const dataTable = readFileSync("components/admin/analytics/data-table.tsx", "utf8");
  assert.ok(dataTable.includes("hidden overflow-x-auto md:block"), "the table hides on a phone");
  assert.ok(dataTable.includes("md:hidden"), "and the cards hide on a desktop");
  assert.ok(
    (dataTable.match(/columns\.map|rest\.map/g) ?? []).length >= 3,
    "both layouts must be generated from the same column list",
  );
  for (const dense of [
    "app/admin/(panel)/analytics/products/products-table.tsx",
    "app/admin/(panel)/analytics/acquisition/acquisition-table.tsx",
    "app/admin/(panel)/marketing/results/results-table.tsx",
    "app/admin/(panel)/marketing/campaigns/campaign-table.tsx",
  ]) {
    assert.ok(
      readFileSync(dense, "utf8").includes("DataTable"),
      `${dense} must use the shared table so its phone layout cannot drift`,
    );
  }
  ok("P5-31", "4 dense tables share one column definition for the table and the phone cards");
}

async function main() {
  chartAlternativeChecks();

  const run = Date.now().toString(36);
  const password = generateTempPassword();
  const quiet = await createStoreWithOwner({
    storeName: `States Quiet ${run}`,
    ownerName: "Q",
    ownerEmail: `states-quiet-${run}@example.test`,
    passwordHash: await hashPassword(password),
  });
  const busy = await createStoreWithOwner({
    storeName: `States Busy ${run}`,
    ownerName: "B",
    ownerEmail: `states-busy-${run}@example.test`,
    passwordHash: await hashPassword(password),
  });
  for (const store of [quiet, busy]) {
    await prisma.tenant.update({
      where: { id: store.tenant.id },
      data: { analyticsTimezone: BEIRUT },
    });
    await prisma.user.update({
      where: { id: store.user.id },
      data: { mustChangePassword: false },
    });
  }

  const day = localDayToDate(localDayOf(new Date(), BEIRUT));

  try {
    // ---------------------------------------------------------------------------------------
    // P5-25: a store with nothing measured.
    // ---------------------------------------------------------------------------------------
    const quietOwner = await new Session().login(quiet.user.email, password);
    const nothing = await quietOwner.get("/admin/analytics?period=7");
    assert.equal(nothing.status, 200);
    assert.ok(
      nothing.body.includes('data-testid="not-measuring"'),
      "a store with nothing measured must be told so",
    );
    assert.ok(
      nothing.body.includes("Nothing has been measured yet"),
      "in those words, not as a grid of zeros",
    );
    assert.ok(
      nothing.body.includes('data-testid="live-visitors"'),
      "the live tile still renders — it is about right now, not about the period",
    );
    // The tiles are the thing that must NOT be there: zeros presented as fact.
    assert.ok(
      !nothing.body.includes("Visits that ordered"),
      "the conversion tile must not be shown for a store that has measured nothing",
    );
    assert.ok(
      nothing.body.includes("not switched on for measurement") ||
        nothing.body.includes("No visitor has agreed"),
      "and it must say which of the two conditions is missing",
    );
    ok("P5-25", "a store with nothing measured is told how measurement begins, not shown zeros");

    // ---------------------------------------------------------------------------------------
    // P5-27: Redis down (or absent) — unavailable, never zero.
    // ---------------------------------------------------------------------------------------
    const live = /data-testid="live-visitors"[\s\S]{0,400}?<\/div>/.exec(nothing.body)?.[0] ?? "";
    assert.ok(live, "the live-visitor tile must be on the page");
    if (process.env.REDIS_URL) {
      // This run's Redis may be up or down; both are legitimate, and each has exactly one
      // correct rendering. What is never correct is a 0 produced by an unreachable Redis.
      const unavailable = live.includes('data-live="unavailable"');
      assert.ok(
        unavailable || /<span class="text-2xl[^"]*">\d+<\/span>/.test(live),
        `the live tile must show either a count or "unavailable", got: ${live.slice(0, 200)}`,
      );
      ok(
        "P5-27",
        unavailable
          ? "with Redis unreachable the live tile says unavailable, not 0"
          : "with Redis reachable the live tile shows a real count",
      );
    } else {
      assert.ok(
        live.includes('data-live="unavailable"'),
        "with no REDIS_URL at all, presence must read unavailable rather than 0",
      );
      ok("P5-27", "with no Redis configured the live tile says unavailable, not 0");
    }

    // ---------------------------------------------------------------------------------------
    // P5-26: traffic, and not a single order.
    // ---------------------------------------------------------------------------------------
    await prisma.analyticsDailyMetric.create({
      data: {
        tenantId: busy.tenant.id,
        localDay: day,
        timeZone: BEIRUT,
        sessions: 5,
        visitors: 4,
        newVisitors: 4,
        productViewSessions: 3,
        addToCartSessions: 1,
        searchSessions: 2,
        whatsappClickSessions: 2,
        whatsappPotentialValueCents: 4_500,
        // No orders. None.
      },
    });
    await prisma.analyticsProductDaily.create({
      data: {
        tenantId: busy.tenant.id,
        localDay: day,
        timeZone: BEIRUT,
        productId: `p-${run}`,
        productName: "Wool Scarf",
        viewSessions: 3,
        views: 4,
        viewVisitors: 3,
        returningViewVisitors: 1,
        addToCartSessions: 1,
        whatsappClickSessions: 2,
      },
    });
    await prisma.analyticsSearchDaily.create({
      data: {
        tenantId: busy.tenant.id,
        localDay: day,
        timeZone: BEIRUT,
        phrase: "wool scarf",
        searches: 2,
        searchSessions: 2,
      },
    });

    const busyOwner = await new Session().login(busy.user.email, password);
    const overview = await busyOwner.get("/admin/analytics?period=7");
    assert.equal(overview.status, 200);
    assert.ok(!overview.body.includes('data-testid="not-measuring"'), "this store IS measured");
    assert.ok(overview.body.includes(">5<"), "its 5 visits must be shown");
    assert.ok(overview.body.includes("WhatsApp messages started"), "and its WhatsApp activity");
    assert.ok(
      overview.body.includes("No orders yet, so there is no average"),
      "an average order with no orders must be explained, not shown as 0",
    );
    const products = await busyOwner.get("/admin/analytics/products?period=7");
    assert.ok(products.body.includes("Wool Scarf"), "products must still be listed");
    const searches = await busyOwner.get("/admin/analytics/searches?period=7");
    assert.ok(searches.body.includes("wool scarf"), "searches must still be listed");
    ok("P5-26", "a store with traffic and no orders still sees traffic, WhatsApp, products and searches");

    // P5-28: the freshness line, with an age.
    assert.ok(
      overview.body.includes('data-testid="freshness"'),
      "a measured period must say when it was last updated",
    );
    assert.ok(
      nothing.body.includes('data-testid="freshness-none"'),
      "and an unmeasured one must say nothing has been calculated",
    );
    ok("P5-28", "the last update is shown where there is one, and named as absent where there is not");

    // ---------------------------------------------------------------------------------------
    // P5-31, rendered: the same numbers in the table and in the phone cards.
    // ---------------------------------------------------------------------------------------
    const rows = (products.body.match(new RegExp(`data-product="p-${run}"`, "g")) ?? []).length;
    assert.equal(rows, 2, `the product must appear in both layouts, found ${rows}`);
    const cards = /<ol class="[^"]*md:hidden[^"]*">([\s\S]*?)<\/ol>/.exec(products.body)?.[1] ?? "";
    assert.ok(cards.includes("Wool Scarf"), "the phone card must name the product");
    assert.ok(
      cards.includes("Visits that viewed") && cards.includes("Order value"),
      "and must carry the same column labels as the table",
    );
    ok("P5-31", "the product appears in both layouts, with the same columns on the phone");

    // ---------------------------------------------------------------------------------------
    // P5-30: Arabic, RTL, with no English left behind.
    // ---------------------------------------------------------------------------------------
    const arabic = busyOwner.withLocale("ar");
    for (const [path, key] of [
      ["/admin/analytics?period=7", "overview.heading.traffic"],
      ["/admin/analytics/products?period=7", "productsReport.table.product"],
      ["/admin/analytics/funnel?period=7", "funnel.website.heading"],
      // Page descriptions for the screens this fixture leaves empty: an empty table has no
      // column headers to check, and the sentence above it is what the owner actually reads.
      ["/admin/analytics/acquisition?period=7", "acquisition.page.description"],
      ["/admin/analytics/searches?period=7", "searches.all.heading"],
      ["/admin/analytics/heatmap?period=7", "heatmap.measure.label"],
      ["/admin/marketing/results?period=7", "results.page.description"],
      ["/admin/marketing/campaigns?period=7", "campaigns.page.description"],
    ] as const) {
      const page = await arabic.get(path);
      assert.equal(page.status, 200, `${path} must render in Arabic`);
      assert.ok(page.body.includes('dir="rtl"'), `${path} must be laid out right to left`);
      assert.ok(
        page.body.includes(ar[key].slice(0, 20)),
        `${path} must show the Arabic text for ${key}, not the English`,
      );
    }
    // The one piece of English that is allowed through: a utm value the owner typed themselves.
    ok("P5-30", "all 8 report screens render right-to-left with their Arabic copy");

    // ---------------------------------------------------------------------------------------
    // P5-34: Marketing and the platform console are refused on a store's own domain.
    // ---------------------------------------------------------------------------------------
    const host = `states-${run}.test`;
    await prisma.tenant.update({ where: { id: busy.tenant.id }, data: { domain: host } });
    for (const path of ["/admin/marketing", "/admin/marketing/integrations", "/platform/analytics"]) {
      const res = await requestWithHost(path, host);
      assert.equal(res.status, 404, `${path} must be 404 on a store's own domain, got ${res.status}`);
    }
    ok("P5-34", "Marketing and the platform console do not exist on a store's own domain");
  } finally {
    for (const store of [quiet, busy]) {
      await prisma.analyticsDailyMetric.deleteMany({ where: { tenantId: store.tenant.id } });
      await prisma.analyticsProductDaily.deleteMany({ where: { tenantId: store.tenant.id } });
      await prisma.analyticsSearchDaily.deleteMany({ where: { tenantId: store.tenant.id } });
      await prisma.tenant.delete({ where: { id: store.tenant.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: store.user.id } }).catch(() => {});
    }
  }
}

main()
  .then(() => console.log(`\nAll ${checks} report-state checks passed.`))
  .catch((error) => {
    console.error(`\nFAILED: ${error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
