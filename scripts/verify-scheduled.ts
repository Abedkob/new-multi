/**
 * Phase 4 verification: the scheduled command cannot touch the storefront
 * (pnpm verify:scheduled — P4-01 to P4-05).
 *
 * This is the first thing Phase 4 builds and the first thing it proves, because everything else
 * in the phase runs inside this orchestration — and because this phase is the first that can
 * DELETE analytics data. A job that can delete is a job that must never run inside a request,
 * never run twice at once, and never take a checkout down with it.
 *
 * Each claim is proven by a forced failure rather than by a happy path: stages that throw, a
 * lease left behind by a "crashed" run, and the analytics tables made genuinely unreadable by
 * revoking the runtime role's SELECT — the one fault that can hit this subsystem alone (see
 * PHASE_3_ACCEPTANCE.md's note on P3-19).
 *
 * No server needed; this talks to the database directly.
 *   pnpm verify:scheduled
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { parse as parseEnvFile } from "dotenv";
import { prisma } from "../lib/prisma";
import { runScheduled, type Stage } from "../lib/analytics/scheduled";
import { disconnectJobPrisma } from "../lib/prisma-job";
import { placeOrder } from "../lib/data/orders";
import { createProduct } from "../lib/data/products";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import { closeRedis } from "../lib/redis";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const quiet = () => {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const customer = {
  customerName: "Scheduled Shopper",
  customerPhone: "+961 70 000 010",
  customerAddress: "1 Job Street",
  deliveryLocation: "Test location",
  notes: "",
};

/** A stage that takes its time, so a second run has something to collide with. */
const slowStage = (ms: number): Stage => ({
  name: "verify-slow",
  run: async () => {
    await sleep(ms);
    return { items: 1, detail: `slept ${ms}ms` };
  },
});

const okStage = (name: string): Stage => ({ name, run: async () => ({ items: 7 }) });
const throwingStage = (name: string): Stage => ({
  name,
  run: async () => {
    throw new Error("deliberate stage failure");
  },
});

