/**
 * Configuration: do the documents, the compose file and `lib/env.ts` agree? (D78, P7-20 to P7-22)
 *
 *   pnpm verify:config
 *
 * Static. The failure this guards against has happened twice in this repository and is invisible
 * from the inside both times: **a variable that is documented, set, and never read.**
 *
 * D78 was the first — the master plan named `WEB_PUSH_VAPID_PUBLIC_KEY` while `lib/env.ts`
 * validated `PUSH_VAPID_PUBLIC_KEY`, and because all four push variables are optional by design
 * (P6-31), a deploy that set the documented names would have come up with push silently off and
 * no error anywhere. The second was found while writing Phase 7's commit 8: `docker-compose.yml`
 * passed through none of the `ANALYTICS_*`, `PLATFORM_PRIVACY_*` or `PUSH_*` variables at all.
 * `environment:` is a whitelist, so a value set in Dokploy that is not listed there never
 * reaches the container — and `lib/env.ts` requires three of those in production, which means
 * that deploy would not have booted.
 *
 * So the rule this enforces is: `lib/env.ts` is the only authority on what a variable is called,
 * and everything else — the compose file, `.env.example`, the deploy checklist, §14 of the
 * master plan — is checked against it rather than trusted.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { envSchema } from "../lib/env";

let checks = 0;
let failures = 0;

function check(label: string, detail: string, fn: () => void) {
  try {
    fn();
    checks += 1;
    console.log(`  ok   ${label.padEnd(16)} ${detail}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`  FAIL ${label.padEnd(16)} ${detail}\n       ${message}`);
  }
}

const read = (file: string) => readFileSync(file, "utf8");

const ENV_TS = read("lib/env.ts");
const COMPOSE = read("docker-compose.yml");
const ENV_EXAMPLE = read(".env.example");
const MASTER_PLAN = read("STOREFRONT_ANALYTICS_MASTER_PLAN.md");
const DEPLOY = read("PHASE_7_DEPLOY_CHECKLIST.md");
const HUMAN = read("HUMAN_CHECKLIST.md");
const DOCKPLOY = read("DOCKPLOY_SETUP.md");

/**
 * Every variable `lib/env.ts` reads, taken from the list `load()` builds its input from — the
 * one place that enumerates them rather than the schema object, because that list is what
 * actually decides whether a value reaches the parser.
 */
