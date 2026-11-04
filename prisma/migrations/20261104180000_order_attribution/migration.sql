-- Phase 3: an order remembers where it came from (master plan 9.1).
--
-- Eight nullable columns, written once inside the order's own transaction and never updated.
-- Existing orders keep nulls: Phase 5 reports show pre-analytics orders as unattributed rather
-- than inventing a source for them.
--
-- No foreign key to "AnalyticsSession" on purpose. Retention deletes sessions after 13 months
-- while orders are kept for commercial and tax reasons; a foreign key would either block that
-- deletion or cascade it into the order. These are references for reconciliation, not relations.
--
-- "Order" is already RLS-guarded, so no policy changes are needed: adding columns to a table
-- that already has ENABLE/FORCE ROW LEVEL SECURITY leaves its existing policies in force.

ALTER TABLE "Order"
  ADD COLUMN "analyticsSessionId" TEXT,
  ADD COLUMN "analyticsVisitorId" TEXT,
  ADD COLUMN "attributionSource" TEXT,
  ADD COLUMN "attributionMedium" TEXT,
  ADD COLUMN "attributionCampaign" TEXT,
  ADD COLUMN "firstTouchSource" TEXT,
  ADD COLUMN "analyticsCountry" TEXT,
  ADD COLUMN "analyticsDeviceClass" TEXT;
