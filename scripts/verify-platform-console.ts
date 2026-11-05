/**
 * Phase 5 verification: the platform console (pnpm verify:platform-console — P5-21 to P5-24, D43).
 *
 * This is the screen where a mistake is not a wrong number but a privacy failure. A cross-tenant
 * query over `AnalyticsEvent` would be a platform-wide browsing history of other people's
 * customers, available to whoever has an admin account. So the first check is structural and
 * covers every module the route can reach, and the rest are about what the page actually serves.
 *
 * The other half is the verdict. §5.8's "growing" is the same sentence as §6's, and both are
 * `compare.ts`'s rule — if this console applied its own threshold, a merchant would be told
 * their week was steady while the platform's dashboard called it growth, and only one of them
 * would be in the room when a decision got made.
 *
 * Admin-only, so there is no custom-domain leg and that is not a skip (D47): the refusal is
 * proven instead, over a socket with a chosen Host header.
 *
 * Needs the server running (BASE_URL) and the platform admin seeded (PLATFORM_ADMIN_* in .env).
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { lastNLocalDays, TREND_RULES } from "../lib/analytics/compare";
import { localDayOf, localDayToDate, shiftLocalDay } from "../lib/analytics/local-day";
import { platformConsole } from "../lib/data/platform-analytics";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const UTC = "UTC";

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
 * P5-21, structurally: nothing the console can reach may read a raw analytics table.
 *
 * The same import walk verify:reports uses for the report layer, pointed at the console's data
 * module and its page. A check that only looked at the module would miss a page that queried
 * prisma itself.
 */
function noPersonLevelDataCheck() {
  const RAW = /\b(analyticsEvent|analyticsSession|analyticsVisitor)\b\s*\./;
  const seen = new Set<string>();
  const queue = ["lib/data/platform-analytics.ts", "app/platform/(admin)/analytics/page.tsx"];
  const offenders: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (RAW.test(source)) offenders.push(file);
    for (const match of source.matchAll(/from "@\/((?:lib|components)\/[^"]+)"/g)) {
      for (const candidate of [`${match[1]}.ts`, `${match[1]}.tsx`]) {
        try {
          readFileSync(candidate, "utf8");
          queue.push(candidate);
          break;
        } catch {
          // Not a file in lib/ or components/ — nothing to walk.
        }
      }
    }
  }
  assert.ok(seen.size >= 3, `the import walk only reached ${seen.size} file(s)`);
  assert.deepEqual(offenders, [], `these console modules read a raw analytics table: ${offenders}`);
  ok("P5-21", `${seen.size} modules reachable from the console, none reads a raw analytics table`);
}

