/**
 * Backup and restore drill (P7-24): pnpm drill:restore
 *
 * Takes a real dump of the database this deployment uses, restores it into a scratch database
 * beside it, and then checks the copy rather than trusting that the restore printed no errors.
 * Drops the scratch database at the end, including when a check fails.
 *
 * A backup nobody has restored is a hypothesis. The three things that make a restore *look*
 * fine and leave you without a working system are each checked here:
 *
 *   1. **Roles are not in the dump.** `pg_dump` writes one database's contents — tables, data,
 *      policies, grants — and no CREATE ROLE. Restore into a fresh cluster and `app_user` does
 *      not exist, so every GRANT in the dump fails, the runtime cannot connect, and if someone
 *      "fixes" it by pointing APP_DATABASE_URL at the owner role, Row-Level Security stops
 *      being enforced and nothing says so. `scripts/sql/rls-role.sql` is the other half of any
 *      restore, and this drill fails if the restored copy has no such role.
 *   2. **Row-Level Security is per-table state** (ENABLE + FORCE + policies). A restore that
 *      lost it reads identically to one that did not, until two stores can see each other.
 *      Every table with a tenantId is checked for a forced policy in the copy.
 *   3. **Row counts, per table.** Compared against the source, not eyeballed.
 *
 * Needs `pg_dump` and `psql`. Where they are not on PATH it falls back to running them from the
 * `postgres:16-alpine` image, rewriting a localhost host to `host.docker.internal` — the same
 * binaries, so the drill is the same drill. If neither is available it **fails**; it does not
 * report a pass it did not earn.
 *
 * What it deliberately does not do: boot the application against the restored copy. That is
 * P7-24's other half and it is yours, because it has to happen on the machine that would
 * actually be recovering. The last section prints the two commands for it.
 */

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DELIBERATELY_OPEN } from "./_rls-exceptions";

const SOURCE_URL = process.env.DATABASE_URL;
if (!SOURCE_URL) {
  console.error("DATABASE_URL is not set; there is nothing to back up.");
  process.exit(1);
}

const source = new URL(SOURCE_URL);
const scratchName = `${source.pathname.slice(1)}_restore_drill`;
const scratchUrl = new URL(SOURCE_URL);
scratchUrl.pathname = `/${scratchName}`;
const adminUrl = new URL(SOURCE_URL);
adminUrl.pathname = "/postgres";

let checks = 0;
let failures = 0;
const ok = (label: string, detail: string) => {
  checks += 1;
  console.log(`  ok   ${label.padEnd(14)} ${detail}`);
};
const fail = (label: string, detail: string) => {
  failures += 1;
  console.error(`  FAIL ${label.padEnd(14)} ${detail}`);
};

/** `docker` can reach a database on the host, but not by the host's own name for it. */
const forDocker = (host: string) =>
  ["localhost", "127.0.0.1", "::1"].includes(host) ? "host.docker.internal" : host;

/**
 * The connection is passed as libpq environment variables, never as an argument.
 *
 * The first version of this script put the URL on the command line, and the first failure
 * printed the whole failed command — password included — into a terminal and a transcript. A
 * connection string in argv is also visible to every other process on the box for as long as
 * the command runs. PGPASSWORD in the child's environment is neither.
 */
