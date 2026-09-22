-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isBestSeller" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "sectionVisibility" JSONB NOT NULL DEFAULT '{}';
