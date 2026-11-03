-- Storefront analytics, Phase 1: privacy identity per store, reporting basis, launch control,
-- and the consent-receipt ledger.
--
-- Nothing here collects behavioural data. This migration only makes it possible to ask for
-- consent, to record the answer, and to say who the controllers are.

-- ---- Tenant: privacy identity, reporting basis, launch control ------------------------------

ALTER TABLE "Tenant"
  ADD COLUMN "privacyControllerName"     TEXT,
  ADD COLUMN "privacyEmail"              TEXT,
  ADD COLUMN "privacyPolicyUrl"          TEXT,
  ADD COLUMN "jointControllerVersion"    TEXT,
  ADD COLUMN "jointControllerRecordedAt" TIMESTAMP(3),
  ADD COLUMN "jointControllerRecordedBy" TEXT,
  ADD COLUMN "analyticsTimezone"         TEXT NOT NULL DEFAULT 'Asia/Beirut',
  ADD COLUMN "defaultLocale"             TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN "consentNoticeVersion"      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "analyticsPausedAt"         TIMESTAMP(3),
  ADD COLUMN "analyticsPauseReason"      TEXT,
  ADD CONSTRAINT "Tenant_defaultLocale_check" CHECK ("defaultLocale" IN ('en', 'ar')),
  ADD CONSTRAINT "Tenant_consentNoticeVersion_check" CHECK ("consentNoticeVersion" >= 1),
  -- A pause reason without a pause (or the reverse) would make the kill switch unreadable.
  ADD CONSTRAINT "Tenant_analytics_pause_check" CHECK (
    ("analyticsPausedAt" IS NULL AND "analyticsPauseReason" IS NULL)
    OR "analyticsPausedAt" IS NOT NULL
  );

-- Existing stores inherit the deployment defaults for timezone/locale (the DEFAULTs above
-- already applied them). Controller details stay NULL on purpose: they are a decision the
-- platform operator has to make per store, not something to invent here. `pnpm verify:consent`
-- fails while any store inside the analytics rollout still has them NULL.

-- ---- AnalyticsConsentReceipt ----------------------------------------------------------------

CREATE TABLE "AnalyticsConsentReceipt" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "publicRef"          TEXT NOT NULL,
  "noticeVersion"      INTEGER NOT NULL,
  "analyticsGranted"   BOOLEAN NOT NULL,
  "advertisingGranted" BOOLEAN NOT NULL,
  "locale"             TEXT NOT NULL,
  "decisionMethod"     TEXT NOT NULL,
  "country"            TEXT,
  "deviceClass"        TEXT,
  "decidedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsConsentReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsConsentReceipt_locale_check" CHECK ("locale" IN ('en', 'ar')),
  CONSTRAINT "AnalyticsConsentReceipt_method_check" CHECK (
    "decisionMethod" IN ('BANNER_ACCEPT_ALL', 'BANNER_REJECT', 'MANAGE', 'FOOTER_WITHDRAW')
  ),
  CONSTRAINT "AnalyticsConsentReceipt_deviceClass_check" CHECK (
    "deviceClass" IS NULL OR "deviceClass" IN ('mobile', 'tablet', 'desktop')
  ),
  -- A receipt that expired before it was taken would make retention arithmetic meaningless.
  CONSTRAINT "AnalyticsConsentReceipt_expiry_check" CHECK ("expiresAt" > "decidedAt"),
  -- Country is an ISO-3166 alpha-2 code from trusted proxy metadata, never a raw IP.
  CONSTRAINT "AnalyticsConsentReceipt_country_check" CHECK (
    "country" IS NULL OR "country" ~ '^[A-Z]{2}$'
  )
);

CREATE UNIQUE INDEX "AnalyticsConsentReceipt_publicRef_key"
  ON "AnalyticsConsentReceipt"("publicRef");
CREATE UNIQUE INDEX "AnalyticsConsentReceipt_id_tenantId_key"
  ON "AnalyticsConsentReceipt"("id", "tenantId");
CREATE INDEX "AnalyticsConsentReceipt_tenantId_decidedAt_idx"
  ON "AnalyticsConsentReceipt"("tenantId", "decidedAt");
-- Retention sweeps by expiry across every tenant (Phase 4's scheduled command).
CREATE INDEX "AnalyticsConsentReceipt_expiresAt_idx"
  ON "AnalyticsConsentReceipt"("expiresAt");

ALTER TABLE "AnalyticsConsentReceipt" ADD CONSTRAINT "AnalyticsConsentReceipt_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Row-Level Security ---------------------------------------------------------------------
-- Same shape as every other tenant-scoped table: the runtime role sees only the tenant set by
-- withTenant(), and withBypass() is the one controlled way past it.

ALTER TABLE "AnalyticsConsentReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsConsentReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsConsentReceipt"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
