-- Campaigns an owner saved while building a tracked link (D39).
--
-- Deliberately thin: a name, the normalized utm value that joins it to the data, the channel and
-- destination the link used, and when it was made or archived. No numbers. §5.5's "no campaign
-- management database in v1" stands in spirit — this records what the owner made, never what it
-- earned, so it can never disagree with a report.
--
-- Tenant-scoped and therefore under forced RLS, like every other store-owned table. FORCE
-- matters because policies are skipped for the table's owner, which is the role migrations run
-- as; verify:aggregates (P4-23a) counts protected tables and would fail if this one were added
-- without a policy.
--
-- The unique index is on (tenantId, utmCampaign) rather than the name: the utm value is what the
-- data comes back as, and two saved rows pointing at one value would show the same traffic twice.

CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destinationPath" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingCampaign_tenantId_utmCampaign_key"
  ON "MarketingCampaign"("tenantId", "utmCampaign");
CREATE INDEX "MarketingCampaign_tenantId_archivedAt_createdAt_idx"
  ON "MarketingCampaign"("tenantId", "archivedAt", "createdAt");

ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingCampaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MarketingCampaign"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