function pgEnv(url: URL, forContainer: boolean): Record<string, string> {
  return {
    PGHOST: forContainer ? forDocker(url.hostname) : url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
}

/** Anything that escapes from a child process is scrubbed before it is printed. */
const redact = (text: string) =>
  text.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1***$2").replace(/PGPASSWORD=\S+/g, "PGPASSWORD=***");

type Runner = (tool: "pg_dump" | "psql", args: string[], url: URL, mount?: string) => string;

function pickRunner(): Runner {
  const onPath = (tool: string) => {
    try {
      execFileSync(tool, ["--version"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  };
  const guard = (fn: () => string) => {
    try {
      return fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redact(message));
    }
  };
  if (onPath("pg_dump") && onPath("psql")) {
    console.log("  using pg_dump/psql from PATH");
    return (tool, args, url) =>
      guard(() =>
        execFileSync(tool, args, {
          encoding: "utf8",
          maxBuffer: 1 << 28,
          env: { ...process.env, ...pgEnv(url, false) },
        }),
      );
  }
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
  } catch {
    console.error(
      "Neither pg_dump/psql nor a running Docker daemon is available." +
        " Install the PostgreSQL client tools (they ship with the server) and run this again." +
        "This drill does not have a mode where it passes without restoring anything.",
    );
    process.exit(1);
  }
  console.log(`  pg_dump/psql are not on PATH; running them from ${image}`);
  // -e NAME (no value) passes the variable through from this process, so nothing secret
  // appears in the container's argv either.
  const passThrough = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"].flatMap((n) => [
    "-e",
    n,
  ]);
  return (tool, args, url, mount) =>
    guard(() =>
      execFileSync(
        "docker",
        [
          "run", "--rm",
          ...passThrough,
          ...(mount ? ["-v", `${mount}:/work`] : []),
          image,
          tool, ...args,
        ],
        {
          encoding: "utf8",
          maxBuffer: 1 << 28,
          env: { ...process.env, ...pgEnv(url, true) },
        },
      ),
    );
}

/**
 * The image tag has to match the server's major version: psql talks to anything, but pg_dump
 * refuses outright ("aborting because of server version mismatch") rather than writing a dump
 * that might not restore. Resolved from the server itself, because this machine and the
 * production container are not necessarily on the same major -- this one is 17 while
 * docker-compose.yml runs 16, and a dump taken from the newer will not load into the older.
 */
let image = "postgres:16-alpine";

const runner = pickRunner();
const run: Runner = (tool, args, url, mount) => runner(tool, args, url, mount);
const sql = (statement: string, url: URL) =>
  run("psql", ["-tAX", "-v", "ON_ERROR_STOP=1", "-c", statement], url).trim();

/**
 * Every table's row count in ONE query.
 *
 * The obvious loop — one `select count(*)` per table — is 36 round trips per database, and
 * when psql is coming from a container that is 36 container starts, which took longer than the
 * dump and the restore put together. query_to_xml runs the counts inside the server.
 */
