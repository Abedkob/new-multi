-- Staff accounts (Phase 7, D70/D71).
--
-- A third principal joins an isolation model that has had two since Phase 1. The database's
-- share of that is small but not optional: a STAFF row must name exactly one store, because a
-- staff account with no tenant is a principal with no isolation scope, and every RLS policy in
-- this schema keys on the tenant.

ALTER TYPE "Role" ADD VALUE 'STAFF';

-- The store a staff account belongs to. NOT the ownership relation (Tenant.ownerId): a staff
-- member belongs to a store without owning it. ON DELETE CASCADE, so deleting a store takes its
-- staff accounts with it rather than leaving logins with a dangling scope.
ALTER TABLE "User" ADD COLUMN "staffTenantId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_staffTenantId_fkey"
  FOREIGN KEY ("staffTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "User_staffTenantId_idx" ON "User"("staffTenantId");

-- Both halves of the invariant, because each fails differently. Without the first, a staff
-- account exists that no tenant scope applies to. Without the second, an owner or a platform
-- admin could be given a staff tenant and be scoped to two stores at once.
--
-- Written as one constraint so the error names the rule rather than one side of it.
ALTER TABLE "User"
  ADD CONSTRAINT "User_staff_tenant_required"
  CHECK (
    ("role" = 'STAFF' AND "staffTenantId" IS NOT NULL)
    OR ("role" <> 'STAFF' AND "staffTenantId" IS NULL)
  );
