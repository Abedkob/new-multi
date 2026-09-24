CREATE TABLE "TenantLicense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "licenseKeyCiphertext" TEXT NOT NULL,
    "keyHint" TEXT,
    "activationTokenCiphertext" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerRequestId" TEXT,
    "activationId" TEXT,
    "licenseType" TEXT,
    "expiresAt" TIMESTAMP(3),
    "entitlements" JSONB,
    "checkAfter" TIMESTAMP(3),
    "offlineGraceUntil" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantLicense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantLicense_tenantId_key" ON "TenantLicense"("tenantId");
CREATE UNIQUE INDEX "TenantLicense_installationId_key" ON "TenantLicense"("installationId");
CREATE INDEX "TenantLicense_status_checkAfter_idx" ON "TenantLicense"("status", "checkAfter");

ALTER TABLE "TenantLicense"
ADD CONSTRAINT "TenantLicense_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
