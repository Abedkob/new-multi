-- Automatic, reusable product discounts with tenant-safe assignments and auditable order prices.

CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

CREATE TABLE "DiscountCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiscountCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscountProduct" (
    "tenantId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountProduct_pkey" PRIMARY KEY ("discountId", "productId")
);

CREATE UNIQUE INDEX "Product_id_tenantId_key" ON "Product"("id", "tenantId");
CREATE UNIQUE INDEX "DiscountCampaign_id_tenantId_key" ON "DiscountCampaign"("id", "tenantId");
CREATE INDEX "DiscountCampaign_tenantId_archivedAt_isEnabled_idx" ON "DiscountCampaign"("tenantId", "archivedAt", "isEnabled");
CREATE INDEX "DiscountCampaign_tenantId_startsAt_endsAt_idx" ON "DiscountCampaign"("tenantId", "startsAt", "endsAt");
CREATE INDEX "DiscountProduct_tenantId_productId_idx" ON "DiscountProduct"("tenantId", "productId");
CREATE INDEX "DiscountProduct_tenantId_discountId_idx" ON "DiscountProduct"("tenantId", "discountId");

ALTER TABLE "DiscountCampaign"
  ADD CONSTRAINT "DiscountCampaign_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscountProduct"
  ADD CONSTRAINT "DiscountProduct_discountId_tenantId_fkey"
  FOREIGN KEY ("discountId", "tenantId") REFERENCES "DiscountCampaign"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscountProduct"
  ADD CONSTRAINT "DiscountProduct_productId_tenantId_fkey"
  FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill historical orders before making the regular-price snapshot required.
ALTER TABLE "OrderItem"
  ADD COLUMN "regularPriceCentsSnapshot" INTEGER,
  ADD COLUMN "discountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountIdSnapshot" TEXT,
  ADD COLUMN "discountNameSnapshot" TEXT;

UPDATE "OrderItem"
SET "regularPriceCentsSnapshot" = "priceCentsSnapshot";

ALTER TABLE "OrderItem"
  ALTER COLUMN "regularPriceCentsSnapshot" SET NOT NULL;

-- Direct tenant table.
ALTER TABLE "DiscountCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscountCampaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscountCampaign"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

-- Assignment rows carry tenantId and are also protected by composite foreign keys.
ALTER TABLE "DiscountProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscountProduct" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscountProduct"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
