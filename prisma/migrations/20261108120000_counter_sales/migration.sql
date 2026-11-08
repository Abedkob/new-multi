-- In-store counter sales (the till).
--
-- A sale rung up at a physical counter, kept in its own tables rather than as a kind of Order.
-- The reasons are structural: Order's four customer columns are NOT NULL with no default and the
-- orders screens read them unconditionally; OrderStatus has no honest value for a sale that is
-- complete on creation (PENDING is auto-cancelled, which would restore the stock of a sale that
-- happened, and DELIVERED is terminal, so a mistake could never be voided); and every reader that
-- totals money from Order would silently absorb counter sales, including the analytics aggregates
-- and the conversion rate, where a missed filter reports a believable wrong number.
--
-- The Tenant columns land in the same migration as the tables on purpose. The writer gates every
-- sale on counterSalesEnabled, so splitting them would leave a commit where the gate references a
-- column that does not exist yet.

-- ---- The platform-admin switch ----
--
-- counterSalesFirstEnabledAt is set the first time the till is turned on and NEVER cleared.
-- Disabling sets the boolean false and leaves the timestamp, which is what separates "may record
-- a sale now" from "has till history its owner is entitled to read". Clearing it would hide a
-- store's own receipts the moment the platform switched the feature off.
ALTER TABLE "Tenant"
ADD COLUMN "counterSalesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "counterSalesFirstEnabledAt" TIMESTAMP(3),
ADD COLUMN "counterSalesEnabledBy" TEXT;

CREATE TYPE "CounterSaleStatus" AS ENUM ('RECORDED', 'VOIDED');
CREATE TYPE "CounterSalePayment" AS ENUM ('CASH', 'CARD');

CREATE TABLE "CounterSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "CounterSaleStatus" NOT NULL DEFAULT 'RECORDED',
    "payment" "CounterSalePayment" NOT NULL,
    "submissionId" TEXT NOT NULL,
    "linesFingerprint" TEXT NOT NULL,
    "soldByUserId" TEXT,
    "soldByNameSnapshot" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "voidRestoredLines" INTEGER,

    CONSTRAINT "CounterSale_pkey" PRIMARY KEY ("id"),

    -- The void trio cannot drift. Tenant.isPaused/pausedAt/pauseReason stay consistent only
    -- because exactly one function writes them, which is a convention; here the database refuses
    -- an inconsistent row. voidedByUserId is deliberately NOT part of this: ON DELETE SET NULL
    -- can legitimately null it long after the void.
    CONSTRAINT "CounterSale_void_consistent" CHECK (
        (("status" = 'VOIDED') = ("voidedAt" IS NOT NULL))
        AND (("status" = 'VOIDED') = ("voidReason" IS NOT NULL))
    ),
    -- A receipt must always be able to name who took the money, even after that account is gone.
    CONSTRAINT "CounterSale_soldBy_named" CHECK ("soldByNameSnapshot" <> ''),
    CONSTRAINT "CounterSale_restored_lines_nonnegative" CHECK (
        "voidRestoredLines" IS NULL OR "voidRestoredLines" >= 0
    )
);

CREATE TABLE "CounterSaleItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "counterSaleId" TEXT NOT NULL,
    "variantId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "variantAttributesSnapshot" JSONB NOT NULL DEFAULT '{}',
    "regularPriceCentsSnapshot" INTEGER NOT NULL,
    "discountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
    "discountIdSnapshot" TEXT,
    "discountNameSnapshot" TEXT,
    "manualDiscountCentsSnapshot" INTEGER NOT NULL DEFAULT 0,
    "manualDiscountReason" TEXT,
    "priceCentsSnapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CounterSaleItem_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "CounterSaleItem_quantity_positive" CHECK ("quantity" >= 1),
    CONSTRAINT "CounterSaleItem_amounts_nonnegative" CHECK (
        "regularPriceCentsSnapshot" >= 0
        AND "discountCentsSnapshot" >= 0
        AND "manualDiscountCentsSnapshot" >= 0
        AND "priceCentsSnapshot" >= 0
    ),
    -- The charged price must be explainable from the catalogue price minus named reductions.
    -- This is what makes a manual discount a *discount* rather than a typed-in price: a staff
    -- member cannot charge an arbitrary number, cannot charge above the shelf price, and cannot
    -- drive a line negative. The staff percentage ceiling is enforced in the action
    -- (lib/counter-sales.ts); this is the floor underneath it that no code path can skip.
    CONSTRAINT "CounterSaleItem_price_is_derived" CHECK (
        "priceCentsSnapshot" = "regularPriceCentsSnapshot" - "discountCentsSnapshot" - "manualDiscountCentsSnapshot"
    ),
    -- Money given away at the counter is always accounted for by a reason.
    CONSTRAINT "CounterSaleItem_manual_discount_explained" CHECK (
        "manualDiscountCentsSnapshot" = 0
        OR ("manualDiscountReason" IS NOT NULL AND "manualDiscountReason" <> '')
    )
);

-- Lets CounterSaleItem reach its tenant through a composite foreign key.
CREATE UNIQUE INDEX "CounterSale_id_tenantId_key" ON "CounterSale"("id", "tenantId");
-- One sale per submission per store: the idempotency guarantee for a double-tapped Complete Sale
-- or a retry after an ambiguous network failure. Two concurrent requests with the same id cannot
-- both commit, so no advisory lock is needed.
CREATE UNIQUE INDEX "CounterSale_tenantId_submissionId_key" ON "CounterSale"("tenantId", "submissionId");
-- Serves the history list and the takings aggregate, which both filter status and range on date.
CREATE INDEX "CounterSale_tenantId_status_createdAt_idx" ON "CounterSale"("tenantId", "status", "createdAt");
CREATE INDEX "CounterSaleItem_tenantId_counterSaleId_idx" ON "CounterSaleItem"("tenantId", "counterSaleId");
CREATE INDEX "CounterSaleItem_variantId_idx" ON "CounterSaleItem"("variantId");

ALTER TABLE "CounterSale" ADD CONSTRAINT "CounterSale_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CounterSale" ADD CONSTRAINT "CounterSale_soldByUserId_fkey"
    FOREIGN KEY ("soldByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CounterSale" ADD CONSTRAINT "CounterSale_voidedByUserId_fkey"
    FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The composite parent reference: an item cannot point at another store's sale even if
-- application code slips. Same shape as CouponProduct and AnalyticsSession.
ALTER TABLE "CounterSaleItem" ADD CONSTRAINT "CounterSaleItem_counterSaleId_tenantId_fkey"
    FOREIGN KEY ("counterSaleId", "tenantId") REFERENCES "CounterSale"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
-- A deleted variant nulls the link and leaves the snapshot intact, exactly as OrderItem does.
-- It also means a void may be unable to return that line's stock, which is why CounterSale
-- records how many lines were actually restored instead of assuming all of them were.
ALTER TABLE "CounterSaleItem" ADD CONSTRAINT "CounterSaleItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Row-Level Security ----
--
-- Same shape as every other tenant-scoped table: the runtime role sees only the tenant set by
-- withTenant(), and withBypass() is the one controlled way past it. FORCE matters as much as
-- ENABLE — without it the policies would not apply to the table owner, which is what migrations
-- connect as. pnpm verify:aggregates reads pg_class and pg_policies and fails on any table that
-- carries a tenantId without both.

ALTER TABLE "CounterSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CounterSale" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CounterSale"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "CounterSaleItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CounterSaleItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CounterSaleItem"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
