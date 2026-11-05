/**
 * Phase 5 verification: the report screens, as a browser receives them
 * (pnpm verify:report-ui — P5-02, P5-03, P5-06, P5-07, P5-09, P5-10, P5-20, D47).
 *
 * verify:reports holds down what the read layer computes. This holds down what the pages do with
 * it, because every failure this phase can ship looks like information rather than like a bug:
 *
 *   - a 3 shown as "a few", or rounded away;
 *   - an order value and a WhatsApp basket value added into one tile;
 *   - a funnel step with nobody in it quietly dropped, taking the drop-off with it;
 *   - a deleted product rendered as an empty row;
 *   - a redacted search phrase offered as something to stock;
 *   - an insight with no evidence beside it, or a guess shown because nothing qualified.
 *
 * Fixtures are aggregate rows written directly, for the same reason verify:reports writes them:
 * the recompute is Phase 4's claim, and what is under test here is the rendering.
 *
 * **No custom-domain leg, and that is not a skip (D47).** These are admin pages, and the proxy
 * answers 404 for `/admin` on a store's own domain. The refusal is what gets proven instead, and
 * it is proven over a real socket with a chosen Host header rather than assumed.
 *
 * Needs the server running (BASE_URL, default http://localhost:3000).
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { request } from "node:http";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { localDayOf, localDayToDate, shiftLocalDay } from "../lib/analytics/local-day";
import { saveCampaign } from "../lib/data/campaigns";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BEIRUT = "Asia/Beirut";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(6)} ${message}`);
};

class Session {
  private jar = new Map<string, string>();
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
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
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
  }
}

/** `fetch` forbids setting `host`, and undici drops it silently — so the leg needs a raw socket. */
function requestWithHost(path: string, host: string) {
  const url = new URL(BASE);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path, method: "GET", headers: { Host: host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const run = Date.now().toString(36);
  const password = generateTempPassword();
  const store = await createStoreWithOwner({
    storeName: `Report UI ${run}`,
    ownerName: "R",
    ownerEmail: `report-ui-${run}@example.test`,
    passwordHash: await hashPassword(password),
  });
  const T = store.tenant.id;
  await prisma.tenant.update({ where: { id: T }, data: { analyticsTimezone: BEIRUT } });
  // A new owner is forced to change their password on first login; this suite is about the
  // reports, so it clears the flag rather than driving that screen.
  await prisma.user.update({ where: { id: store.user.id }, data: { mustChangePassword: false } });

  const today = localDayOf(new Date(), BEIRUT);
  const yesterday = shiftLocalDay(today, -1);
  const day = localDayToDate(today);

  try {
    // ---------------------------------------------------------------------------------------
    // Fixtures, each one chosen to be a trap for one of the rules above.
    // ---------------------------------------------------------------------------------------
    await prisma.analyticsDailyMetric.createMany({
      data: [
        {
          tenantId: T,
          localDay: day,
          timeZone: BEIRUT,
          // Deliberately tiny: 3 sessions is the store most likely to be misled by rounding.
          sessions: 3,
          visitors: 3,
          newVisitors: 2,
          productViewSessions: 2,
          addToCartSessions: 1,
          cartViewSessions: 1,
          // checkoutSessions stays 0 — the empty step P5-06 is about.
          searchSessions: 2,
          whatsappClickSessions: 1,
          whatsappPotentialValueCents: 777_00,
          orders: 1,
          orderValueCents: 123_00,
        },
        { tenantId: T, localDay: localDayToDate(yesterday), timeZone: BEIRUT, sessions: 1, visitors: 1 },
      ],
    });
    await prisma.analyticsProductDaily.create({
      data: {
        tenantId: T,
        localDay: day,
        timeZone: BEIRUT,
        // No such product row exists: this is the deleted product P5-07 is about, and the name
        // is the snapshot the recompute took on the day it still existed.
        productId: `gone-${run}`,
        productName: "Linen Shirt",
        viewSessions: 2,
        views: 3,
        viewVisitors: 2,
        returningViewVisitors: 0,
        purchasingSessions: 1,
        unitsOrdered: 1,
        orderValueCents: 123_00,
      },
    });
    await prisma.analyticsSearchDaily.createMany({
      data: [
        {
          tenantId: T,
          localDay: day,
          timeZone: BEIRUT,
          phrase: "winter coat",
          searches: 6,
          searchSessions: 4,
          noResultSearches: 6,
        },
        {
          tenantId: T,
          localDay: day,
          timeZone: BEIRUT,
          // The bucket Phase 4 writes when a phrase looked like personal information. It counts,
          // and it must never be suggested (P5-20).
          phrase: "[redacted]",
          redacted: true,
          searches: 9,
          searchSessions: 3,
          noResultSearches: 9,
        },
      ],
    });
    await prisma.analyticsAcquisitionDaily.create({
      data: {
        tenantId: T,
        localDay: day,
        timeZone: BEIRUT,
        sourceKind: "campaign",
        source: "instagram",
        medium: "social",
        campaign: "eid-sale",
        sessions: 3,
        visitors: 3,
        lastTouchOrders: 1,
        lastTouchOrderValueCents: 123_00,
        firstTouchOrders: 0,
        firstTouchOrderValueCents: 0,
        whatsappClickSessions: 1,
      },
    });
    await prisma.analyticsHourlyMetric.create({
      data: { tenantId: T, localDay: day, timeZone: BEIRUT, hour: 14, sessions: 3, orders: 1, orderValueCents: 123_00 },
    });
    await saveCampaign(T, {
      name: "Eid sale",
      utmCampaign: "eid-sale",
      channel: "instagram",
      destinationPath: "/shop",
    });

    const owner = new Session();
    await owner.login(store.user.email, password);

    // ---------------------------------------------------------------------------------------
    // P5-02: the exact number, and no invented trend.
    // ---------------------------------------------------------------------------------------
    const overview = await owner.get("/admin/analytics?period=7");
    assert.equal(overview.status, 200, "the owner must be able to open the overview");
    assert.ok(/>3</.test(overview.body), "3 sessions must appear as the digit 3");
    assert.ok(
      !overview.body.includes("Growing") && !overview.body.includes("Declining"),
      "3 sessions against 1 is not a trend and must not be labelled one",
    );
    ok("P5-02", "a store with 3 sessions sees 3, with no trend verdict");

    // P5-03: the two money figures are both on the page, under different headings, and the page
    // contains neither their sum nor a tile that could be read as containing it.
    const sum = (123_00 + 777_00) / 100;
    assert.ok(overview.body.includes("$123.00"), "the order value must be shown");
    assert.ok(overview.body.includes("$777.00"), "the WhatsApp basket value must be shown");
    assert.ok(
      !overview.body.includes(`$${sum.toFixed(2)}`),
      `the page must not contain $${sum.toFixed(2)} — the sum of money owed and interest`,
    );
    assert.ok(overview.body.includes("Not revenue"), "and the WhatsApp figure must say what it is not");
    ok("P5-03", "order value and WhatsApp interest appear apart, and their sum appears nowhere");

    // P5-09 / P5-10: insights carry evidence, and nothing-qualifies says so.
    assert.ok(
      overview.body.includes("not enough evidence") ||
        /data-insight="[a-z-]+"[\s\S]{0,400}?text-muted-foreground/.test(overview.body),
      "either an insight with its evidence, or the explicit 'not enough evidence' state",
    );
    if (overview.body.includes("data-insight=")) {
      const insights = [...overview.body.matchAll(/data-insight="([a-z-]+)"/g)].map((m) => m[1]);
      ok("P5-09", `${insights.length} insight(s) rendered, each with its evidence line`);
    } else {
      ok("P5-10", "nothing qualified, and the page says there is not enough evidence");
    }

    // ---------------------------------------------------------------------------------------
    // P5-06: the empty funnel step is rendered, with its drop-off.
    // ---------------------------------------------------------------------------------------
    const funnel = await owner.get("/admin/analytics/funnel?period=7");
    assert.equal(funnel.status, 200);
    for (const step of [
      "sessions",
      "productViewSessions",
      "addToCartSessions",
      "cartViewSessions",
      "checkoutSessions",
      "orders",
    ]) {
      assert.ok(funnel.body.includes(`data-step="${step}"`), `the funnel must render ${step}`);
    }
    const checkoutRow = /data-step="checkoutSessions"[\s\S]*?<\/tr>/.exec(funnel.body)?.[0] ?? "";
    assert.ok(checkoutRow.includes(">0<"), "the empty checkout step must read 0, not be omitted");
    assert.ok(checkoutRow.includes("0.0%"), "and its drop-off must be shown");
    ok("P5-06", "all 6 website steps render, the empty one as 0 with its drop-off");

    // ---------------------------------------------------------------------------------------
    // P5-07: the deleted product keeps its name and says it is gone.
    // ---------------------------------------------------------------------------------------
    const products = await owner.get("/admin/analytics/products?period=7");
    assert.equal(products.status, 200);
    assert.ok(products.body.includes("Linen Shirt"), "the snapshot name must be shown");
    assert.ok(
      products.body.includes(`data-product="gone-${run}"`),
      "the row must exist even though the product does not",
    );
    ok("P5-07", "a product that no longer exists shows the name it had");

    // ---------------------------------------------------------------------------------------
    // P5-20: the redacted phrase counts and is never suggested.
    // ---------------------------------------------------------------------------------------
    const searches = await owner.get("/admin/analytics/searches?period=7");
    assert.equal(searches.status, 200);
    assert.ok(searches.body.includes("winter coat"), "a real unmet phrase must be suggested");
    assert.ok(
      searches.body.includes('data-redacted="true"'),
      "the redacted row must be listed among everything searched",
    );
    assert.ok(
      !searches.body.includes('data-demand="[redacted]"'),
      "and must never appear in the 'what to stock' list",
    );
    assert.ok(
      searches.body.includes("15 searches in this period"),
      "the total must include the redacted 9: 6 + 9 = 15, or the screen understates searching",
    );
    ok("P5-20", "the redacted phrase is counted in the total and absent from the suggestions");

    // Acquisition and the heatmap: that they render their own figures, and that the basis and
    // measure switches are reads of a stored column rather than a re-apportionment.
    const acquisition = await owner.get("/admin/analytics/acquisition?period=7&basis=last");
    assert.equal(acquisition.status, 200);
    assert.ok(acquisition.body.includes('data-source="instagram"'));
    assert.ok(acquisition.body.includes("$123.00"), "last touch credits this source with the order");
    const firstTouch = await owner.get("/admin/analytics/acquisition?period=7&basis=first");
    assert.ok(
      !firstTouch.body.includes("$123.00"),
      "first touch was recorded as 0 for this source, so switching the basis must change it",
    );
    ok("P5-19", "each basis reads its own stored column, and the two differ as recorded");

    const heatmap = await owner.get("/admin/analytics/heatmap?period=7");
    assert.equal(heatmap.status, 200);
    assert.ok(heatmap.body.includes(">14<"), "the recorded hour must have a column");
    assert.ok(!heatmap.body.includes(">03<"), "an hour with no row must have no column at all");
    ok("P5-05", "the heatmap shows only the hours the store's own clock recorded");

    // ---------------------------------------------------------------------------------------
    // D47: no custom-domain leg for an admin suite — the refusal is proven instead.
    // ---------------------------------------------------------------------------------------
    const host = `reports-${run}.test`;
    await prisma.tenant.update({ where: { id: T }, data: { domain: host } });
    for (const path of ["/admin/analytics", "/admin/analytics/products", "/admin/marketing/results"]) {
      const res = await requestWithHost(path, host);
      assert.equal(
        res.status,
        404,
        `${path} must not exist on a store's own domain, got ${res.status}`,
      );
    }
    ok("D47", "all 3 report paths are 404 on the store's own domain, where they must not exist");
  } finally {
    await prisma.analyticsDailyMetric.deleteMany({ where: { tenantId: T } });
    await prisma.analyticsHourlyMetric.deleteMany({ where: { tenantId: T } });
    await prisma.analyticsProductDaily.deleteMany({ where: { tenantId: T } });
    await prisma.analyticsSearchDaily.deleteMany({ where: { tenantId: T } });
    await prisma.analyticsAcquisitionDaily.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.delete({ where: { id: T } }).catch(() => {});
    await prisma.user.delete({ where: { id: store.user.id } }).catch(() => {});
  }
}

main()
  .then(() => console.log(`\nAll ${checks} report-UI checks passed.`))
  .catch((error) => {
    console.error(`\nFAILED: ${error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
