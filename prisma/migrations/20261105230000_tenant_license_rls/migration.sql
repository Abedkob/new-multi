-- Row-level security for TenantLicense, closing the gap P4-23a found on its first run.
--
-- The table carries a tenantId and had no policy, so one store's licence row — including its
-- encrypted key and activation token ciphertext — was kept out of another store's reach by the
-- application's WHERE clauses alone.
--
-- Switching it on is not enough by itself, which is why this migration ships with a code change.
-- Every accessor in lib/data/licenses.ts already runs under withBypass and is unaffected, and
-- lib/data/orders.ts reads the gate columns inside withTenant(tenantId), where the policy admits
-- the store's own row. But the storefront read its licence through getTenantBySlug, a bare query
-- with NO tenant context: under this policy that include would return null, and
-- isLicenseActive(null) is deliberately true ("a missing licence is allowed during the opt-in
-- rollout"). So this migration alone would not take storefronts down — it would silently stop
-- enforcing licensing, which is worse than the leak it closes. getTenantBySlug now reads the
-- gate columns through getLicenseAccessSnapshot, under the store's own tenant context, and
-- verify:isolation proves both halves: another store cannot read or write the row, and an
-- expired licence still stops a store serving.

ALTER TABLE "TenantLicense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantLicense" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantLicense"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
