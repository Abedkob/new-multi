/**
 * Bundles the operational commands into files the production image can run (`pnpm build:job`).
 *
 * Why this exists. `scripts/analytics-scheduled.ts` is TypeScript, it imports through the `@/*`
 * alias, and it runs under `tsx` — a devDependency. None of those survive into the runtime
 * image: the Dockerfile's last stage copies Next's standalone output, `prisma`, `dotenv` and
 * `pg`, and exactly one script (`ensure-app-role.cjs`). So for seven phases the deploy runbooks
 * told an operator to schedule `pnpm analytics:scheduled` inside a container where neither the
 * script nor the runtime to execute it existed. Nothing aggregated, `AnalyticsScheduledRun`
 * stayed empty, and because the rollout was `off` nobody was looking at a figure that would have
 * been wrong.
 *
 * The seed is here for the same reason and it is worse: `prisma db seed` shells out to
 * `tsx prisma/seed.ts` (prisma.config.ts), so `docker exec … pnpm db:seed` — the documented way
 * to create the first platform admin in production — could never have worked either. Found by
 * `verify:container-commands` as soon as it existed.
 *
 * Why a bundle rather than shipping `tsx` and the sources. esbuild resolves the whole import
 * graph HERE, at build time, so a module that would not have made it into the image fails the
 * build instead of a 3am cron. That matters most for the stage that runs last: `retention` is
 * the one that deletes rows, so it is the one you least want to discover a missing import from.
 *
 * ESM, not CJS, and not negotiable: the generated Prisma client reads `import.meta.url` to
 * rebuild `__dirname`, which a CommonJS bundle has no way to provide.
 *
 * Almost everything is bundled, including node_modules, and that is the opposite of what it
 * looked like it should be. The first version left every package external on the reasoning that
 * the standalone output has them already — and it does not. Next *bundles* the app's
 * dependencies into its compiled server chunks, so `.next/standalone/node_modules` holds five
 * packages (`next`, `react`, `react-dom`, `pg`, `@aws-sdk`) and nothing else. `zod`, `redis`,
 * `web-push`, `bcryptjs` and the Prisma client are simply not there as resolvable modules. An
 * externalized bundle would therefore have thrown ERR_MODULE_NOT_FOUND the first time the
 * scheduler ran in production — the same class of failure as the defect this file exists to fix,
 * found only because the bundle was resolved against a real standalone tree rather than against
 * a developer's flat node_modules, where everything is present and nothing proves anything.
 *
 * So: `EXTERNAL` is the short list of what must NOT be bundled, and it is justified per entry.
 * Everything else — first-party and third-party alike — goes in.
 */

/**
 * `pg` is bundled, although it IS one of the five packages Next traces into the standalone
 * output. The trace is partial: it carries `pg` and `pg-types` but not `postgres-array`, which
 * `pg-types/lib/textParsers.js` requires at load — Next only traces what the web app's own code
 * paths reach. A fresh `require("pg")` from this bundle therefore found the traced copy first
 * (local node_modules beats NODE_PATH) and died on its missing dependency, which is precisely
 * the failure the image would have had. Measured, not reasoned: the bundle was run against a
 * real `.next/standalone` tree.
 */
const EXTERNAL = [
  // Optional native binding; node-postgres falls back to pure JS and the image never has it.
  "pg-native",
  // node-redis's two optional extras, behind dynamic `import()` inside a try/catch that throws a
  // readable error if they are missing. They are not installed in development either, so the
  // limiter and presence paths already run without them — leaving them external changes nothing
  // and bundling them is not possible.
  "@node-rs/xxhash",
  "@opentelemetry/api",
];

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { builtinModules } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENTRY_POINTS = {
  "analytics-scheduled": "scripts/analytics-scheduled.ts",
  seed: "prisma/seed.ts",
};

const result = await build({
  entryPoints: Object.fromEntries(
    Object.entries(ENTRY_POINTS).map(([name, source]) => [name, path.join(root, source)]),
  ),
  outdir: path.join(root, "dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Bundled CommonJS calls `require()`, and an ESM output has none — esbuild's own shim looks for
  // a `require` in scope and throws `Dynamic require of "fs" is not supported` when there is not
  // one. dotenv was the first casualty, two frames into startup. Found by running the bundle, not
  // by reading it.
  banner: {
    js: `import { createRequire as __jobCreateRequire } from "node:module";\nconst require = __jobCreateRequire(import.meta.url);`,
  },
  sourcemap: true,
  // The runner reports failures through exit codes a scheduler acts on; keeping names intact
  // keeps a stack trace in those logs readable.
  minify: false,
  keepNames: true,
  logLevel: "info",
  metafile: true,
  external: EXTERNAL,
  tsconfig: path.join(root, "tsconfig.json"),
});

// What the OUTPUT still imports is the only honest list of externals. The metafile's per-INPUT
// flags are not: they mark `@prisma/client/runtime/client` external although esbuild inlines it
// (an ESM module importing a CJS one), so a check built on them fails on a bundle that is
// actually complete. Checked after the build rather than from an esbuild onEnd hook, because
// errors pushed from onEnd do not fail build() — which this script found out by writing it that
// way first and watching a "clean" build report three externals.
const externals = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const spec of output.imports.map((i) => i.path)) {
    const bare = spec.replace(/^node:/, "");
    if (builtinModules.includes(bare)) continue;
    externals.add(spec);
  }
}

for (const name of Object.keys(ENTRY_POINTS)) {
  console.log(`[build:job] dist/${name}.mjs`);
}
console.log(
  `[build:job] ${Object.keys(result.metafile.inputs).length} modules bundled in total`,
);

const unexpected = [...externals].filter((spec) => !EXTERNAL.includes(spec));
if (unexpected.length > 0) {
  console.error(
    `[build:job] left external but not in EXTERNAL: ${unexpected.sort().join(", ")}
` +
      `            Next bundles the app's dependencies into its server chunks, so ` +
      `.next/standalone/node_modules contains only next, react, react-dom, pg and @aws-sdk. ` +
      `Anything else left external resolves to nothing in the image. Either bundle it (remove ` +
      `it from EXTERNAL and any ignore), or justify it in EXTERNAL with the reason it is ` +
      `resolvable there.`,
  );
  process.exit(1);
}
console.log(`[build:job] external, and resolvable in the image: ${EXTERNAL.join(", ")}`);
