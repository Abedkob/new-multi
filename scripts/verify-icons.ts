/**
 * The installable apps' icons, checked against the files that are actually committed (D76).
 *
 *   pnpm verify:icons
 *
 * Static: no server, no database, no browser. That matters, because the failure this guards
 * against happens on somebody else's phone. Android refuses to install a web app whose manifest
 * names an icon it cannot fetch, and it does not say which one or why — the install button
 * simply does nothing. iOS is worse: it ignores the manifest entirely, and a missing
 * apple-touch-icon is not an error at all, just a Home Screen tile showing a screenshot of the
 * page. Neither shows up in any test that does not look at the files themselves.
 *
 * So this reads the real manifest output, resolves every src against public/, and opens each
 * PNG far enough to confirm it is a PNG and that its own header agrees with the size the
 * manifest advertises. A 512-byte placeholder named icon-512.png passes every other check in
 * this repository.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { adminManifest, platformManifest } from "../lib/push/manifest";
import { ICON_APPS, appleTouchIcon, iconSet, type IconApp } from "../lib/push/icons";

const PUBLIC_DIR = "public";
const ICON_DIR = path.join(PUBLIC_DIR, "icons");

let checks = 0;
let failures = 0;
const ok = (label: string, detail: string) => {
  checks += 1;
  console.log(`  ok  ${label.padEnd(12)} ${detail}`);
};
const fail = (label: string, detail: string) => {
  failures += 1;
  console.error(`  FAIL ${label.padEnd(12)} ${detail}`);
};

/**
 * Width and height out of the PNG's own IHDR chunk.
 *
 * Reading the header rather than trusting the filename is the whole point: the generator runs
 * Chrome at deviceScaleFactor 1 precisely so these agree, and a change to that would otherwise
 * produce a 1024px image labelled 512x512 that installs with a blurry or rejected icon.
 */
