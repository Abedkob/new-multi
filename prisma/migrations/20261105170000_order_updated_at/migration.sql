-- Phase 4 (D33): the aggregates need to know which orders changed recently.
--
-- Cash on delivery means a cancellation routinely lands days after the order was placed, while
-- the ordinary recompute window covers today and yesterday. An order whose status changes drags
-- the day it was CREATED back into the queue — and nothing could ask that question before,
-- because an order recorded only when it was created.

ALTER TABLE "Order" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Existing orders have never been updated as far as anyone knows, so their updatedAt is their
-- createdAt. Defaulting them to now() instead would claim every past order changed at the
-- moment of this deploy, and the first sweep would recompute every day in the table.
UPDATE "Order" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- The sweep asks for orders changed since a moment, per tenant.
CREATE INDEX "Order_tenantId_updatedAt_idx" ON "Order"("tenantId", "updatedAt");
