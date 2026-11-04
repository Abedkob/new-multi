-- Aggregates (§9.3, §10, Phase 4).
--
-- Reports read these and never the raw events: a merchant page must not scan millions of rows,
-- raw events are deleted after 90 days while these are kept for 24 months, and a figure
-- computed once is a figure two reports cannot disagree about.
--
-- Every table is a RECOMPUTE target, never an increment: a run deletes a local day's rows and
-- writes them again from the raw data, so late events and order-status changes are
-- self-correcting and the job is safely re-runnable.
--
-- localDay is a DATE in the STORE's zone; timeZone records which zone computed the row, so a
-- store that changes zone later produces visibly different rows instead of silently rewriting
-- its own history.

CREATE TABLE "AnalyticsDailyMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "localDay" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "newVisitors" INTEGER NOT NULL DEFAULT 0,
    "productViewSessions" INTEGER NOT NULL DEFAULT 0,
    "addToCartSessions" INTEGER NOT NULL DEFAULT 0,
    "cartViewSessions" INTEGER NOT NULL DEFAULT 0,
    "checkoutSessions" INTEGER NOT NULL DEFAULT 0,
    "searchSessions" INTEGER NOT NULL DEFAULT 0,
    "whatsappClickSessions" INTEGER NOT NULL DEFAULT 0,
    "whatsappPotentialValueCents" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "orderValueCents" INTEGER NOT NULL DEFAULT 0,
    "cancelledOrders" INTEGER NOT NULL DEFAULT 0,
    "cancelledOrderValueCents" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsHourlyMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "localDay" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "orderValueCents" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsHourlyMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsProductDaily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "localDay" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "viewSessions" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "addToCartSessions" INTEGER NOT NULL DEFAULT 0,
    "whatsappClickSessions" INTEGER NOT NULL DEFAULT 0,
    "purchasingSessions" INTEGER NOT NULL DEFAULT 0,
    "unitsOrdered" INTEGER NOT NULL DEFAULT 0,
    "orderValueCents" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsProductDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsSearchDaily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "localDay" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "searchSessions" INTEGER NOT NULL DEFAULT 0,
    "noResultSearches" INTEGER NOT NULL DEFAULT 0,
    "resultClickSessions" INTEGER NOT NULL DEFAULT 0,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSearchDaily_pkey" PRIMARY KEY ("id")
);

-- source/medium/campaign default to '' rather than NULL on purpose: they are part of a unique
-- key, and in Postgres every NULL is distinct from every other, so a nullable key would let the
-- same channel insert itself twice and make the recompute non-idempotent.
CREATE TABLE "AnalyticsAcquisitionDaily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "localDay" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "medium" TEXT NOT NULL DEFAULT '',
    "campaign" TEXT NOT NULL DEFAULT '',
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "lastTouchOrders" INTEGER NOT NULL DEFAULT 0,
    "lastTouchOrderValueCents" INTEGER NOT NULL DEFAULT 0,
    "firstTouchOrders" INTEGER NOT NULL DEFAULT 0,
    "firstTouchOrderValueCents" INTEGER NOT NULL DEFAULT 0,
    "whatsappClickSessions" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAcquisitionDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsAggregationCursor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "lastComputedDay" DATE,
    "lastRunAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "AnalyticsAggregationCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsDailyMetric_tenantId_localDay_key" ON "AnalyticsDailyMetric"("tenantId", "localDay");
CREATE INDEX "AnalyticsDailyMetric_tenantId_localDay_idx" ON "AnalyticsDailyMetric"("tenantId", "localDay");
CREATE UNIQUE INDEX "AnalyticsHourlyMetric_tenantId_localDay_hour_key" ON "AnalyticsHourlyMetric"("tenantId", "localDay", "hour");
CREATE INDEX "AnalyticsHourlyMetric_tenantId_localDay_idx" ON "AnalyticsHourlyMetric"("tenantId", "localDay");
CREATE UNIQUE INDEX "AnalyticsProductDaily_tenantId_localDay_productId_key" ON "AnalyticsProductDaily"("tenantId", "localDay", "productId");
CREATE INDEX "AnalyticsProductDaily_tenantId_localDay_idx" ON "AnalyticsProductDaily"("tenantId", "localDay");
CREATE INDEX "AnalyticsProductDaily_tenantId_productId_localDay_idx" ON "AnalyticsProductDaily"("tenantId", "productId", "localDay");
CREATE UNIQUE INDEX "AnalyticsSearchDaily_tenantId_localDay_phrase_key" ON "AnalyticsSearchDaily"("tenantId", "localDay", "phrase");
CREATE INDEX "AnalyticsSearchDaily_tenantId_localDay_idx" ON "AnalyticsSearchDaily"("tenantId", "localDay");
CREATE UNIQUE INDEX "AnalyticsAcquisitionDaily_tenantId_localDay_sourceKind_source_medium_campaign_key" ON "AnalyticsAcquisitionDaily"("tenantId", "localDay", "sourceKind", "source", "medium", "campaign");
CREATE INDEX "AnalyticsAcquisitionDaily_tenantId_localDay_idx" ON "AnalyticsAcquisitionDaily"("tenantId", "localDay");
CREATE UNIQUE INDEX "AnalyticsAggregationCursor_tenantId_stage_key" ON "AnalyticsAggregationCursor"("tenantId", "stage");
CREATE INDEX "AnalyticsAggregationCursor_stage_lastRunAt_idx" ON "AnalyticsAggregationCursor"("stage", "lastRunAt");

ALTER TABLE "AnalyticsDailyMetric" ADD CONSTRAINT "AnalyticsDailyMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsHourlyMetric" ADD CONSTRAINT "AnalyticsHourlyMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsProductDaily" ADD CONSTRAINT "AnalyticsProductDaily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsSearchDaily" ADD CONSTRAINT "AnalyticsSearchDaily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsAcquisitionDaily" ADD CONSTRAINT "AnalyticsAcquisitionDaily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsAggregationCursor" ADD CONSTRAINT "AnalyticsAggregationCursor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Row-Level Security ---------------------------------------------------------------------
-- Same shape as every other tenant-scoped table: the runtime role sees only the tenant set by
-- withTenant(), and withBypass() is the one controlled way past it. The scheduled job sets the
-- same session variable per tenant (lib/prisma-job.ts's withJobTenant), so a bug in the job
-- cannot write one store's numbers into another's row.

ALTER TABLE "AnalyticsDailyMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsDailyMetric" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsDailyMetric"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsHourlyMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsHourlyMetric" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsHourlyMetric"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsProductDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsProductDaily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsProductDaily"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsSearchDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsSearchDaily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsSearchDaily"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsAcquisitionDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsAcquisitionDaily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsAcquisitionDaily"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsAggregationCursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsAggregationCursor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsAggregationCursor"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
