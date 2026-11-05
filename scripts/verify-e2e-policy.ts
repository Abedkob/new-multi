/**
 * The custom-domain testing policy, enforced (pnpm verify:e2e-policy).
 *
 * The rule, from 2026-11-04: EVERY end-to-end suite exercises its feature on a custom domain as
 * well as the shared host, and A LEG THAT CANNOT RUN IS A FAILURE. It does not skip, and it
 * never reports a skip as a pass.
 *
 * The rule exists because of two bugs in two consecutive phases, both total data loss, both
 * invisible to every shared-host check:
 *
 *   - Phase 2: a consent cookie scoped to /store/<slug> never reached the server at a domain
 *     root, so a store on its own domain could not record a consent decision at all.
 *   - Phase 3: crypto.randomUUID is secure-context-only, so off localhost the tracker produced
 *     event ids the contract refuses — every batch 400'd and was silently lost.
 *
 * The Phase 3 one was caught only because a plan review asked for the custom-domain leg, and
 * the leg's FIRST run skipped itself with a plausible-sounding excuse. A skip is not a neutral
 * outcome; it is a green suite that tested nothing.
 *
 * Static, so it needs no server and belongs in every run:
 *   pnpm verify:e2e-policy
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const E2E_DIR = "scripts/e2e";

/** Shared machinery, not suites. */
const INFRASTRUCTURE = new Set(["browser.ts", "custom-domain.ts"]);

/**
 * Suites that predate the policy and do not have their leg yet.
 *
 * EMPTY since 2026-11-05, and it stays that way: every suite in scripts/e2e now exercises its
 * feature on a store's own domain. The set is kept rather than deleted because it is the only
 * thing that makes the gap visible — a suite added without a leg fails rule 1 below, and the
 * only way to quiet that is to write the leg, not to list the file here. If you are reading
 * this because you want to add an entry: the nine that were here were paid off before the
 * Phase 7 pilot, and the two bugs that bought the policy are described above.
 */
const PENDING_LEG = new Set<string>();

let failures = 0;
let checks = 0;

function ok(label: string, detail: string) {
  checks += 1;
  console.log(`  ok  ${label}  ${detail}`);
}

function fail(label: string, detail: string) {
  failures += 1;
  console.error(`  FAIL ${label}  ${detail}`);
}

const config = readFileSync("next.config.ts", "utf8");
const suites = readdirSync(E2E_DIR)
  .filter((f) => f.endsWith(".ts") && !INFRASTRUCTURE.has(f))
  .sort();

console.log(`\nE2E custom-domain policy — ${suites.length} suites\n`);

// ---------------------------------------------------------------- rule 1: a leg, or a known gap
for (const file of suites) {
  const source = readFileSync(path.join(E2E_DIR, file), "utf8");
  const hasLeg = source.includes("host-resolver-rules") || source.includes("onCustomDomain");
  const pending = PENDING_LEG.has(file);

  if (hasLeg && pending) {
    fail(
      "leg-list",
      `${file} now has a custom-domain leg — remove it from PENDING_LEG in this script so the ` +
        "list keeps shrinking and a regression can be seen",
    );
  } else if (hasLeg) {
    ok("leg", `${file} runs against a custom domain`);
  } else if (pending) {
    console.log(`  --  gap   ${file} has no custom-domain leg yet (due before the Phase 7 pilot)`);
  } else {
    fail(
      "leg",
      `${file} has no custom-domain leg. Every suite must exercise its feature on a store's own ` +
        "domain too: cookie paths, the secure context and the proxy's host routing all differ " +
        "there. See scripts/e2e/custom-domain.ts",
    );
  }
}

for (const file of PENDING_LEG) {
  if (!suites.includes(file)) {
    fail("leg-list", `PENDING_LEG names ${file}, which no longer exists — remove it`);
  }
}

// ---------------------------------------------------------------- rule 2: no suite may skip
// Blunt on purpose. A custom-domain leg is the one place in this repo where "it could not run"
// has twice been written down as acceptable, and both times it hid a defect. If a future suite
// needs the word for an unrelated reason, that is the moment to argue for it in review — not
// something a grep should quietly allow.
for (const file of suites) {
  const source = readFileSync(path.join(E2E_DIR, file), "utf8");
  const lines = source.split("\n");
  const offenders = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /skip/i.test(line));
  if (offenders.length === 0) {
    ok("no-skip", `${file} has no skip path`);
  } else {
    for (const { n } of offenders) {
      fail(
        "no-skip",
        `${file}:${n} mentions skipping. A leg that cannot run must FAIL — a skip is a green ` +
          "suite that tested nothing",
      );
    }
  }
}

// ---------------------------------------------------- rule 3: the hostname must be served its JS
// next dev withholds JavaScript from an origin that is not in allowedDevOrigins, which makes
// every interactive assertion fail for a reason unrelated to the feature. Phase 3 lost a run to
// exactly this and misdiagnosed it as a cookie problem.
const HOST = /"([a-z0-9-]+\.test)"/g;
for (const file of suites) {
  const source = readFileSync(path.join(E2E_DIR, file), "utf8");
  const hosts = [...new Set([...source.matchAll(HOST)].map((m) => m[1]))];
  if (hosts.length === 0) continue;
  for (const host of hosts) {
    if (!config.includes(`"${host}"`)) {
      fail(
        "dev-origin",
        `${file} uses ${host}, which is missing from allowedDevOrigins in next.config.ts`,
      );
    } else {
      ok("dev-origin", `${host} is allowed in next.config.ts`);
    }
  }
  if (!source.includes("assertDevOriginAllowed")) {
    fail(
      "dev-origin",
      `${file} drives a custom domain without calling assertDevOriginAllowed() — the missing ` +
        "origin must be reported where it happens, not inferred from twenty failed assertions",
    );
  } else {
    ok("dev-origin", `${file} checks its origin is allowed before driving it`);
  }
}

console.log(
  `\n${checks} checks passed, ${failures} failed` +
    (PENDING_LEG.size ? `, ${PENDING_LEG.size} suites still owe a leg` : ""),
);
process.exit(failures === 0 ? 0 : 1);
