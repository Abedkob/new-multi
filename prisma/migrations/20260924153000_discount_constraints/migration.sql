-- Keep invalid campaigns out even when data is written outside the application layer.

ALTER TABLE "DiscountCampaign"
  ADD CONSTRAINT "DiscountCampaign_value_check"
  CHECK (
    ("type" = 'PERCENTAGE' AND "value" BETWEEN 1 AND 100)
    OR ("type" = 'FIXED_AMOUNT' AND "value" > 0)
  ),
  ADD CONSTRAINT "DiscountCampaign_schedule_check"
  CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt");
