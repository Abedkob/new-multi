-- Creates the restricted role the Next.js runtime connects as (APP_DATABASE_URL).
-- Row-Level Security only bites for a role that is NOT a superuser and does NOT have
-- BYPASSRLS, so the app must not connect as the owner/superuser.
--
-- Run once per environment, as the DB owner, passing the app password as a psql variable so
-- it is never committed:
--
--   psql -d <database> -v app_pw="<APP_PASSWORD>" -f scripts/sql/rls-role.sql
--
-- Safe to re-run: it creates the role only if missing and refreshes its grants. Run it again
-- after adding new tables so the role can reach them (or rely on ALTER DEFAULT PRIVILEGES).

\if :{?app_pw}
\else
  \echo '>>> Pass the app password:  -v app_pw="..."'
  \quit
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END $$;

ALTER ROLE app_user WITH PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname = 'app_user';