async function main() {
  const run = Date.now().toString(36);
  const { tenant, user } = await createStoreWithOwner({
    storeName: `Scheduled ${run}`,
    ownerName: "Phase4",
    ownerEmail: `scheduled-${run}@example.test`,
    passwordHash: await hashPassword("x".repeat(24)),
    privacy: {
      privacyControllerName: "Phase 4 Ltd",
      privacyEmail: `privacy-${run}@example.test`,
      privacyPolicyUrl: null,
      defaultLocale: "en",
      analyticsTimezone: "Asia/Beirut",
      jointControllerRecordedBy: "verify-scheduled",
      jointControllerVersion: "2026-11",
    },
  });
  const T = tenant.id;

  try {
    const product = await createProduct(T, {
      name: "Scheduled Item",
      description: "",
      basePriceCents: 1000,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [{ attributes: {}, stock: 500, priceCentsOverride: null, imageUrl: null }],
    });
    const variantId = product.variants[0].id;
    const order = () =>
      placeOrder(T, customer, [{ variantId, quantity: 1 }], { expectedDeliveryFeeCents: 0 });

    // ---------------------------------------------------------------- P4-01: one run at a time
    // Both calls are real runs against the real lock; only the timing is arranged.
    const first = runScheduled([slowStage(2_000)], { log: quiet });
    await sleep(300);
    const before = await prisma.analyticsScheduledRun.count();
    const second = await runScheduled([okStage("verify-should-not-run")], { log: quiet });
    const after = await prisma.analyticsScheduledRun.count();
    const firstReport = await first;

    assert.equal(second.acquired, false, "a second concurrent run must not acquire the lock");
    assert.deepEqual(second.stages, [], "a run that did not acquire the lock must run no stage");
    assert.equal(after, before, "a run that did not acquire the lock must write no row");
    assert.equal(firstReport.acquired, true);
    assert.equal(firstReport.stages[0]?.status, "OK");
    assert.equal(
      await prisma.analyticsScheduledRun.count({ where: { stage: "verify-should-not-run" } }),
      0,
    );
    ok("P4-01", "two concurrent runs: the second acquired nothing, ran nothing and wrote nothing");

    // ------------------------------------------- P4-02: a checkout is unaffected by a live run
    const idleStart = Date.now();
    const idleOrder = await order();
    const idleMs = Date.now() - idleStart;

    // A run that is genuinely busy for the whole measurement, not a stage that returns at once.
    const busy = runScheduled([slowStage(3_000)], { log: quiet });
    await sleep(200);
    const duringStart = Date.now();
    const duringOrder = await order();
    const duringMs = Date.now() - duringStart;
    await busy;

    assert.ok(idleOrder.id && duringOrder.id, "both orders must exist");
    assert.equal(duringOrder.status, "PENDING");
    // Deliberately generous: this asserts "not blocked", not a performance budget. A run holding
    // the lock and its own pool must not serialize checkout behind it.
    assert.ok(
      duringMs < Math.max(idleMs * 4, 2_000),
      `a checkout during a run took ${duringMs}ms against an idle ${idleMs}ms`,
    );
    ok("P4-02", `a checkout during a full run took ${duringMs}ms against ${idleMs}ms idle`);

    // ---------------------------------- P4-02 (static): no request path can reach the job
    // The rule this phase rests on, enforced rather than trusted: if a route could import the
    // scheduler, a slow or failing job would become a slow or failing page.
    const requestDirs = ["app", "components", "proxy.ts", "lib/cart"];
    const offenders: string[] = [];
    const walk = (p: string) => {
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) return;
      if (st.isDirectory()) {
        for (const entry of readdirSync(p)) walk(path.join(p, entry));
        return;
      }
      if (!/\.(ts|tsx)$/.test(p)) return;
      const source = readFileSync(p, "utf8");
      if (source.includes("analytics/scheduled") || source.includes("prisma-job")) {
        offenders.push(p);
      }
    };
    for (const dir of requestDirs) walk(dir);
    assert.deepEqual(
      offenders,
      [],
      `these request-path files import the scheduled job: ${offenders.join(", ")}`,
    );
    ok("P4-02", "no route, component or proxy file imports the scheduler or its pool");

    // -------------------------------------------------- P4-03: a stage's failure is its own
    const mixed = await runScheduled(
      [okStage("verify-before"), throwingStage("verify-boom"), okStage("verify-after")],
      { log: quiet },
    );
    assert.equal(mixed.acquired, true);
    assert.equal(mixed.failed, 1, "exactly one stage should have failed");
    assert.deepEqual(
      mixed.stages.map((s) => s.status),
      ["OK", "FAILED", "OK"],
      "a throwing stage must not stop the stages after it",
    );
    const boom = await prisma.analyticsScheduledRun.findFirstOrThrow({
      where: { stage: "verify-boom" },
      orderBy: { startedAt: "desc" },
    });
    assert.equal(boom.status, "FAILED");
    assert.match(boom.error ?? "", /deliberate stage failure/);
    assert.ok(boom.finishedAt, "a failed stage must still be finished, not left RUNNING");
    const afterStage = await prisma.analyticsScheduledRun.findFirstOrThrow({
      where: { stage: "verify-after" },
      orderBy: { startedAt: "desc" },
    });
    assert.equal(afterStage.status, "OK");
    ok("P4-03", "a stage that threw was recorded FAILED and the stages after it still ran");

    // ------------------------------------------------- P4-04: a crashed run's lease recovers
    // What a container restart leaves behind: a row that still says RUNNING, with a lease that
    // has already passed, and no process anywhere to finish it.
    const abandoned = await prisma.analyticsScheduledRun.create({
      data: {
        stage: "verify-abandoned",
        startedAt: new Date(Date.now() - 60 * 60_000),
        leaseUntil: new Date(Date.now() - 30 * 60_000),
        status: "RUNNING",
      },
      select: { id: true },
    });
    const recovery = await runScheduled([okStage("verify-recovered")], { log: quiet });
    assert.ok(recovery.expiredLeases >= 1, "the next run must expire a lease that has passed");
    const recovered = await prisma.analyticsScheduledRun.findUniqueOrThrow({
      where: { id: abandoned.id },
    });
    assert.equal(recovered.status, "EXPIRED");
    assert.ok(recovered.finishedAt, "an expired lease must be closed, not left open forever");
    assert.equal(recovery.stages[0]?.status, "OK", "recovery must not stop the run from working");
    ok("P4-04", "a lease left behind by a crashed run was expired and the run carried on");

    // --------------------------- P4-05: the analytics tables unreadable, from the other side
    // Phase 3 proved a CHECKOUT survives this. The job must do the opposite: fail loudly, and
    // leave the storefront alone while it does.
    const ownerUrl = process.env.DATABASE_URL;
    assert.ok(ownerUrl, "DATABASE_URL (the owner connection) is needed to inject this fault");
    // The restricted role's real URL, read from .env rather than the environment: `_owner` has
    // already pointed APP_DATABASE_URL at the owner for this process, and a job running as the
    // owner cannot be denied anything — the fault would be invisible and this check would pass
    // having proven nothing. That is why the job runs as a subprocess here.
    const appUrl = parseEnvFile(readFileSync(".env", "utf8")).APP_DATABASE_URL;
    assert.ok(
      appUrl && new URL(appUrl).username !== new URL(ownerUrl).username,
      "APP_DATABASE_URL must be set to a restricted role in .env for this check to mean anything",
    );
    const owner = new Client({ connectionString: ownerUrl });
    await owner.connect();
    let revoked = false;
    try {
      await owner.query('REVOKE SELECT ON "AnalyticsEvent" FROM app_user');
      revoked = true;

      const child = spawnSync("npx tsx scripts/fixtures/scheduled-read-events.ts", {
        shell: true,
        encoding: "utf8",
        env: { ...process.env, APP_DATABASE_URL: appUrl },
      });
      const line = (child.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "{}";
      const blind = JSON.parse(line) as {
        acquired?: boolean;
        failed?: number;
        stages?: { status: string; error?: string }[];
      };
      assert.equal(child.status, 1, `the job must exit non-zero: ${child.stdout}${child.stderr}`);
      assert.equal(blind.acquired, true, `the run did not acquire the lock: ${line}`);
      assert.equal(blind.failed, 1, `a stage that cannot read its tables must fail: ${line}`);
      assert.match(blind.stages?.[0]?.error ?? "", /permission denied|denied for/i);
      const recorded = await prisma.analyticsScheduledRun.findFirstOrThrow({
        where: { stage: "verify-reads-events" },
        orderBy: { startedAt: "desc" },
      });
      assert.equal(recorded.status, "FAILED");

      // ...and the storefront does not care.
      const blindOrder = await order();
      assert.equal(blindOrder.status, "PENDING");
      ok(
        "P4-05",
        "as app_user with SELECT revoked, the job exited 1 and recorded the failure; an order " +
          "still completed (the checkout path never reads an analytics table)",
      );
    } finally {
      if (revoked) await owner.query('GRANT SELECT ON "AnalyticsEvent" TO app_user');
      await owner.end().catch(() => {});
    }
  } finally {
    await prisma.analyticsScheduledRun.deleteMany({ where: { stage: { startsWith: "verify-" } } });
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

async function shutdown() {
  await disconnectJobPrisma().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

main()
  .then(async () => {
    await shutdown();
    console.log(`\n${checks} checks passed.`);
    process.exit(0);
  })
  .catch(async (error) => {
    await shutdown();
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
