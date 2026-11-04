-- The columns §5.3 and §5.5 ask for and the aggregates did not have (D44, D48, D48a).
--
-- Every one is NULLABLE rather than NOT NULL DEFAULT 0, which is the opposite of the Phase 4
-- convention and deliberate. These columns are added to a table that already holds history: a
-- day recorded before today never counted them, and writing 0 there would say "no visitors
-- viewed this product" when the truth is "nobody asked". Null is the only value that can be
-- told apart from a real zero, and lib/analytics/report.ts refuses to total a range containing
-- one rather than quietly under-reporting it.
--
-- productName is backfilled from the products that still exist, which is all that can honestly
-- be done: a product deleted before this migration left no name anywhere, and its rows stay
-- null so the report labels them "Deleted product" instead of showing a blank.
--
-- The counts are not backfilled at all. They need the raw events, which retention empties at 90
-- days, so the nightly 30-day recompute fills the recent window and older days stay null.

ALTER TABLE "AnalyticsProductDaily" ADD COLUMN "productName" TEXT;
ALTER TABLE "AnalyticsProductDaily" ADD COLUMN "viewVisitors" INTEGER;
ALTER TABLE "AnalyticsProductDaily" ADD COLUMN "returningViewVisitors" INTEGER;

ALTER TABLE "AnalyticsAcquisitionDaily" ADD COLUMN "visitors" INTEGER;
ALTER TABLE "AnalyticsAcquisitionDaily" ADD COLUMN "productViewSessions" INTEGER;
ALTER TABLE "AnalyticsAcquisitionDaily" ADD COLUMN "cartSessions" INTEGER;
ALTER TABLE "AnalyticsAcquisitionDaily" ADD COLUMN "whatsappPotentialValueCents" INTEGER;

-- Name what can still be named. Scoped by tenant as well as id: the join is on a tenant-owned
-- table from a tenant-owned table, and leaving the tenant out of it would be the one query in
-- this file that could cross a store boundary.
UPDATE "AnalyticsProductDaily" a
   SET "productName" = p."name"
  FROM "Product" p
 WHERE p."id" = a."productId"
   AND p."tenantId" = a."tenantId"
   AND a."productName" IS NULL;
