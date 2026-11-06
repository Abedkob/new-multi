/**
 * Every command a runbook tells an operator to run INSIDE the container must exist in the
 * container (`pnpm verify:container-commands`). Static; no server, no database.
 *
 * The failure this exists for. For seven phases, four documents told an operator to schedule
 * `pnpm analytics:scheduled` in the production container every five minutes. It cannot run
 * there and never could: the Dockerfile's runtime stage copies Next's standalone output, three
 * global npm packages and exactly one script, so there is no `pnpm`, no `tsx`, no `scripts/`
 * directory and no TypeScript source. The scheduled command therefore never ran once.
 * `AnalyticsScheduledRun` was empty, every aggregate was missing, and the dashboard's "nothing
 * has been measured yet" panel named the two conditions it does check — rollout and consent —
 * so an operator with both satisfied was sent looking in the wrong place. The rollout being
 * `off` is the only reason nobody caught it earlier: an empty report was the expected answer.
 *
 * Documentation drift is exactly what this project already distrusts — `verify:config` compares
 * every deployment document against `lib/env.ts` rather than trusting any of them — and the same
 * reasoning applies here. A corrected document with no check is a document with the same shelf
 * life as the one it replaced.
 *
 * What this checks, all derived from the Dockerfile rather than restated:
 *
 *   1. The runtime stage builds and copies the job bundle, and `package.json` defines the script
 *      that builds it. (The bundle carries its own dependencies — see scripts/build-job.mjs for
 *      why almost nothing is left external.)
 *   2. Every `node <path>` command in an operator runbook names a file the runtime stage copies.
 *   3. No runbook's fenced command runs the scheduled command through `pnpm` — the one mistake
 *      that was actually made.
 *   4. No `docker exec` line in a runbook invokes `pnpm`.
 *
 * What it does NOT check, said plainly: it cannot tell "run this on your laptop" from "run this
 * in the container" for an arbitrary command, because the documents do not mark that
 * distinction, and `BASE_URL=… pnpm load-test` is a legitimate instruction to run on a
 * developer machine. So rules 2–4 are the shapes that have teeth without false positives, not a
 * general proof. A new container command of a different shape still needs a check of its own.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/** Runbooks an operator follows against a deployment. Plans and acceptance records are history. */
const OPERATOR_DOCS = [
  "PHASE_7_DEPLOY_CHECKLIST.md",
  "HUMAN_CHECKLIST.md",
  "DEPLOYMENT_CHECKLIST.md",
  "DOCKPLOY_SETUP.md",
  "PRODUCTION.md",
  "ANALYTICS_DEPLOY_CHECKLIST.md",
  "PHASE_4_ACCEPTANCE.md",
];

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

const dockerfile = read("Dockerfile");

/**
 * Only the final stage matters: a file copied in the builder is not in the shipped image. The
 * runner stage runs from its `FROM … AS runner` line to the end of the file.
 */
const runnerStage = (() => {
  const index = dockerfile.search(/^FROM .* AS runner$/m);
  assert.notEqual(index, -1, "Dockerfile has no `FROM … AS runner` stage");
  return dockerfile.slice(index);
})();

/** Destination paths the runtime stage copies, normalized to repository-root-relative. */
const copiedIntoImage = (() => {
  const paths = new Set<string>();
  for (const line of runnerStage.split("\n")) {
    const match = /^COPY\s+(?:--from=\S+\s+)?(\S+)\s+(\S+)\s*$/.exec(line.trim());
    if (!match) continue;
    const dest = match[2].replace(/^\.\//, "").replace(/\/$/, "");
    paths.add(dest);
  }
  return paths;
})();

function isInImage(commandPath: string): boolean {
  const normalized = commandPath.replace(/^\.\//, "");
  if (copiedIntoImage.has(normalized)) return true;
  // A directory copy covers the files under it.
  return [...copiedIntoImage].some((dest) => normalized.startsWith(`${dest}/`));
}

/** Fenced code blocks, which is where a document gives a command rather than discusses one. */
function fencedCommands(markdown: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line.trim()) lines.push(line.trim());
  }
  return lines;
}

console.log("The image can run what the runbooks tell an operator to run:\n");

check("the Dockerfile builds the job bundle", () => {
  assert.match(
    dockerfile,
    /RUN pnpm run build:job/,
    "the builder stage must run `pnpm run build:job`, or the bundle the runbooks name is never produced",
  );
});

check("package.json defines build:job", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["build:job"], "package.json has no build:job script");
  assert.ok(
    pkg.scripts["verify:container-commands"],
    "package.json must register this check, or nothing runs it",
  );
});

check("the runtime stage copies the job bundle", () => {
  assert.ok(
    isInImage("dist/analytics-scheduled.mjs"),
    "the runtime stage does not copy dist/analytics-scheduled.mjs; the scheduled command would " +
      "have no entrypoint, which is the exact defect this check exists for",
  );
});

for (const doc of OPERATOR_DOCS) {
  const commands = fencedCommands(read(doc));

  check(`${doc}: every \`node <path>\` names a file in the image`, () => {
    for (const command of commands) {
      const match = /\bnode\s+((?:dist|scripts)\/\S+)/.exec(command);
      if (!match) continue;
      assert.ok(
        isInImage(match[1]),
        `names \`node ${match[1]}\`, which the runtime stage does not copy into the image`,
      );
    }
  });

  check(`${doc}: the scheduled command is not run through pnpm`, () => {
    for (const command of commands) {
      assert.ok(
        !/pnpm\s+(run\s+)?analytics:scheduled/.test(command),
        `a fenced command runs \`pnpm analytics:scheduled\`, which does not exist in the image. ` +
          `Use \`node dist/analytics-scheduled.mjs\` for a container instruction.`,
      );
    }
  });

  check(`${doc}: no \`docker exec\` invokes pnpm`, () => {
    for (const command of commands) {
      if (!command.includes("docker exec")) continue;
      assert.ok(
        !/\bpnpm\b/.test(command),
        `\`${command}\` runs pnpm inside the container, which is not installed in the runtime stage`,
      );
    }
  });
}

console.log();
if (failures.length > 0) {
  console.error(`CONTAINER COMMAND CHECK FAILED — ${failures.length} of ${passed + failures.length}\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`All ${passed} container-command checks passed.`);
}
