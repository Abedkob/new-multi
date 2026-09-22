-- Row-Level Security: defence-in-depth tenant isolation.
--
-- The Next.js runtime connects as a non-superuser role (see lib/prisma.ts) and sets
-- `app.tenant_id` per transaction via withTenant(), or `app.bypass='on'` via withBypass()
-- for the platform admin's cross-tenant reads. Superusers (migrations, seeds, the dev
-- scripts) bypass RLS entirely, so this file is a no-op for them.
--
-- current_setting(name, true) returns NULL when the setting is unset, so a query with no
-- tenant context matches no rows instead of erroring.

-- ---- Parent tables (own a tenantId column) --------------------------------------------------

ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Category"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "TenantContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantContent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantContent"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Order"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

-- ---- Child tables (reach the tenant through their parent row) --------------------------------

ALTER TABLE "ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductVariant"
  USING (current_setting('app.bypass', true) = 'on'
         OR EXISTS (SELECT 1 FROM "Product" p
                    WHERE p.id = "ProductVariant"."productId"
                      AND p."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR EXISTS (SELECT 1 FROM "Product" p
                    WHERE p.id = "ProductVariant"."productId"
                      AND p."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "ProductImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductImage"
  USING (current_setting('app.bypass', true) = 'on'
         OR EXISTS (SELECT 1 FROM "Product" p
                    WHERE p.id = "ProductImage"."productId"
                      AND p."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR EXISTS (SELECT 1 FROM "Product" p
                    WHERE p.id = "ProductImage"."productId"
                      AND p."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderItem"
  USING (current_setting('app.bypass', true) = 'on'
         OR EXISTS (SELECT 1 FROM "Order" o
                    WHERE o.id = "OrderItem"."orderId"
                      AND o."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (current_setting('app.bypass', true) = 'on'
         OR EXISTS (SELECT 1 FROM "Order" o
                    WHERE o.id = "OrderItem"."orderId"
                      AND o."tenantId" = current_setting('app.tenant_id', true)));
