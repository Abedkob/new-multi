/**
 * Dev/CI scripts talk to Postgres as the owner role (a superuser), which bypasses Row-Level
 * Security, so they can set up and tear down fixtures across every tenant. Importing this
 * module points APP_DATABASE_URL — which lib/prisma.ts prefers — at the owner URL for this
 * process only. It must be imported AFTER `dotenv/config` (so DATABASE_URL is loaded) and
 * BEFORE anything that imports `@/lib/prisma` (so the client is built with the owner URL).
 */
if (process.env.DATABASE_URL) {
  process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
}
