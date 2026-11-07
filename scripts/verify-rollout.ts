/**
 * One definition of "this store participates in analytics" (`pnpm verify:rollout`).
 * Static and pure: no server, no database.
 *
 * The failure this exists for. The rollout gate had drifted into three different definitions:
 *
 *   request paths (layout, events, presence, the report page)  rolloutIncludes()
 *   the aggregation stages                                     analyticsPausedAt: null
 *   owner-alerts and owner-weekly-summary                      no filter at all
 *
 * The job's was the loosest, so a store the rollout excluded was aggregated every five minutes —
 * and `recomputeDays` upserts the daily metric unconditionally, so that store got a row of
 * zeros, which sets `lastComputedAt`, which makes `/admin/analytics` treat it as measured and
 * render a grid of zeros. P5-25 and the NotMeasuring panel exist precisely to stop a store being
 * told "nobody came" when the truth is "nothing has been counted". In `pilot` it also
 * contradicted §7 of the deploy checklist, which has an operator confirm that the pilot store
 * collects and no other store does.
 *
 * None of it was visible, because the scheduled command could not run in the production image.
 * Two defects hid each other: the one that broke the feature, and the one that would have been
 * noticed the moment the feature worked.
 *
 * What is checked:
 *   1. `participationWhere()` agrees with `rolloutIncludes()` in all three modes.
 *   2. Every analytics stage walk uses `participationWhere()`.
 *   3. Housekeeping walks do NOT — retention must still delete an excluded store's rows, and a
 *      new order is an order whatever the rollout says. A deliberate split stays deliberate only
 *      if something fails when it is blurred.
 *   4. `rolloutIncludes` has not acquired a second implementation.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  includesWith,
  whereWith,
  type Participation,
  type TenantParticipationFilter,
} from "../lib/analytics/rollout";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  FAIL  ${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 1. The two shapes of one decision
// ---------------------------------------------------------------------------------------------

type Tenant = { slug: string; analyticsPausedAt: Date | null };

/**
 * Evaluates the filter the way Postgres would. Written out here rather than imported, on
 * purpose: a check that reused the module's own interpreter would agree with it by construction
 * and prove nothing.
 */
function matchesWhere(where: TenantParticipationFilter, tenant: Tenant): boolean {
  if (where.id && where.id.in.length === 0) return false;
  if (where.analyticsPausedAt === null && tenant.analyticsPausedAt !== null) return false;
  if (where.slug !== undefined && where.slug !== tenant.slug) return false;
  return true;
}

const TENANTS: Tenant[] = [
  { slug: "pilot-store", analyticsPausedAt: null },
  { slug: "other-store", analyticsPausedAt: null },
  { slug: "pilot-store", analyticsPausedAt: new Date() },
  { slug: "paused-other", analyticsPausedAt: new Date() },
];

const ROLLOUTS: Participation[] = [
  { mode: "off" },
  { mode: "pilot", pilotSlug: "pilot-store" },
  { mode: "all" },
];

