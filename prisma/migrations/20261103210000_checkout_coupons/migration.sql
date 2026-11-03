-- Checkout coupon codes with tenant-safe product assignments and immutable order accounting.

CREATE TYPE "CouponScope" AS ENUM ('ORDER_SUBTOTAL', 'SELECTED_PRODUCTS', 'FREE_DELIVERY');

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT,
  "code" TEXT NOT NULL,
  "scope" "CouponScope" NOT NULL,
  "type" "DiscountType",
  "value" INTEGER,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isAnnounced" BOOLEAN NOT NULL DEFAULT false,
  "announcementText" TEXT NOT NULL DEFAULT '',
  "archivedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Coupon_value_scope_check" CHECK (
    ("scope" = 'FREE_DELIVERY' AND "type" IS NULL AND "value" IS NULL)
    OR
    ("scope" IN ('ORDER_SUBTOTAL', 'SELECTED_PRODUCTS') AND (
      ("type" = 'PERCENTAGE' AND "value" BETWEEN 1 AND 100)
      OR ("type" = 'FIXED_AMOUNT' AND "value" > 0)
    ))
  ),
  CONSTRAINT "Coupon_schedule_check" CHECK (
    "startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt"
  )
);

CREATE TABLE "CouponProduct" (
  "tenantId" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponProduct_pkey" PRIMARY KEY ("couponId", "productId")
);

CREATE UNIQUE INDEX "Coupon_tenantId_code_key" ON "Coupon"("tenantId", "code");
CREATE UNIQUE INDEX "Coupon_id_tenantId_key" ON "Coupon"("id", "tenantId");
CREATE UNIQUE INDEX "Coupon_one_announced_per_tenant" ON "Coupon"("tenantId")
  WHERE "isAnnounced" = true AND "archivedAt" IS NULL;
CREATE INDEX "Coupon_tenantId_archivedAt_isEnabled_idx" ON "Coupon"("tenantId", "archivedAt", "isEnabled");
CREATE INDEX "Coupon_tenantId_startsAt_endsAt_idx" ON "Coupon"("tenantId", "startsAt", "endsAt");
CREATE INDEX "CouponProduct_tenantId_productId_idx" ON "CouponProduct"("tenantId", "productId");
CREATE INDEX "CouponProduct_tenantId_couponId_idx" ON "CouponProduct"("tenantId", "couponId");

ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponProduct" ADD CONSTRAINT "CouponProduct_couponId_tenantId_fkey"
  FOREIGN KEY ("couponId", "tenantId") REFERENCES "Coupon"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponProduct" ADD CONSTRAINT "CouponProduct_productId_tenantId_fkey"
  FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD COLUMN "couponIdSnapshot" TEXT,
  ADD COLUMN "couponCodeSnapshot" TEXT,
  ADD COLUMN "couponNameSnapshot" TEXT,
  ADD COLUMN "couponScopeSnapshot" "CouponScope",
  ADD COLUMN "couponMerchandiseDiscountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "couponDeliveryDiscountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "couponDiscountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Order_coupon_discount_check" CHECK (
    "couponMerchandiseDiscountCentsSnapshot" >= 0
    AND "couponDeliveryDiscountCentsSnapshot" >= 0
    AND "couponDiscountCentsSnapshot" = "couponMerchandiseDiscountCentsSnapshot" + "couponDeliveryDiscountCentsSnapshot"
  );

ALTER TABLE "OrderItem"
  ADD COLUMN "couponDiscountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "OrderItem_coupon_discount_check" CHECK ("couponDiscountCentsSnapshot" >= 0);

ALTER TABLE "Coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Coupon" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Coupon"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "CouponProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CouponProduct" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CouponProduct"
  USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass', true) = 'on');
