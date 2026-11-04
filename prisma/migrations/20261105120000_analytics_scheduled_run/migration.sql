-- Bookkeeping for `pnpm analytics:scheduled` (§10).
--
-- No tenantId and no RLS, on purpose: this is the platform's record of its own job, not a
-- store's data, and the job crosses tenants by nature. Everything in it is operational.

CREATE TYPE "AnalyticsRunStatus" AS ENUM ('RUNNING', 'OK', 'FAILED', 'EXPIRED');

CREATE TABLE "AnalyticsScheduledRun" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "status" "AnalyticsRunStatus" NOT NULL DEFAULT 'RUNNING',
    "items" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "error" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsScheduledRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsScheduledRun_stage_startedAt_idx" ON "AnalyticsScheduledRun"("stage", "startedAt");
CREATE INDEX "AnalyticsScheduledRun_status_leaseUntil_idx" ON "AnalyticsScheduledRun"("status", "leaseUntil");
