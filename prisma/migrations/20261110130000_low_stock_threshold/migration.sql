-- A per-product low-stock threshold (D95).
--
-- Replaces the hard-coded LOW_STOCK = 3 in lib/variants.ts as the *rule*; that constant stays as
-- the documented fallback. NULL means "use the platform default", which is every product on the
-- day this ships, so `stock <= COALESCE("lowStockThreshold", 3)` is byte-identical to the
-- `stock <= 3` the dashboard and the stock badge have always used. That is what makes "this
-- changes nothing until an owner sets a number" a check rather than a claim.
--
-- Per product, not per variant: a threshold is a purchasing decision about a product, and a
-- second place to set one number is a second place for it to be wrong.
ALTER TABLE "Product" ADD COLUMN "lowStockThreshold" INTEGER;

-- A threshold of 0 is meaningful ("tell me only when it is gone"), so only a negative number is
-- nonsense. The application falls back for NULL and for anything negative; the database refuses
-- to store the second kind at all.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_low_stock_threshold_nonnegative"
  CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);
