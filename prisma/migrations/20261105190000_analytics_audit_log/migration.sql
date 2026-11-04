-- Who looked at or erased what (§9.3, D36).
--
-- No RLS and no cascade, on purpose: an audit record about a store is evidence ABOUT that
-- store, not data belonging to it. A store owner must not be able to read or alter it, and
-- deleting a store must not quietly erase the record of what was done to its shoppers' data.
-- Hence a nullable tenantId with SET NULL, and a snapshotted actor email.

CREATE TABLE "AnalyticsAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsAuditLog_tenantId_at_idx" ON "AnalyticsAuditLog"("tenantId", "at");
CREATE INDEX "AnalyticsAuditLog_action_at_idx" ON "AnalyticsAuditLog"("action", "at");

ALTER TABLE "AnalyticsAuditLog" ADD CONSTRAINT "AnalyticsAuditLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