function pngSize(file: string): { width: number; height: number } | null {
  const bytes = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const fileFor = (src: string) => path.join(PUBLIC_DIR, src.replace(/^\//, ""));

function checkIcon(label: string, src: string, expectedSize: number) {
  const file = fileFor(src);
  if (!existsSync(file)) {
    fail(label, `${src} is named but ${file} does not exist — run pnpm icons:build and commit it`);
    return;
  }
  const size = pngSize(file);
  if (!size) {
    fail(label, `${src} is not a PNG (no signature or no IHDR): ${file}`);
    return;
  }
  if (size.width !== expectedSize || size.height !== expectedSize) {
    fail(
      label,
      `${src} claims ${expectedSize}x${expectedSize} but the file is ${size.width}x${size.height}`,
    );
    return;
  }
  ok(label, `${src} is a real ${size.width}x${size.height} PNG`);
}

console.log("\nInstallable app icons\n");

// ------------------------------------------------- what each manifest actually serves
const manifests: Record<IconApp, ReturnType<typeof adminManifest>> = {
  admin: adminManifest(),
  platform: platformManifest(),
};

for (const app of ICON_APPS) {
  const icons = manifests[app].icons;
  if (icons.length === 0) {
    fail("manifest", `the ${app} manifest lists no icons at all`);
    continue;
  }
  for (const icon of icons) {
    const declared = Number(icon.sizes.split("x")[0]);
    if (!Number.isFinite(declared)) {
      fail("manifest", `the ${app} manifest declares sizes "${icon.sizes}", which is not NxN`);
      continue;
    }
    checkIcon("manifest", icon.src, declared);
  }

  // Without one of these, an Android launcher crops the plain icon to its own shape and cuts
  // into the artwork. With one, it masks the maskable variant, which is drawn to survive it.
  if (icons.some((icon) => icon.purpose === "maskable")) {
    ok("maskable", `the ${app} manifest offers a maskable icon`);
  } else {
    fail("maskable", `the ${app} manifest has no maskable icon — launchers will crop the mark`);
  }
}

// ------------------------------------------------- the iOS half, which no manifest covers
const APPLE_LINKED_IN: Record<IconApp, string> = {
  admin: "app/admin/layout.tsx",
  platform: "app/platform/(admin)/layout.tsx",
};

for (const app of ICON_APPS) {
  const src = appleTouchIcon(app);
  const variant = iconSet(app).find((icon) => icon.src === src)!;
  checkIcon("apple-touch", src, variant.size);

  // An icon that exists and is linked from nowhere is the same as no icon, and that is exactly
  // what this would look like: a committed PNG, a passing file check, and a Home Screen tile
  // showing a screenshot of the page.
  const layout = APPLE_LINKED_IN[app];
  const source = existsSync(layout) ? readFileSync(layout, "utf8") : "";
  if (source.includes(`appleTouchIcon("${app}")`)) {
    ok("apple-link", `${layout} links the ${app} apple-touch icon`);
  } else {
    fail(
      "apple-link",
      `${layout} does not link the ${app} apple-touch icon. iOS ignores the manifest, so ` +
        "without this the Home Screen shows a screenshot of the page instead of an icon",
    );
  }
}

// ------------------------------------------------- two apps, two icons
// §11.1's whole reason for two manifests. An operator who taps the wrong one of two identical
// Home Screen icons is looking at another tenant's data before they notice, so "different mark"
// is a requirement rather than a preference — and one recoloured copy of the other would pass
// every check above.
// Missing files are already reported above, so this reads them defensively rather than
// throwing: a run that cannot finish reports one problem, and a run that finishes reports all
// of them. Found by breaking an icon on purpose and watching this crash before the summary.
const marks = ICON_APPS.map((app) => {
  const file = fileFor(`/icons/${app}-512.png`);
  return {
    app,
    digest: existsSync(file)
      ? createHash("sha256").update(readFileSync(file)).digest("hex")
      : null,
  };
});
const digests = marks.map((m) => m.digest).filter((d): d is string => d !== null);
if (digests.length < marks.length) {
  fail("distinct", "cannot compare the two apps' marks while an icon is missing (see above)");
} else if (new Set(digests).size === marks.length) {
  ok("distinct", "the merchant and platform apps install with different icons");
} else {
  fail("distinct", `two apps share an icon: ${JSON.stringify(marks)}`);
}

// ------------------------------------------------- the generator's contract with its sources
// build-icons.ts reads the background colour out of the source and paints it edge to edge; an
// app icon with a transparent corner is a grey blob once a launcher masks it.
for (const app of ICON_APPS) {
  const file = path.join("assets", `icon-${app}.svg`);
  const svg = existsSync(file) ? readFileSync(file, "utf8") : "";
  const bg = /<rect\b[^>]*\bid="bg"[^>]*\bfill="[^"]+"/.test(svg);
  const mark = /<g\b[^>]*\bid="mark"/.test(svg);
  if (bg && mark) {
    ok("source", `${file} has a background fill and a mark group`);
  } else {
    fail(
      "source",
      `${file} is missing ${!bg ? '<rect id="bg" fill="...">' : '<g id="mark">'} — ` +
        "scripts/build-icons.ts needs both and will refuse to run",
    );
  }
}

// ------------------------------------------------- nothing stale left behind
// A renamed variant leaves its old file in public/icons, where it is dead weight that looks
// current. Nothing breaks; it just quietly becomes wrong.
const expected = new Set(ICON_APPS.flatMap((app) => iconSet(app).map((i) => path.basename(i.src))));
const orphans = existsSync(ICON_DIR)
  ? readdirSync(ICON_DIR).filter((f) => !expected.has(f))
  : [];
if (orphans.length === 0) {
  ok("no-orphans", `${ICON_DIR} holds only the ${expected.size} icons the set declares`);
} else {
  fail("no-orphans", `${ICON_DIR} holds files no app names: ${orphans.join(", ")}`);
}

console.log(`\n${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
