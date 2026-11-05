/**
 * Renders the installable apps' icon set from the two source marks (D76).
 *
 *   pnpm icons:build
 *
 * Run it when assets/icon-admin.svg or assets/icon-platform.svg changes, and commit what it
 * writes. The output is committed on purpose: a manifest that points at a file the build forgot
 * fails to install on Android with no useful error, so the files exist in the repository rather
 * than being produced at deploy time.
 *
 * Rendered in Chrome rather than with an image library, because the repository already drives
 * system Chrome for every e2e suite and this needs no new native dependency to do it. It also
 * means the PNG is rasterised by the same engine that will later paint the SVG anywhere else —
 * if a mark renders wrong here, it renders wrong in a browser too, which is the useful failure.
 *
 * The background always fills the canvas and the mark is scaled inside it, per variant: see
 * lib/push/icons.ts for how much, and why maskable is tighter.
 */

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { ICON_APPS, iconSet, type IconApp, type IconVariant } from "../lib/push/icons";

const SOURCE_DIR = "assets";
const OUTPUT_DIR = path.join("public", "icons");

type Source = { background: string; mark: string };

/**
 * Splits a source mark into its background colour and the artwork.
 *
 * Deliberately strict: a source file missing either piece throws by name instead of quietly
 * rendering a transparent icon (which Android will install and then show as a grey blob) or a
 * blank one. The two source files document the contract in their own comments.
 */
function readSource(svg: string, app: IconApp): Source {
  const bg = svg.match(/<rect\b[^>]*\bid="bg"[^>]*>/);
  if (!bg) {
    throw new Error(
      `${SOURCE_DIR}/icon-${app}.svg has no <rect id="bg">. An app icon has no transparency: ` +
        "the background colour is read from that element and painted edge to edge.",
    );
  }
  const fill = bg[0].match(/\bfill="([^"]+)"/);
  if (!fill) throw new Error(`${SOURCE_DIR}/icon-${app}.svg: <rect id="bg"> has no fill`);

  // Everything except the background, re-wrapped as its own square SVG so it can be scaled on
  // its own. The viewBox is the source's, so the mark keeps the coordinates it was drawn in.
  const viewBox = svg.match(/\bviewBox="([^"]+)"/);
  if (!viewBox) throw new Error(`${SOURCE_DIR}/icon-${app}.svg has no viewBox`);
  const mark = svg.match(/<g\b[^>]*\bid="mark"[^>]*>[\s\S]*<\/g>/);
  if (!mark) {
    throw new Error(
      `${SOURCE_DIR}/icon-${app}.svg has no <g id="mark">. The artwork has to be one group so ` +
        "the generator can scale it inside the background.",
    );
  }

  return {
    background: fill[1],
    mark:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox[1]}" ` +
      `width="100%" height="100%">${mark[0]}</svg>`,
  };
}

/** One canvas: background edge to edge, mark centred at its variant's scale. */
function pageFor(source: Source, variant: IconVariant): string {
  const inset = ((1 - variant.markScale) / 2) * 100;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  #canvas {
    position: relative;
    width: ${variant.size}px;
    height: ${variant.size}px;
    background: ${source.background};
  }
  #mark { position: absolute; inset: ${inset}%; }
</style></head>
<body><div id="canvas"><div id="mark">${source.mark}</div></div></body></html>`;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let written = 0;
  try {
    for (const app of ICON_APPS) {
      const source = readSource(
        await readFile(path.join(SOURCE_DIR, `icon-${app}.svg`), "utf8"),
        app,
      );
      for (const variant of iconSet(app)) {
        const page = await browser.newPage({
          viewport: { width: variant.size, height: variant.size },
          // 1, so the PNG is exactly the number of pixels the manifest claims. A retina-ish
          // scale factor would silently produce a 1024px file labelled 512x512, which
          // verify:icons reads out of the PNG header and rejects.
          deviceScaleFactor: 1,
        });
        await page.setContent(pageFor(source, variant), { waitUntil: "load" });
        const png = await page.locator("#canvas").screenshot({ type: "png" });
        await writeFile(path.join(OUTPUT_DIR, path.basename(variant.src)), png);
        await page.close();
        written += 1;
        console.log(
          `  wrote ${variant.src}  ${variant.size}x${variant.size}` +
            `  mark ${Math.round(variant.markScale * 100)}%` +
            `  ${variant.purpose ?? variant.target}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${written} icons written to ${OUTPUT_DIR}. Commit them.`);
  console.log("Then: pnpm verify:icons");
}

main().catch((error) => {
  console.error("\nICON BUILD FAILED\n", error);
  process.exitCode = 1;
});
