ALTER TABLE "Tenant"
ADD COLUMN "whatsappNumber" TEXT,
ADD COLUMN "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deliveryNote" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Order"
ADD COLUMN "deliveryFeeCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deliveryNoteSnapshot" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Tenant"
ADD CONSTRAINT "Tenant_deliveryFeeCents_nonnegative" CHECK ("deliveryFeeCents" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_deliveryFeeCentsSnapshot_nonnegative" CHECK ("deliveryFeeCentsSnapshot" >= 0);