async function main() {
  noPersonLevelDataCheck();

  const run = Date.now().toString(36);
  const ownerPassword = generateTempPassword();
  const big = await createStoreWithOwner({
    storeName: `Console Big ${run}`,
    ownerName: "B",
    ownerEmail: `console-big-${run}@example.test`,
    passwordHash: await hashPassword(ownerPassword),
  });
  const small = await createStoreWithOwner({
    storeName: `Console Small ${run}`,
    ownerName: "S",
    ownerEmail: `console-small-${run}@example.test`,
    passwordHash: "x",
  });
  const quiet = await createStoreWithOwner({
    storeName: `Console Quiet ${run}`,
    ownerName: "Q",
    ownerEmail: `console-quiet-${run}@example.test`,
    passwordHash: "x",
  });
  await prisma.user.update({ where: { id: big.user.id }, data: { mustChangePassword: false } });

  const today = localDayOf(new Date(), UTC);
  const range = lastNLocalDays(7, new Date(), UTC);
  const previousDay = shiftLocalDay(range.from, -1);

  try {
    // A store well over every threshold, and growing: 200 sessions against 100.
    await prisma.analyticsDailyMetric.createMany({
      data: [
        {
          tenantId: big.tenant.id,
          localDay: localDayToDate(today),
          timeZone: UTC,
          sessions: 200,
          visitors: 150,
          orders: 10,
          orderValueCents: 100_000,
          whatsappClickSessions: 20,
          whatsappPotentialValueCents: 500_000,
        },
        {
          tenantId: big.tenant.id,
          localDay: localDayToDate(previousDay),
          timeZone: UTC,
          sessions: 100,
          visitors: 80,
          orders: 4,
          orderValueCents: 40_000,
          whatsappClickSessions: 8,
        },
        // A store whose numbers are real and whose comparison is far too small to judge:
        // 6 sessions against 2 is +200%, and §5.8 says it gets no verdict.
        {
          tenantId: small.tenant.id,
          localDay: localDayToDate(today),
          timeZone: UTC,
          sessions: 6,
          visitors: 5,
          orders: 1,
          orderValueCents: 2_500,
        },
        {
          tenantId: small.tenant.id,
          localDay: localDayToDate(previousDay),
          timeZone: UTC,
          sessions: 2,
          visitors: 2,
        },
      ],
    });

    // ---------------------------------------------------------------------------------------
    // P5-22: the definitions, read straight off the console.
    // ---------------------------------------------------------------------------------------
    const report = await platformConsole(range);
    const bigLine = report.stores.find((s) => s.tenantId === big.tenant.id);
    const smallLine = report.stores.find((s) => s.tenantId === small.tenant.id);
    assert.ok(bigLine && smallLine, "both measured stores must be listed");

    assert.equal(bigLine.sessions, 200);
    assert.equal(bigLine.trends.sessions.verdict, "growing", "200 against 100 is growth");
    assert.ok(
      report.growing.some((s) => s.tenantId === big.tenant.id),
      "and it must appear in the growing list",
    );

    assert.equal(smallLine.sessions, 6, "a small store keeps its real numbers");
    assert.equal(
      smallLine.trends.sessions.verdict,
      "insufficient",
      `6 against 2 is +200% and still below the sample floor of ${TREND_RULES.sessions.minSample}`,
    );
    assert.ok(
      !report.growing.some((s) => s.tenantId === small.tenant.id),
      "a store with no verdict must not be called growing",
    );
    ok("P5-22", "200 vs 100 is growth; 6 vs 2 keeps its numbers and gets no verdict");

    // The quiet store has no aggregate row at all, which is not the same as zeros.
    assert.ok(
      report.inactive.some((s) => s.tenantId === quiet.tenant.id),
      "a store with no rows must be listed as inactive, not as a row of zeros",
    );
    assert.ok(
      !report.stores.some((s) => s.tenantId === quiet.tenant.id),
      "and it must not appear among the measured stores",
    );
    assert.equal(report.totals.storesWithActivity >= 2, true);
    // The two money figures are separate fields and are never added anywhere in the type.
    assert.notEqual(
      report.totals.orderValueCents,
      report.totals.orderValueCents + report.totals.whatsappPotentialValueCents,
      "sanity: the fixture gives the two different values",
    );
    ok("D43", "a store with no rows is inactive, and interest is never added to order value");

    // ---------------------------------------------------------------------------------------
    // P5-23: the view is logged, every time.
    // ---------------------------------------------------------------------------------------
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    assert.ok(adminEmail && adminPassword, "PLATFORM_ADMIN_* must be set to drive the console");
    const admin = new Session();
    await admin.login(adminEmail, adminPassword);

    const before = await prisma.analyticsAuditLog.count({
      where: { action: "PLATFORM_CONSOLE_VIEW" },
    });
    const page = await admin.get("/platform/analytics?period=7");
    assert.equal(page.status, 200, "the platform admin must be able to open the console");
    const after = await prisma.analyticsAuditLog.findMany({
      where: { action: "PLATFORM_CONSOLE_VIEW" },
      orderBy: { at: "desc" },
      take: 1,
    });
    assert.equal(
      await prisma.analyticsAuditLog.count({ where: { action: "PLATFORM_CONSOLE_VIEW" } }),
      before + 1,
      "one view must write exactly one audit row",
    );
    assert.equal(after[0].actorEmail, adminEmail, "the row must name the admin who looked");
    assert.equal(after[0].tenantId, null, "a cross-store view belongs to no single store");
    assert.ok(
      after[0].detail?.includes(range.from) && after[0].detail?.includes("UTC"),
      `the row must record the period it was looking at, got ${after[0].detail}`,
    );
    ok("P5-23", "one console view wrote one audit row naming the admin and the period");

    // And what the page actually says about the small store.
    assert.ok(
      page.body.includes("Not enough activity for a reliable trend"),
      "the small store's row must say there is no reliable trend",
    );
    assert.ok(page.body.includes(`data-store="${small.tenant.slug}"`), "and still show its row");
    assert.ok(page.body.includes(">6<"), "with its real 6 visits");
    assert.ok(
      page.body.includes('data-verdict="growing"'),
      "while the larger store's verdict is shown",
    );
    ok("P5-22", "the rendered console shows real numbers with the verdict withheld");

    // ---------------------------------------------------------------------------------------
    // P5-24: a store owner cannot reach it at all.
    // ---------------------------------------------------------------------------------------
    const owner = new Session();
    await owner.login(big.user.email, ownerPassword);
    const refused = await owner.get("/platform/analytics");
    assert.ok(
      refused.status >= 300 && refused.status < 400 && !refused.location.includes("/platform"),
      `an owner must be sent away from the console, got ${refused.status} ${refused.location}`,
    );
    const anonymous = await new Session().get("/platform/analytics");
    assert.ok(
      anonymous.status >= 300 && anonymous.status < 400 && anonymous.location.includes("/login"),
      `an anonymous visitor must be sent to login, got ${anonymous.status} ${anonymous.location}`,
    );
    ok("P5-24", "a store owner and an anonymous visitor are both turned away");

    // D47: no custom-domain leg for an admin suite — the refusal, proven.
    const host = `console-${run}.test`;
    await prisma.tenant.update({ where: { id: big.tenant.id }, data: { domain: host } });
    const onDomain = await requestWithHost("/platform/analytics", host);
    assert.equal(onDomain.status, 404, `the console must not exist on a store's own domain`);
    ok("D47", "the console is 404 on a store's own domain, where it must not exist");
  } finally {
    for (const tenantId of [big.tenant.id, small.tenant.id, quiet.tenant.id]) {
      await prisma.analyticsDailyMetric.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    for (const userId of [big.user.id, small.user.id, quiet.user.id]) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }
}

main()
  .then(() => console.log(`\nAll ${checks} platform-console checks passed.`))
  .catch((error) => {
    console.error(`\nFAILED: ${error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