function agreementChecks() {
  for (const rollout of ROLLOUTS) {
    check(`mode=${rollout.mode}: the filter and the predicate agree on every store`, () => {
      const where = whereWith(rollout);
      for (const tenant of TENANTS) {
        assert.equal(
          matchesWhere(where, tenant),
          includesWith(rollout, tenant),
          `they disagree about ${tenant.slug} (paused=${tenant.analyticsPausedAt !== null}): the ` +
            `filter says ${matchesWhere(where, tenant)}, the predicate says ${includesWith(rollout, tenant)}. ` +
            `A store that is aggregated but not collecting gets a row of zeros, and a row of ` +
            `zeros makes its dashboard say nobody came.`,
        );
      }
    });

    check(`mode=${rollout.mode}: a paused store is always excluded`, () => {
      const where = whereWith(rollout);
      for (const tenant of TENANTS.filter((t) => t.analyticsPausedAt !== null)) {
        assert.equal(matchesWhere(where, tenant), false, `${tenant.slug} is paused and matched`);
        assert.equal(includesWith(rollout, tenant), false, `${tenant.slug} is paused and included`);
      }
    });
  }

  check("off means no store, not every store", () => {
    const where = whereWith({ mode: "off" });
    for (const tenant of TENANTS) {
      assert.equal(matchesWhere(where, tenant), false, `${tenant.slug} matched while mode is off`);
    }
  });

  check("pilot means exactly one store", () => {
    const where = whereWith({ mode: "pilot", pilotSlug: "pilot-store" });
    const matched = TENANTS.filter((t) => matchesWhere(where, t)).map((t) => t.slug);
    assert.deepEqual(
      matched,
      ["pilot-store"],
      `pilot matched ${matched.length} store(s). §7 of the deploy checklist has an operator ` +
        `confirm the pilot store collects and no other store does; the job must honour the same rule.`,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// 2-4. Who uses it, and who must not
// ---------------------------------------------------------------------------------------------

/** Stage walks that are about analytics and must be gated. */
const GATED = [
  { file: "lib/analytics/stages.ts", fn: "tenantsToProcess" },
  { file: "lib/notifications/stages.ts", fn: "ownerTenants" },
];

/**
 * Housekeeping that must keep covering every store, with the reason. Retention deleting an
 * excluded store's expired rows is the point of retention; the rest are not analytics at all.
 */
const UNGATED: Record<string, string> = {
  "new-order-catch-up": "an order is an order whatever the rollout says",
  "delivery-lease-recovery": "a stuck push lease must be recovered for any store",
  "push-cleanup": "an expired device must be cleaned up for any store",
  retention: "an excluded store's expired rows still have to be deleted",
};

function staticChecks() {
  for (const { file, fn } of GATED) {
    check(`${file}: ${fn} uses participationWhere()`, () => {
      const source = read(file);
      const start = source.indexOf(`function ${fn}`);
      assert.notEqual(start, -1, `${fn} not found — rename it here too`);
      const body = source.slice(start, start + 1200);
      assert.match(
        body,
        /where: participationWhere\(\)/,
        `${fn} builds its own tenant filter. Use participationWhere(), or the job and the ` +
          `request paths will disagree about which stores take part.`,
      );
      assert.doesNotMatch(
        body,
        /where: \{\s*analyticsPausedAt/,
        `${fn} still filters on analyticsPausedAt directly, which is the looser definition that ` +
          `caused this check to exist`,
      );
    });
  }

  check("the housekeeping stages are still named and still ungated", () => {
    const sources = read("lib/analytics/stages.ts") + read("lib/notifications/stages.ts");
    for (const [stage, reason] of Object.entries(UNGATED)) {
      assert.ok(
        sources.includes(`name: "${stage}"`),
        `stage "${stage}" is gone from the stage list; this check's exception for it (${reason}) ` +
          `is now a lie and should be removed`,
      );
    }
  });

  check("the decision has one implementation and one env read", () => {
    const source = read("lib/analytics/rollout.ts");
    for (const fn of ["includesWith", "whereWith", "rolloutIncludes", "participationWhere", "current"]) {
      assert.equal(
        source.split(`function ${fn}(`).length - 1,
        1,
        `${fn} is declared more than once`,
      );
    }
    // current() is the single place the environment is consulted. A second read is a third
    // definition waiting to drift from the other two.
    assert.equal(
      (source.match(/env\.ANALYTICS_ROLLOUT_MODE/g) ?? []).length,
      1,
      "ANALYTICS_ROLLOUT_MODE is read more than once in rollout.ts; it belongs only in current()",
    );
    assert.match(
      source,
      /export function rolloutIncludes[\s\S]{0,160}includesWith\(current\(\)/,
      "rolloutIncludes must delegate to includesWith(current()), or the tested core and the " +
        "shipped behaviour are two different things",
    );
    assert.match(
      source,
      /export function participationWhere[\s\S]{0,160}whereWith\(current\(\)/,
      "participationWhere must delegate to whereWith(current())",
    );
  });

  check("nothing outside rollout.ts reads the mode to decide participation", () => {
    const offenders: string[] = [];
    for (const file of [
      "lib/analytics/stages.ts",
      "lib/notifications/stages.ts",
      "lib/analytics/aggregate.ts",
      "lib/analytics/retention.ts",
      "app/admin/(panel)/analytics/page.tsx",
      "app/store/[slug]/layout.tsx",
      "app/store/[slug]/analytics/events/route.ts",
      "app/store/[slug]/analytics/presence/route.ts",
    ]) {
      if (/ANALYTICS_ROLLOUT_MODE|ANALYTICS_PILOT_TENANT_SLUG/.test(read(file))) offenders.push(file);
    }
    assert.deepEqual(
      offenders,
      [],
      `these read the rollout environment directly instead of asking rollout.ts: ${offenders.join(", ")}`,
    );
  });
}

function main() {
  console.log("One definition of analytics participation:\n");
  agreementChecks();
  staticChecks();

  console.log();
  if (failures.length > 0) {
    console.error(`ROLLOUT CHECK FAILED — ${failures.length} of ${passed + failures.length}\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${passed} rollout checks passed.`);
  }
}

try {
  main();
} catch (error) {
  console.error("\nROLLOUT CHECK FAILED\n", error);
  process.exitCode = 1;
}
