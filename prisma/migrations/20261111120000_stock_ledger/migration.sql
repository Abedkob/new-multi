-- Stock management: the switch, the movement ledger, and the document header receiving and
-- stocktaking both write.
--
-- ProductVariant.stock was one mutable Int with no updatedAt, no history and no audit trail of any
-- kind. Two writers changed it silently and left nothing behind: setVariantStock set it absolutely
-- (last write wins, so two staff counting the same shelf clobbered each other with no error), and
-- updateProduct did the same for every variant on every product save while hard-deleting the ones
-- the owner removed from the form -- destroying their stock with no record.
--
-- A movement IS the audit record: it carries its own actor and its own timestamp. That is why this
-- migration adds no AuditAction value, and why the Tenant switch needs no audit row either -- its
-- trail is the operator id and the timestamp on the row.
--
-- The Tenant columns land in the same migration as the tables on purpose: the writer gates every
-- movement on stockEnabled, so splitting them would leave a commit where the gate references a
-- column that does not exist yet.

-- ---- The platform-admin switch ----
--
-- The till's exact three-column shape. stockFirstEnabledAt is set the first time the module is
-- turned on and NEVER cleared: disabling sets the boolean false and leaves the timestamp, which is
-- what separates "may record a movement now" from "has ledger history its owner is entitled to
-- read". Clearing it would hide a store's own history the moment the platform switched the module
-- off.
--
-- It is deliberately NOT the ledger's epoch. Stock can still move while the module is off -- the
-- product form, a storefront order, a till sale -- so the writer reconciles each variant against
-- its live figure and absorbs any gap into an OPENING row, instead of trusting a time window that
-- would quietly be wrong after the first off-period.
ALTER TABLE "Tenant"
ADD COLUMN "stockEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stockFirstEnabledAt" TIMESTAMP(3),
ADD COLUMN "stockEnabledBy" TEXT;

CREATE TYPE "StockMovementReason" AS ENUM (
    'OPENING',
    'RECEIPT',
    'COUNT',
    'ADJUST',
    'SALE',
    'ORDER_CANCELLED',
    'COUNTER_SALE',
    'COUNTER_VOID',
    'VARIANT_REMOVED'
);
CREATE TYPE "StockBatchKind" AS ENUM ('RECEIPT', 'COUNT');

CREATE TABLE "StockBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "StockBatchKind" NOT NULL,
    "submissionId" TEXT NOT NULL,
    "linesFingerprint" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT,
    "actorNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id"),

    -- A document must always be able to name who submitted it, even after that account is gone.
    -- CounterSale_soldBy_named, for the same reason.
    CONSTRAINT "StockBatch_actor_named" CHECK ("actorNameSnapshot" <> '')
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "variantId" TEXT,
    "variantSeq" INTEGER NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "variantAttributesSnapshot" JSONB NOT NULL DEFAULT '{}',
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "batchId" TEXT,
    "orderId" TEXT,
    "counterSaleId" TEXT,
    "unitCostCents" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT,
    "actorNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),

    -- The rules the code must not break, put where no code path can skip them. The till's
    -- precedent: CounterSaleItem_price_is_derived is the floor under a staff discount cap that
    -- lives in application code.
    --
    -- Stock is never negative anywhere in this system -- the conditional decrement's `stock >= qty`
    -- guard is the entire reason it cannot oversell -- so a balance that went below zero would mean
    -- the ledger and the shelf had already disagreed.
    CONSTRAINT "StockMovement_balance_nonnegative" CHECK ("balanceAfter" >= 0),
    -- A per-variant counter starts at 1. Zero or negative would mean MAX+1 was computed from
    -- something other than this variant's own history.
    CONSTRAINT "StockMovement_seq_positive" CHECK ("variantSeq" >= 1),
    CONSTRAINT "StockMovement_actor_named" CHECK ("actorNameSnapshot" <> ''),
    CONSTRAINT "StockMovement_unit_cost_nonnegative" CHECK (
        "unitCostCents" IS NULL OR "unitCostCents" >= 0
    ),
    -- An OPENING states the balance this ledger found and cannot explain. It must never move
    -- units: a non-zero OPENING would be a way to invent or destroy stock with no counterpart.
    CONSTRAINT "StockMovement_opening_moves_nothing" CHECK (
        "reason" <> 'OPENING' OR "delta" = 0
    )
);

