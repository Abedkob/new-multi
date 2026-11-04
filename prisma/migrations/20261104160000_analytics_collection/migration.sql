-- Storefront analytics, Phase 2: visitors, sessions and events.
--
-- The first tables that hold behavioural data. Every row here is downstream of a visitor having
-- granted the analytics category in Phase 1 — the endpoint refuses to write without it.
--
-- Cascade runs Tenant -> Visitor -> Session -> Event, so deleting a store takes all of it.
-- Sessions and events reach their tenant through composite (id, tenantId) foreign keys, the
-- same shape CouponProduct uses: a session cannot reference a visitor in another store, and an
-- event cannot reference a session in another store, whatever application code does.

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PAGE_VIEW', 'PRODUCT_VIEW', 'SEARCH_SUBMITTED', 'SEARCH_RESULT_CLICK', 'ADD_TO_CART', 'REMOVE_FROM_CART', 'CART_VIEW', 'CHECKOUT_STARTED', 'WHATSAPP_ORDER_CLICK');

-- CreateTable
CREATE TABLE "AnalyticsVisitor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "country" TEXT,
    "deviceClass" TEXT,
    "firstSource" TEXT,
    "firstMedium" TEXT,
    "firstCampaign" TEXT,

    CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "country" TEXT,
    "deviceClass" TEXT,
    "landingPageKind" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "hasAdClick" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "pageKind" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER,
    "searchQuery" TEXT,
    "resultCount" INTEGER,
    "valueCents" INTEGER,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_tenantId_lastSeenAt_idx" ON "AnalyticsVisitor"("tenantId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsVisitor_id_tenantId_key" ON "AnalyticsVisitor"("id", "tenantId");

-- CreateIndex
CREATE INDEX "AnalyticsSession_tenantId_startedAt_idx" ON "AnalyticsSession"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_tenantId_lastActivityAt_idx" ON "AnalyticsSession"("tenantId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSession_id_tenantId_key" ON "AnalyticsSession"("id", "tenantId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_tenantId_occurredAt_idx" ON "AnalyticsEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_tenantId_type_occurredAt_idx" ON "AnalyticsEvent"("tenantId", "type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_tenantId_eventId_key" ON "AnalyticsEvent"("tenantId", "eventId");

-- AddForeignKey
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_visitorId_tenantId_fkey" FOREIGN KEY ("visitorId", "tenantId") REFERENCES "AnalyticsVisitor"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_sessionId_tenantId_fkey" FOREIGN KEY ("sessionId", "tenantId") REFERENCES "AnalyticsSession"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_visitorId_tenantId_fkey" FOREIGN KEY ("visitorId", "tenantId") REFERENCES "AnalyticsVisitor"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---- Row-Level Security ---------------------------------------------------------------------
-- Same shape as every other tenant-scoped table: the runtime role sees only the tenant set by
-- withTenant(), and withBypass() is the one controlled way past it.

ALTER TABLE "AnalyticsVisitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsVisitor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsVisitor"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsSession"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AnalyticsEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsEvent"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
