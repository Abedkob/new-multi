-- Product variants: stock, and optional price/image, move from Product to ProductVariant.
-- Existing products keep their data: each gets one default variant (empty attributes)
-- carrying its old stock, and priceCents is renamed to basePriceCents.

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "priceCentsOverride" INTEGER,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Price: rename via add + copy + not-null
ALTER TABLE "Product" ADD COLUMN "basePriceCents" INTEGER;
UPDATE "Product" SET "basePriceCents" = "priceCents";
ALTER TABLE "Product" ALTER COLUMN "basePriceCents" SET NOT NULL;

-- Stock: one default variant per existing product
INSERT INTO "ProductVariant" ("id", "productId", "attributes", "stock")
SELECT 'var_' || "id", "id", '{}'::jsonb, "stock" FROM "Product";

-- Drop the old flat columns
ALTER TABLE "Product" DROP COLUMN "priceCents";
ALTER TABLE "Product" DROP COLUMN "stock";
