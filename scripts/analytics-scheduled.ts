/**
 * The scheduled command Dockploy runs every five minutes (§10): `pnpm analytics:scheduled`.
 *
 *   pnpm analytics:scheduled                 # everything that is due
 *   pnpm analytics:scheduled --dry-run       # change nothing, report what would change (D35)
 *   pnpm analytics:scheduled --stage=<name>  # one stage, for an operator chasing something
 *
 * Exit codes are what a scheduler acts on:
 *   0  the run did its work, or another run already held the lock (both normal)
 *   1  at least one stage failed
 *
 * The stage list is empty in this commit, and that is deliberate. The orchestration — one run
 * at a time, a failure that stays inside its stage, a crashed run that recovers — is what the
 * rest of Phase 4 is built on, so it ships and is verified first, with stages injected by
 * `pnpm verify:scheduled` that succeed, throw and run long on purpose. Real stages arrive with
 * the features that need them.
 */

import "dotenv/config";
import { runScheduled, type Stage } from "../lib/analytics/scheduled";
import { disconnectJobPrisma } from "../lib/prisma-job";

const STAGES: Stage[] = [
  // Phase 4, in order of arrival:
  //   aggregate-recompute   (commit 5)
  //   order-status-sweep    (commit 5, D33)
  //   nightly-backfill      (commit 5, D33)
  //   retention             (commit 6, D35)
  //   health-evaluate       (commit 7, D34)
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || process.env.ANALYTICS_RETENTION_DRY_RUN === "true";
  const only = args.find((a) => a.startsWith("--stage="))?.slice("--stage=".length);

  const stages = only ? STAGES.filter((s) => s.name === only) : STAGES;
  if (only && stages.length === 0) {
    console.error(`No stage named "${only}". Known stages: ${STAGES.map((s) => s.name).join(", ") || "(none yet)"}`);
    process.exitCode = 1;
    return;
  }

  const report = await runScheduled(stages, { dryRun });
  if (!report.acquired) return;

  if (stages.length === 0) {
    console.log("[analytics:scheduled] no stages registered yet; nothing to do");
  }
  console.log(
    `[analytics:scheduled] ${report.stages.length} stage(s), ${report.failed} failed` +
      (dryRun ? " (dry run: nothing was changed)" : ""),
  );
  if (report.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[analytics:scheduled] the run itself failed:", error);
    process.exitCode = 1;
  })
  .finally(() => disconnectJobPrisma());
