-- The preference that governs the low-stock alert (D96).
--
-- Not optional, and not a nice-to-have: `wantsNotification` ends in `return false` for any type
-- that no preference governs ("a type nobody can switch off is not a decision this function may
-- make on its own"). A LOW_STOCK registered everywhere else but missing here would be refused for
-- every owner, silently, with no error anywhere to explain it.
--
-- Defaults ON, like every preference except showOrderAmount: running out of something is the kind
-- of thing a shopkeeper wants to be told without having to ask for it first.
ALTER TABLE "OwnerNotificationPreference"
  ADD COLUMN "lowStockAlerts" BOOLEAN NOT NULL DEFAULT true;
