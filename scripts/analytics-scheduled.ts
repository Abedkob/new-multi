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
 * The orchestration shipped before any stage did — one run at a time, a failure that stays
 * inside its stage, a crashed run that recovers — and `pnpm verify:scheduled` still proves it
 * with injected stages that succeed, throw and run long on purpose, so none of those checks
 * depends on what the real stages happen to do.
 */

import "dotenv/config";
import { runScheduled, type Stage } from "../lib/analytics/scheduled";
import { ANALYTICS_STAGES } from "../lib/analytics/stages";
import { disconnectJobPrisma } from "../lib/prisma-job";

const STAGES: Stage[] = [
  ...ANALYTICS_STAGES,
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
