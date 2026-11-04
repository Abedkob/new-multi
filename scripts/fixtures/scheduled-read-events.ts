/**
 * A fixture, not a feature. `pnpm verify:scheduled` spawns this as a SUBPROCESS to prove P4-05.
 *
 * Why a subprocess at all: every verification script imports `scripts/_owner`, which points
 * APP_DATABASE_URL at the owner role so fixtures can be set up across tenants. The owner is a
 * superuser, so a `REVOKE ... FROM app_user` cannot touch it — in-process, the fault injection
 * would be invisible and the check would pass having proven nothing.
 *
 * So the parent revokes the privilege and runs the job HERE, in a process that connects as
 * app_user, exactly as the real scheduled container does. The failure is then real.
 *
 * Deliberately not registered in `scripts/analytics-scheduled.ts`: production has no business
 * carrying a stage whose only purpose is to read a table and be denied.
 */

import "dotenv/config";
import { runScheduled, type Stage } from "../../lib/analytics/scheduled";
import { disconnectJobPrisma, jobPrisma } from "../../lib/prisma-job";

const readEvents: Stage = {
  name: "verify-reads-events",
  run: async () => ({ items: await jobPrisma().analyticsEvent.count() }),
};

async function main() {
  const report = await runScheduled([readEvents], { log: () => {} });
  // The parent reads this line; everything it asserts has to be here, because it cannot see
  // into this process any other way.
  console.log(JSON.stringify(report));
  if (report.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ threw: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => disconnectJobPrisma());
