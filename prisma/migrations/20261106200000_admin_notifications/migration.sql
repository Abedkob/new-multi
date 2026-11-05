-- Phase 6: the admin notification data model (§9.6-§9.8, §11).
--
-- Five tables and two preference tables. The three that carry the weight:
--
--   AdminNotification        one logical "this person was told this", with a UNIQUE dedupeKey
--   AdminNotificationOrder   UNIQUE (recipientUserId, orderId) -- one order, announced once
--   AdminNotificationDelivery  one row per device, with a lease so two senders cannot both send
--
-- The unique constraint on (recipientUserId, orderId) is what makes deduplication a database
-- guarantee rather than a timing hope: the instant post-commit path and the scheduled catch-up
-- both insert there, and exactly one wins (D52).
--
-- RLS: every table below that carries a tenantId gets a FORCED policy, like every other
-- store-owned table. A PLATFORM row has tenantId NULL, so `tenantId = current_setting(...)` is
-- never true for it and it is reachable only under withBypass -- which is the intent: a platform
-- admin's own device is not a store's data. The two preference tables are keyed by user with no
-- tenantId, like User itself, and are therefore not under RLS.
--
-- AdminNotificationDelivery carries a denormalised tenantId for no reason other than to be
-- coverable by a policy (§9.9). It is written from its notification and never read as the
-- source of truth for which store a notification belongs to.

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('OWNER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_ORDER', 'WEEKLY_SUMMARY', 'PRODUCT_ALERT', 'FUNNEL_ALERT', 'SEARCH_ALERT', 'TRAFFIC_ALERT', 'INACTIVE_STORE', 'STORE_DECLINE', 'INGESTION_HEALTH', 'CONTRACT_REJECTION', 'AGGREGATION_HEALTH', 'REDIS_FALLBACK', 'PUSH_DELIVERY', 'PLATFORM_WEEKLY_SUMMARY');

-- CreateEnum
CREATE TYPE "NotificationDeliveryState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminLocale" TEXT;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "audience" "NotificationAudience" NOT NULL,
    "endpointCiphertext" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "p256dhCiphertext" TEXT NOT NULL,
    "authCiphertext" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "deviceClass" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newOrders" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummary" BOOLEAN NOT NULL DEFAULT true,
    "productAlerts" BOOLEAN NOT NULL DEFAULT true,
    "funnelAlerts" BOOLEAN NOT NULL DEFAULT true,
    "searchAlerts" BOOLEAN NOT NULL DEFAULT true,
    "trafficAlerts" BOOLEAN NOT NULL DEFAULT true,
    "showOrderAmount" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inactiveStoreAlerts" BOOLEAN NOT NULL DEFAULT true,
    "storeDeclineAlerts" BOOLEAN NOT NULL DEFAULT true,
    "ingestionHealthAlerts" BOOLEAN NOT NULL DEFAULT true,
    "aggregationHealthAlerts" BOOLEAN NOT NULL DEFAULT true,
    "redisFallbackAlerts" BOOLEAN NOT NULL DEFAULT true,
    "pushDeliveryAlerts" BOOLEAN NOT NULL DEFAULT true,
    "weeklyPlatformSummary" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "dedupeKey" TEXT NOT NULL,
    "cooldownKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotificationOrder" (
    "notificationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotificationOrder_pkey" PRIMARY KEY ("notificationId","orderId")
);

-- CreateTable
CREATE TABLE "AdminNotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "tenantId" TEXT,
    "state" "NotificationDeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCategory" TEXT,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAlertState" (
    "id" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "entityKey" TEXT NOT NULL,
    "tenantId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'clear',
    "enteredAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationAlertState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_audience_idx" ON "PushSubscription"("userId", "audience");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_idx" ON "PushSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "PushSubscription_audience_expiredAt_revokedAt_idx" ON "PushSubscription"("audience", "expiredAt", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerNotificationPreference_userId_key" ON "OwnerNotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformNotificationPreference_userId_key" ON "PlatformNotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotification_dedupeKey_key" ON "AdminNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "AdminNotification_recipientUserId_createdAt_idx" ON "AdminNotification"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNotification_tenantId_type_createdAt_idx" ON "AdminNotification"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNotification_cooldownKey_createdAt_idx" ON "AdminNotification"("cooldownKey", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNotificationOrder_tenantId_createdAt_idx" ON "AdminNotificationOrder"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationOrder_recipientUserId_orderId_key" ON "AdminNotificationOrder"("recipientUserId", "orderId");

-- CreateIndex
CREATE INDEX "AdminNotificationDelivery_state_leaseExpiresAt_idx" ON "AdminNotificationDelivery"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AdminNotificationDelivery_tenantId_state_idx" ON "AdminNotificationDelivery"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationDelivery_notificationId_subscriptionId_key" ON "AdminNotificationDelivery"("notificationId", "subscriptionId");

-- CreateIndex
CREATE INDEX "NotificationAlertState_state_lastSentAt_idx" ON "NotificationAlertState"("state", "lastSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAlertState_audience_type_entityKey_key" ON "NotificationAlertState"("audience", "type", "entityKey");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerNotificationPreference" ADD CONSTRAINT "OwnerNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformNotificationPreference" ADD CONSTRAINT "PlatformNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationOrder" ADD CONSTRAINT "AdminNotificationOrder_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationOrder" ADD CONSTRAINT "AdminNotificationOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationDelivery" ADD CONSTRAINT "AdminNotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationDelivery" ADD CONSTRAINT "AdminNotificationDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAlertState" ADD CONSTRAINT "NotificationAlertState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AnalyticsAcquisitionDaily_tenantId_localDay_sourceKind_source_m" RENAME TO "AnalyticsAcquisitionDaily_tenantId_localDay_sourceKind_sour_key";


-- Row-level security for the tenant-scoped notification tables. FORCE, because policies are
-- skipped for the table owner, which is the role migrations connect as.

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PushSubscription"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AdminNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminNotification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AdminNotification"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AdminNotificationOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminNotificationOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AdminNotificationOrder"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "AdminNotificationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminNotificationDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AdminNotificationDelivery"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "NotificationAlertState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationAlertState" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationAlertState"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
