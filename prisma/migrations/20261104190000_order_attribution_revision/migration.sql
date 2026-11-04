-- Phase 3, reviewed: an order says where it came from, not who came.
--
-- Drops "analyticsVisitorId". A visitor id is a durable pseudonymous identifier, and an order is
-- kept for years — outside the 13-month analytics retention sweep. Keeping one on the order
-- would let any single purchase be tied back to a person's whole browsing history for that
-- store, which is precisely what the privacy rules forbid. What a merchant actually needs from
-- that column is "had this shopper been here before", so "isReturningVisitor" replaces it: a
-- boolean that cannot be re-identified. Null means unknown.
--
-- No data is lost that any report reads: nothing has written these columns yet.
--
-- Also adds the other two first-touch dimensions, so first-touch and last-touch attribution are
-- symmetrical (source, medium, campaign) rather than first-touch being source only.

ALTER TABLE "Order"
  DROP COLUMN "analyticsVisitorId",
  ADD COLUMN "isReturningVisitor" BOOLEAN,
  ADD COLUMN "firstTouchMedium" TEXT,
  ADD COLUMN "firstTouchCampaign" TEXT;
