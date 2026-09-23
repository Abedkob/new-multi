-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "domain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_domain_key" ON "Tenant"("domain");
