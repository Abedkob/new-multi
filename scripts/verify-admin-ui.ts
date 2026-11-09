/**
 * The admin panel's UI baseline, checked statically. ADMIN_UI.md is the prose; this is the part a
 * machine can hold down. No server, no database, no browser.
 *
 * Four rules, each one a thing that actually happened in this codebase rather than a style
 * preference:
 *
 *   1. **`components/ui/card` is not imported under `app/admin`.** It is a different object from
 *      `SectionCard` — ring instead of border, a larger radius, its own spacing variable — and
 *      nine admin files used both on the same screen.
 *   2. **A panel names its surface.** The page shell is `bg-muted/40`; 23 of 33 bordered panels
 *      declared no `bg-*` and were therefore transparent, sitting beside opaque ones.
 *   3. **One `h1` per page.** A page inside a section layout (Analytics, Marketing) inherits that
 *      layout's `PageHeader`, so its own heading is an `h2` — `SectionHeading`.
 *   4. **No physical-direction classes.** `ml-`, `pr-`, `left-` break Arabic. Logical properties
 *      only.
 *
 * `PENDING` is the honest part: the screens not yet converted. The check asserts the list does not
 * **grow** and that every entry still earns its place — an entry that is already clean fails, so
 * the list cannot rot into a permanent exemption. It shrinks as screens are converted, and the fix
 * for a new violation is never to add a line to it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let checks = 0;
let failures = 0;

function ok(name: string) {
  checks++;
  console.log(`  ok  ${name}`);
}

function fail(name: string, detail: string) {
  checks++;
  failures++;
  console.log(`  FAIL  ${name}\n        ${detail}`);
}

/** Files still carrying pre-baseline markup. Shrinks; never grows. */
const PENDING = new Set<string>([
  "(panel)/categories/page.tsx",
  "(panel)/delivery/delivery-settings-form.tsx",
  "(panel)/discounts/page.tsx",
  "(panel)/discounts/discount-form.tsx",
  "(panel)/discounts/discount-product-picker.tsx",
  "(panel)/discounts/coupons/page.tsx",
  "(panel)/discounts/[id]/edit/page.tsx",
  "(panel)/discounts/coupons/coupon-form.tsx",
  "(panel)/marketing/integrations/integrations-form.tsx",
  "(panel)/orders/[id]/page.tsx",
  "(panel)/social-links/social-links-form.tsx",
  "(panel)/staff/staff-manager.tsx",
  "change-password/page.tsx",
]);

const ADMIN = "app/admin";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = walk(ADMIN).map((f) => ({
  path: f,
  key: relative(ADMIN, f).split("\\").join("/"),
  source: readFileSync(f, "utf8"),
}));

console.log(`\nThe admin UI baseline (ADMIN_UI.md), over ${files.length} files under ${ADMIN}/\n`);

/** Strips comments and string-literal noise so a rule reads markup, not prose about markup. */
const markup = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

type Rule = {
  name: string;
  /** Returns the offending excerpts in a file, or an empty array. */
  violations: (file: { key: string; source: string }) => string[];
};

const RULES: Rule[] = [
  {
    name: "components/ui/card is not used in /admin (SectionCard is the panel)",
    violations: ({ source }) => {
      const m = markup(source).match(/^.*from "@\/components\/ui\/card".*$/m);
      return m ? [m[0].trim()] : [];
    },
  },
  {
    name: "every panel names its surface (the page shell is bg-muted/40)",
    violations: ({ source }) => {
      const found: string[] = [];
      // A bordered, rounded box in a className that never says what colour it is.
      for (const m of markup(source).matchAll(/className=(?:"|\{`)([^"`]*rounded-(?:sm|md|lg|xl|2xl)\s+border[^"`]*)(?:"|`\})/g)) {
        const classes = m[1];
        // A DASHED box is exempt, and the distinction is a real one: dashed means provisional —
        // an empty-table note, a "not measuring yet" placeholder — and it is drawn INSIDE a
        // panel, on whatever surface that panel already established. Giving it `bg-card` would
        // stack a second card inside the first. A SOLID border is a panel, and a panel must say
        // what colour it is.
        if (/\bborder-dashed\b/.test(classes)) continue;
        if (!/\bbg-[a-z]/.test(classes)) found.push(classes.trim().slice(0, 100));
      }
      return found;
    },
  },
  {
    name: "no physical-direction classes (Arabic reads the other way)",
    violations: ({ source }) => {
      const found: string[] = [];
      // The classes themselves, bounded by quote/brace/space so `ml-2` matches and a word
      // ending in those letters does not.
      for (const m of markup(source).matchAll(
        /(?:^|["'`\s{(])((?:ml|mr|pl|pr)-(?:\d+|px|auto)|(?:left|right)-(?:\d+|px|full|auto))(?=["'`\s}),])/g,
      )) {
        found.push(m[1]);
      }
      return [...new Set(found)];
    },
  },
];

for (const rule of RULES) {
  const offenders = files
    .map((f) => ({ key: f.key, hits: rule.violations(f) }))
    .filter((r) => r.hits.length > 0);

  const unexpected = offenders.filter((r) => !PENDING.has(r.key));
  if (unexpected.length === 0) {
    ok(`${rule.name}${offenders.length ? ` (${offenders.length} pending file(s))` : ""}`);
  } else {
    fail(
      rule.name,
      unexpected
        .map((r) => `${r.key}\n          ${r.hits.slice(0, 3).join("\n          ")}`)
        .join("\n        "),
    );
  }
}

// One h1 per document: a page under a section layout must not add a second one.
{
  const sectionDirs = files
    .filter((f) => f.key.endsWith("layout.tsx") && f.source.includes("PageHeader"))
    .map((f) => f.key.replace(/layout\.tsx$/, ""))
    .filter((d) => d !== "(panel)/");
  const offenders = files.filter(
    (f) =>
      f.key.endsWith("page.tsx") &&
      sectionDirs.some((d) => f.key.startsWith(d)) &&
      (/\<h1[\s>]/.test(f.source) || /PageHeader/.test(f.source)),
  );
  if (offenders.length === 0) {
    ok(`one h1 per page (${sectionDirs.length} section layout(s) own theirs)`);
  } else {
    fail(
      "one h1 per page",
      `these sit under a section layout that already renders a PageHeader:\n        ` +
        offenders.map((f) => f.key).join("\n        "),
    );
  }
}

// The pending list must not rot: an entry that no longer violates anything has to come off it.
{
  const stillDirty = new Set(
    files
      .filter((f) => RULES.some((r) => r.violations(f).length > 0))
      .map((f) => f.key),
  );
  const stale = [...PENDING].filter((key) => !stillDirty.has(key));
  if (stale.length === 0) {
    ok(`every one of the ${PENDING.size} pending files still needs converting`);
  } else {
    fail(
      "the pending list has stale entries",
      `these are clean now — remove them from PENDING:\n        ` + stale.join("\n        "),
    );
  }
}

console.log(
  `\n${checks - failures}/${checks} baseline checks passed` +
    (failures ? ` — ${failures} FAILED\n` : `, ${PENDING.size} file(s) left to convert\n`),
);
if (failures) process.exitCode = 1;
