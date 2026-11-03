const { Client } = require("pg");

async function main() {
  const ownerUrl = process.env.DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!ownerUrl) throw new Error("DATABASE_URL is required to prepare the runtime database role");
  if (!password) throw new Error("APP_DB_PASSWORD is required to prepare the runtime database role");

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Serialize app bootstraps so a future multi-replica deployment cannot race role creation.
    await client.query("SELECT pg_advisory_xact_lock(690814214)");
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user LOGIN;
        END IF;
      END $$
    `);
    const quoted = await client.query("SELECT quote_literal($1) AS value", [password]);
    await client.query(
      `ALTER ROLE app_user WITH PASSWORD ${quoted.rows[0].value} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
    await client.query("GRANT USAGE ON SCHEMA public TO app_user");
    await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user");
    await client.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user
    `);
    await client.query("COMMIT");
    console.log("Restricted runtime database role is ready");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to prepare runtime database role:", error);
  process.exit(1);
});
