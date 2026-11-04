-- §3.5's classification, stored rather than re-derived (D23).
--
-- sourceKind is which rung of the ladder an arrival came from; referrerHost is the hostname
-- only, never a full referring URL. Both nullable: sessions recorded before this migration were
-- classified by code that had no notion of a kind, and guessing one for them now would invent
-- history.

ALTER TABLE "AnalyticsSession"
  ADD COLUMN "sourceKind" TEXT,
  ADD COLUMN "referrerHost" TEXT;

-- Acquisition reports group by channel for a day, so this is the shape they ask for.
CREATE INDEX "AnalyticsSession_tenantId_sourceKind_startedAt_idx"
  ON "AnalyticsSession"("tenantId", "sourceKind", "startedAt");