-- One batch per submission per store: the idempotency guarantee for a double-tapped Save or a
-- retry after an ambiguous network failure. Two concurrent requests with the same id cannot both
-- commit, so no advisory lock is needed. CounterSale_tenantId_submissionId_key, verbatim.
CREATE UNIQUE INDEX "StockBatch_tenantId_submissionId_key" ON "StockBatch"("tenantId", "submissionId");
CREATE INDEX "StockBatch_tenantId_kind_createdAt_idx" ON "StockBatch"("tenantId", "kind", "createdAt");

-- The per-variant counter's integrity. A race on MAX+1 becomes a unique violation -- an error the
-- caller sees -- rather than two rows claiming the same position in one variant's history. NULL
-- variantIds are distinct to Postgres, so a deleted variant's rows never collide with each other.
CREATE UNIQUE INDEX "StockMovement_variantId_variantSeq_key" ON "StockMovement"("variantId", "variantSeq");
-- The history screen's only sort, and its reason tabs.
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");
CREATE INDEX "StockMovement_tenantId_reason_createdAt_idx" ON "StockMovement"("tenantId", "reason", "createdAt");
-- One document's lines.
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");

ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A deleted variant nulls the link and leaves the snapshots intact, exactly as OrderItem and
-- CounterSaleItem do. updateProduct hard-deletes variants the owner removes from the form, so the
-- VARIANT_REMOVED movement written just before that delete is the only surviving record of the
-- stock it held -- and it stays readable because the name and attributes travel with the row.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A plain foreign key rather than the composite (id, tenantId) shape CounterSaleItem uses:
-- ON DELETE SET NULL cannot null a composite whose tenantId is NOT NULL, and the alternative --
-- CASCADE -- would mean a ledger row could be deleted by the document it points at, which is
-- exactly what a ledger must not be.
--
-- The consequence, measured rather than assumed (scripts/fixtures/stock-cross-tenant.ts, run as
-- app_user): a store CAN file one of its OWN movements against another store's document id.
-- Postgres checks a foreign key with the referencing table's privileges and does not apply RLS to
-- the referenced table, so the policy below cannot reach it. What that buys an attacker is
-- nothing: the row is still their own tenant's, the other store's document stays unreadable, and
-- the other store's history filters on tenantId as well as batchId so the row never appears in it.
-- The only effect is a dangling reference inside the writer's own ledger, reachable solely through
-- direct SQL -- the application never accepts a batch id from a caller. Written down in
-- KNOWN_GAPS.md rather than fixed, because the fix is the CASCADE this paragraph rejects.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No foreign key on "orderId" or "counterSaleId", deliberately, for the reason
-- Order.analyticsSessionId gives: a ledger that can be cascaded away by whatever it points at is
-- not a ledger. pnpm verify:stock checks that each one still resolves.
--
-- No foreign key on "actorUserId" either, for the reason CounterSale.soldByUserId is nullable: a
-- staff account can be removed from a store, and the ledger must outlive it. The name snapshot is
-- what keeps the row readable. (CounterSale keeps the FK with ON DELETE SET NULL; here the actor is
-- as often the system as a person, and the snapshot is the authority in both cases.)

-- ---- Row-Level Security ----
--
-- Same shape as every other tenant-scoped table: the runtime role sees only the tenant set by
-- withTenant(), and withBypass() is the one controlled way past it. FORCE matters as much as
-- ENABLE -- without it the policies would not apply to the table owner, which is what migrations
-- connect as. pnpm verify:aggregates reads pg_class and pg_policies and fails on any table that
-- carries a tenantId without both, so neither of these can be added quietly later.
--
-- No GRANT anywhere, and that is load-bearing: rls-role.sql grants on TABLES only, so a global
-- autoincrement sequence for the movement counter would have left app_user without USAGE and
-- failed every insert in production alone, while passing every suite (they connect as the owner).
-- The per-variant counter needs no new object at all.

ALTER TABLE "StockBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockBatch"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockMovement"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass', true) = 'on');
