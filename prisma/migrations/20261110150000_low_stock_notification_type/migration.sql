-- The low-stock notification type (D96).
--
-- Its own migration, containing nothing else, because Postgres refuses to use an enum value in
-- the same transaction that added it — so the column that defaults against it, and any row that
-- names it, must come in a later migration.
ALTER TYPE "NotificationType" ADD VALUE 'LOW_STOCK';