function countsOf(url: URL): Record<string, number> {
  const rows = sql(
    `select c.relname || '|' ||
            (xpath('/row/n/text()',
                   query_to_xml(format('select count(*) as n from public.%I', c.relname),
                                false, true, '')))[1]::text
       from pg_class c
       join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
    url,
  );
  return Object.fromEntries(
    rows
      .split(String.fromCharCode(10))
      .filter(Boolean)
      .map((line) => {
        const [name, n] = line.split("|");
        return [name, Number(n)];
      }),
  );
}

const work = mkdtempSync(path.join(tmpdir(), "restore-drill-"));
const dumpFile = path.join(work, "dump.sql");

function main() {
  console.log(`\nBackup and restore drill — ${source.pathname.slice(1)} -> ${scratchName}\n`);

  // ---------------------------------------------------------------- what the source holds
  const tables = sql(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    source,
  )
    .split("\n")
    .filter(Boolean);
  if (tables.length === 0) {
    fail("source", "the source database has no tables in the public schema");
    return;
  }
  const before = countsOf(source);

  // psql tolerates a version gap; pg_dump does not, so the image is pinned to the server's own
  // major before anything is dumped.
  const major = Math.floor(Number(sql("show server_version_num", source)) / 10000);
  if (Number.isFinite(major) && major > 0 && image !== `postgres:${major}-alpine`) {
    image = `postgres:${major}-alpine`;
    console.log(`  server is PostgreSQL ${major}; dumping with ${image}`);
  }
  ok("source", `${tables.length} tables, ${Object.values(before).reduce((a, b) => a + b, 0)} rows`);

  // ---------------------------------------------------------------- the backup
  const started = Date.now();
  const dump = run("pg_dump", ["--no-owner", "-f", "/work/dump.sql"], source, work);
  void dump;
  const bytes = statSync(dumpFile).size;
  ok("backup", `${(bytes / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // ---------------------------------------------------------------- the restore
  sql(`drop database if exists "${scratchName}"`, adminUrl);
  sql(`create database "${scratchName}"`, adminUrl);
  const restoreStarted = Date.now();
  run("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-f", "/work/dump.sql"], scratchUrl, work);
  ok("restore", `completed in ${((Date.now() - restoreStarted) / 1000).toFixed(1)}s`);

  // ---------------------------------------------------------------- 3. every row came back
  const after = countsOf(scratchUrl);
  const mismatched = tables.filter((t) => after[t] !== before[t]);
  if (mismatched.length === 0) {
    ok("row counts", `all ${tables.length} tables match the source exactly`);
  } else {
    fail(
      "row counts",
      mismatched.map((t) => `${t}: ${before[t]} -> ${after[t] ?? "missing"}`).join(", "),
    );
  }

  // ---------------------------------------------------------------- 2. RLS survived
  const unprotected = sql(
    `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and exists (
          select 1 from pg_attribute a
           where a.attrelid = c.oid and a.attname = 'tenantId' and a.attnum > 0 and not a.attisdropped
        )
        and not (c.relrowsecurity and c.relforcerowsecurity)
      order by c.relname`,
    scratchUrl,
  )
    .split("\n")
    .filter(Boolean);
  const unexpected = unprotected.filter((t) => !(t in DELIBERATELY_OPEN));
  if (unexpected.length === 0) {
    const policies = Number(
      sql(`select count(*) from pg_policies where schemaname = 'public'`, scratchUrl),
    );
    const open = unprotected.length
      ? `, plus ${unprotected.length} documented exception (${unprotected.join(", ")})`
      : "";
    ok(
      "row security",
      `every tenant-scoped table is ENABLE + FORCE in the copy (${policies} policies${open})`,
    );
  } else {
    fail(
      "row security",
      `restored without forced row security: ${unexpected.join(", ")} — two stores could read each other`,
    );
  }

  // ---------------------------------------------------------------- 1. the role is not in the dump
  const appRole = (process.env.APP_DATABASE_URL ? new URL(process.env.APP_DATABASE_URL).username : "app_user") || "app_user";
  const roleExists =
    sql(`select count(*) from pg_roles where rolname = '${appRole}'`, scratchUrl) !== "0";
  if (roleExists) {
    // Cluster-level, so restoring beside the original always finds it. The point of the check
    // is the other case: a restore onto a NEW machine, which is what a real recovery is.
    const grants = Number(
      sql(
        `select count(*) from information_schema.role_table_grants
          where grantee = '${appRole}' and table_schema = 'public'`,
        scratchUrl,
      ),
    );
    if (grants > 0) {
      ok("runtime role", `${appRole} exists with ${grants} table grants in the copy`);
    } else {
      fail(
        "runtime role",
        `${appRole} exists but has no grants in the restored database — run scripts/sql/rls-role.sql against it`,
      );
    }
  } else {
    fail(
      "runtime role",
      `${appRole} does not exist in this cluster. pg_dump does not write CREATE ROLE, so a ` +
        `restore onto a fresh machine needs scripts/sql/rls-role.sql before the app can connect ` +
        `— and pointing APP_DATABASE_URL at the owner role instead turns RLS off silently`,
    );
  }

  console.log(`
  The half that is yours (P7-24), on the machine that would be recovering:

    APP_DATABASE_URL="${scratchUrl.protocol}//<app_user>:<password>@${scratchUrl.host}/${scratchName}" pnpm start
    then sign in, open a store, and place an order.

  A restore that passes every check above and cannot serve a page has still failed.
`);
}

try {
  main();
} catch (error) {
  failures += 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  try {
    sql(`drop database if exists "${scratchName}"`, adminUrl);
    console.log(`  (scratch database ${scratchName} dropped)`);
  } catch {
    console.error(`  could not drop ${scratchName}; drop it by hand`);
  }
  rmSync(work, { recursive: true, force: true });
  console.log(`\n${checks} checks passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}