function envKeys(): string[] {
  const block = ENV_TS.match(/const input = Object\.fromEntries\(\s*\(\s*\[([\s\S]*?)\] as const/);
  assert.ok(block, "could not find load()'s key list in lib/env.ts");
  const keys = [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  // The R2 five are spread in from a shared const (they are also referenced by a refinement).
  if (block[1].includes("...R2_KEYS")) {
    const r2 = ENV_TS.match(/const R2_KEYS = \[([\s\S]*?)\] as const/);
    assert.ok(r2, "R2_KEYS is spread into the list but could not be read");
    keys.push(...[...r2[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]));
  }
  assert.ok(keys.length > 40, `only found ${keys.length} env keys, which is too few to be right`);
  return keys;
}

const KEYS = envKeys();

/** Variables `lib/env.ts` refuses to boot without in production, derived rather than restated. */
function requiredInProduction(): string[] {
  const parsed = envSchema.safeParse({
    NODE_ENV: "production",
    AUTH_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/multitenant",
  });
  assert.equal(parsed.success, false, "a bare production environment should not validate");
  const names = [...new Set(parsed.error!.issues.map((i) => String(i.path[0])))];
  assert.ok(names.length >= 5, `expected several production requirements, got ${names.join(", ")}`);
  return names;
}

const REQUIRED = requiredInProduction();

const composeSets = (key: string) => new RegExp(`^\\s+${key}:`, "m").test(COMPOSE);
const exampleMentions = (key: string) => new RegExp(`^#?\\s*${key}=`, "m").test(ENV_EXAMPLE);

console.log("\nConfiguration: documents vs lib/env.ts\n");

// ---------------------------------------------------------------- the compose whitelist
check("compose-complete", `all ${KEYS.length} variables lib/env.ts reads are passed to the container`, () => {
  const missing = KEYS.filter((k) => !composeSets(k));
  assert.deepEqual(
    missing,
    [],
    `docker-compose.yml does not pass: ${missing.join(", ")} — environment: is a whitelist, so these never reach the app`,
  );
});

check("compose-valid", "no variable is passed as a literal secret instead of an interpolation", () => {
  // A secret written into the compose file is a secret in git history. Every one of these must
  // be ${VAR}, not a value.
  for (const key of ["AUTH_SECRET", "ANALYTICS_SIGNING_SECRET", "PUSH_ENCRYPTION_KEY",
    "PUSH_VAPID_PRIVATE_KEY", "LICENSE_ENCRYPTION_KEY", "LICENSE_HEARTBEAT_SECRET",
    "EDGE_SHARED_SECRET"]) {
    const line = COMPOSE.match(new RegExp(`^\\s+${key}:\\s*(.*)$`, "m"));
    assert.ok(line, `${key} is not in docker-compose.yml`);
    assert.match(line[1].trim(), /^\$\{/, `${key} looks like a literal value in docker-compose.yml`);
  }
});

check("example-complete", "every variable is documented in .env.example", () => {
  const missing = KEYS.filter((k) => !exampleMentions(k));
  assert.deepEqual(missing, [], `.env.example never mentions: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------- the production path
check("dockploy-complete", "DOCKPLOY_SETUP.md's quick reference really is every variable", () => {
  // This document, not docker-compose.yml, is how the app is actually deployed: built from the
  // Dockerfile with its environment set in Dockploy's UI, with the compose file marked
  // "reference only". It listed 8 of these until Phase 7 commit 9 — including none of the three
  // that production refuses to boot without, so a fresh deploy following it would have failed
  // on ANALYTICS_SIGNING_SECRET with nothing to connect it to this document.
  const block = DOCKPLOY.match(/## \*\*Quick Reference: All Environment Variables\*\*\s*```([\s\S]*?)```/);
  assert.ok(block, "could not find the quick-reference block in DOCKPLOY_SETUP.md");
  const missing = KEYS.filter((k) => !new RegExp(`^${k}=`, "m").test(block[1]));
  assert.deepEqual(missing, [], `the quick reference omits: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------- what production demands
check("prod-required", `the ${REQUIRED.length} production requirements are set and written down`, () => {
  for (const key of REQUIRED) {
    assert.ok(composeSets(key), `${key} is required in production but not passed by compose`);
    assert.ok(exampleMentions(key), `${key} is required in production but absent from .env.example`);
    assert.ok(
      DEPLOY.includes(key),
      `${key} is required in production but PHASE_7_DEPLOY_CHECKLIST.md never names it`,
    );
    assert.ok(
      DOCKPLOY.includes(key),
      `${key} is required in production but DOCKPLOY_SETUP.md never names it`,
    );
  }
});

// ---------------------------------------------------------------- D78, the original mismatch
check("push-names", "the four push variables are named as the code reads them, everywhere", () => {
  const real = ["PUSH_VAPID_PUBLIC_KEY", "PUSH_VAPID_PRIVATE_KEY", "PUSH_VAPID_SUBJECT",
    "PUSH_ENCRYPTION_KEY"];
  for (const key of real) {
    assert.ok(KEYS.includes(key), `${key} is not read by lib/env.ts`);
    assert.ok(MASTER_PLAN.includes(key), `the master plan does not name ${key}`);
    assert.ok(DEPLOY.includes(key), `the deploy checklist does not name ${key}`);
  }
  // The names D78 found in §14. They must not come back anywhere somebody would copy a
  // variable from — which is the variable blocks, not the prose. Both D78 itself and §14's
  // correction note quote the old names to say they are wrong, and a check that forbade that
  // would forbid writing down why.
  const configBlocks: Array<readonly [string, string]> = [
    ["§14's environment block", MASTER_PLAN.match(/## 14\. Deployment Configuration[\s\S]*?~~~text([\s\S]*?)~~~/)?.[1] ?? ""],
    ["DOCKPLOY_SETUP.md's quick reference", DOCKPLOY.match(/Quick Reference: All Environment Variables\*\*\s*```([\s\S]*?)```/)?.[1] ?? ""],
    [".env.example", ENV_EXAMPLE],
    ["docker-compose.yml", COMPOSE],
  ];
  for (const ghost of ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY",
    "WEB_PUSH_VAPID_SUBJECT", "PUSH_SUBSCRIPTION_ENCRYPTION_KEY"]) {
    for (const [name, text] of configBlocks) {
      assert.ok(text.length > 0, `${name} could not be read`);
      assert.ok(!text.includes(ghost), `${name} still names ${ghost}, which nothing reads`);
    }
  }
});

// ---------------------------------------------------------------- P7-21, both directions
check("plan-14-real", "§14 of the master plan names no variable the code does not read", () => {
  const block = MASTER_PLAN.match(/## 14\. Deployment Configuration[\s\S]*?~~~text([\s\S]*?)~~~/);
  assert.ok(block, "could not find §14's environment block");
  const named = [...new Set([...block[1].matchAll(/^([A-Z][A-Z0-9_]+)/gm)].map((m) => m[1]))];
  assert.ok(named.length > 10, `only parsed ${named.length} names out of §14`);
  const phantom = named.filter((k) => !KEYS.includes(k));
  assert.deepEqual(
    phantom,
    [],
    `§14 names variables nothing reads: ${phantom.join(", ")} — setting one would do nothing, silently`,
  );
});

check("plan-14-whole", "§14 names every analytics and push variable the code reads", () => {
  const block = MASTER_PLAN.match(/## 14\. Deployment Configuration[\s\S]*?~~~text([\s\S]*?)~~~/)![1];
  const owned = KEYS.filter((k) => k.startsWith("ANALYTICS_") || k.startsWith("PUSH_"));
  const missing = owned.filter((k) => !new RegExp(`^${k}`, "m").test(block));
  assert.deepEqual(missing, [], `§14 omits: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------- P7-22
check("no-public-secret", "nothing is exposed as NEXT_PUBLIC_*", () => {
  // A one-line change can move a secret into the client bundle for good: NEXT_PUBLIC_ values are
  // inlined at build time, so the key would be in every visitor's JavaScript and in the image.
  const hits = [...ENV_TS.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0]);
  assert.deepEqual(hits, [], `lib/env.ts mentions ${hits.join(", ")}`);
  for (const [name, text] of [["docker-compose.yml", COMPOSE], [".env.example", ENV_EXAMPLE]] as const) {
    assert.ok(!text.includes("NEXT_PUBLIC_"), `${name} sets a NEXT_PUBLIC_ variable`);
  }
});

check("vapid-gated", "the VAPID public key is served only from an authenticated screen", () => {
  // It is public by design — it is the subscription's audience, not a secret — but serving it
  // from an open route would hand an unauthenticated caller a way to enumerate whether push is
  // configured, and the master plan's §14 asks for an authenticated endpoint. Both callers are
  // pages behind a role or capability gate.
  for (const file of [
    "app/admin/(panel)/notifications/page.tsx",
    "app/platform/(admin)/notifications/page.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /vapidPublicKey\(\)/, `${file} no longer serves the key`);
    assert.match(
      source,
      /requireCapability\(|requirePlatformAdmin\(/,
      `${file} serves the VAPID key without naming a capability or role`,
    );
  }
  const keys = read("lib/push/keys.ts");
  assert.ok(!keys.includes("NEXT_PUBLIC"), "lib/push/keys.ts exposes the key to the client bundle");
});

// ---------------------------------------------------------------- D79, the rollout stays off
check("rollout-off", "no committed configuration sets the rollout to pilot or all", () => {
  for (const [name, text] of [["docker-compose.yml", COMPOSE], [".env.example", ENV_EXAMPLE]] as const) {
    const assigned = text.match(/^\s*#?\s*ANALYTICS_ROLLOUT_MODE[:=]\s*"?([a-z$][^"\s]*)/m);
    assert.ok(assigned, `${name} does not mention ANALYTICS_ROLLOUT_MODE`);
    assert.ok(
      !/^(pilot|all)$/.test(assigned[1]),
      `${name} ships ANALYTICS_ROLLOUT_MODE=${assigned[1]}; the merge happens at off (D79)`,
    );
  }
});

// ---------------------------------------------------------------- the runbook is runnable
check("deploy-order", "the checklist goes off -> verify -> pilot -> all, and can be rolled back", () => {
  // By section, not by first mention of each string: the opening paragraph names the
  // destination (`all`) before any step, which is correct for a reader and would fail a naive
  // ordering check.
  const pilot = DEPLOY.indexOf("Switching to `pilot`");
  const all = DEPLOY.indexOf("Switching to `all`");
  assert.ok(pilot > -1, "no section for switching to pilot");
  assert.ok(all > pilot, "switching to `all` is not after switching to `pilot` (D79)");
  assert.ok(
    DEPLOY.slice(0, pilot).includes("ANALYTICS_ROLLOUT_MODE=off"),
    "the deploy must happen at `off` and be verified before the pilot is switched on (D79)",
  );
  assert.match(DEPLOY, /## .*Rollback/i, "no rollback section");
  assert.match(DEPLOY, /TRUSTED_PROXY_COUNT/, "does not mention the proxy count the edge needs");
});

check("dry-run", "the retention dry run the checklist asks for is a thing the code can do", () => {
  // P7-26 is an instruction to a person; an instruction naming a flag that does not exist is
  // worse than none, because it will be followed.
  assert.match(DEPLOY, /--dry-run|ANALYTICS_RETENTION_DRY_RUN/, "the checklist does not say how");
  const scheduled = read("scripts/analytics-scheduled.ts");
  assert.match(scheduled, /--dry-run/, "scripts/analytics-scheduled.ts has no --dry-run flag");
  assert.match(
    scheduled,
    /ANALYTICS_RETENTION_DRY_RUN/,
    "no environment switch for a dry run, which is the only way to do it from a scheduler",
  );
});

check("human-tasks", "HUMAN_CHECKLIST.md covers the things no script can do", () => {
  for (const [what, pattern] of [
    ["the test domain", /domain/i],
    ["the production keys", /PUSH_VAPID_PRIVATE_KEY/],
    ["the app_user queries", /app_user/],
    ["the retention dry run", /dry run/i],
    ["the legal review", /legal/i],
    ["real devices", /iPhone|Android/],
  ] as const) {
    assert.match(HUMAN, pattern, `HUMAN_CHECKLIST.md does not cover ${what}`);
  }
  // Every line that is a task must be a checkbox, or it is prose somebody will read past.
  assert.ok(HUMAN.split("\n").filter((l) => l.startsWith("- [ ]")).length >= 10,
    "fewer than ten tickable items, which is fewer than §8 of the plan lists");
});

check("exit-criteria", "D80's pilot exit criteria are numeric and committed before the pilot", () => {
  const plan = read("PHASE_7_PLAN.md");
  const d80 = plan.match(/\*\*D80[\s\S]*?(?=\n\*\*D8[1-9])/);
  assert.ok(d80, "D80 is not in PHASE_7_PLAN.md");
  const numbers = d80[0].match(/\b\d+(\.\d+)?\s*(%|minutes|orders|days)/g) ?? [];
  assert.ok(
    numbers.length >= 4,
    `D80 states ${numbers.length} numeric criteria; "the numbers look right" is not an exit criterion`,
  );
  assert.ok(DEPLOY.includes("D80"), "the deploy checklist does not point at the exit criteria");
});

console.log(`\n${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
