-- One process's ingestion counters, flushed (§11.10, D34).
--
-- No tenantId and no RLS: these are the platform's operational numbers about its own ingestion,
-- and their whole purpose is to be comparable across stores and instances.
--
-- Written by the web process that owns the counters, because nothing else can see them: they
-- live in that process's memory and the scheduled command runs in another container. An
-- instance with no traffic writes no row, so "no rows" means silence rather than failure.

CREATE TABLE "AnalyticsOperationalMetric" (
    "id" TEXT NOT NULL,
    "instance" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "attemptedBatches" INTEGER NOT NULL DEFAULT 0,
    "acceptedBatches" INTEGER NOT NULL DEFAULT 0,
    "storedEvents" INTEGER NOT NULL DEFAULT 0,
    "rejectedOwnershipEvents" INTEGER NOT NULL DEFAULT 0,
    "policyDrops" INTEGER NOT NULL DEFAULT 0,
    "operationalDrops" INTEGER NOT NULL DEFAULT 0,
    "contractRejections" INTEGER NOT NULL DEFAULT 0,
    "policyDetail" JSONB NOT NULL DEFAULT '{}',
    "operationalDetail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsOperationalMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsOperationalMetric_at_idx" ON "AnalyticsOperationalMetric"("at");
CREATE INDEX "AnalyticsOperationalMetric_instance_at_idx" ON "AnalyticsOperationalMetric"("instance", "at");
