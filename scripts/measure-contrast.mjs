/**
 * WCAG contrast for the new panel palette, computed from the oklch values themselves.
 *
 * ADMIN_UI.md §9 records that the dark accent was once set to oklch(0.58 …) because arithmetic
 * on paper said it was fine; measured, it came to 4.20:1 and failed. The hue moved on every
 * token in this pass, so every pair that carries text gets measured again.
 */

// oklch -> linear sRGB, then relative luminance. Straight from the OKLab spec.
function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function ratio(fg, bg) {
  const a = luminance(oklchToLinearSrgb(...fg));
  const b = luminance(oklchToLinearSrgb(...bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB hex -> the linear triple `luminance` expects, for palette colours that are not tokens.
 *  The pending-orders badge is Tailwind amber, chosen for meaning rather than from the accent
 *  ramp, so it cannot be written as an oklch token here. */
function hexToLinearSrgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
}

function hexRatio(fg, bg) {
  const a = luminance(hexToLinearSrgb(fg));
  const b = luminance(hexToLinearSrgb(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = {
  background: [0.977, 0.005, 75],
  card: [1, 0, 0],
  foreground: [0.22, 0.014, 255],
  mutedForeground: [0.495, 0.012, 255],
  primary: [0.48, 0.16, 255],
  primaryText: [0.48, 0.16, 255],
  primaryForeground: [0.99, 0, 0],
  destructive: [0.55, 0.21, 27],
  sidebar: [0.955, 0.008, 75],
  sidebarPrimary: [0.48, 0.16, 255],
};

const DARK = {
  background: [0.175, 0.012, 255],
  card: [0.225, 0.014, 255],
  foreground: [0.97, 0.004, 255],
  mutedForeground: [0.735, 0.012, 255],
  primary: [0.55, 0.16, 255],
  primaryText: [0.66, 0.14, 255],
  primaryForeground: [0.99, 0, 0],
  destructive: [0.68, 0.19, 25],
  sidebar: [0.205, 0.013, 255],
  sidebarPrimary: [0.55, 0.16, 255],
};

// Every pair where text sits on a surface. `floor` is the line that pair has to clear: 4.5 for
// body text, 3.0 only where the text is large (a figure, a page title).
const PAIRS = (t) => [
  ["body on page", t.foreground, t.background, 4.5],
  ["body on card", t.foreground, t.card, 4.5],
  ["meta on page", t.mutedForeground, t.background, 4.5],
  ["meta on card", t.mutedForeground, t.card, 4.5],
  ["meta on sidebar", t.mutedForeground, t.sidebar, 4.5],
  ["button label on accent", t.primaryForeground, t.primary, 4.5],
  ["active nav label on accent", t.primaryForeground, t.sidebarPrimary, 4.5],
  // These two read `--primary-text`, not `--primary`. That is the whole reason the token
  // exists: in dark, `--primary` as text measures 3.49:1 on a card.
  ["accent as link text on page", t.primaryText, t.background, 4.5],
  ["accent as link text on card", t.primaryText, t.card, 4.5],
  ["destructive text on card", t.destructive, t.card, 4.5],
];

let failed = 0;
for (const [scheme, tokens] of [["LIGHT", LIGHT], ["DARK", DARK]]) {
  console.log(`\n${scheme}`);
  for (const [name, fg, bg, floor] of PAIRS(tokens)) {
    const r = ratio(fg, bg);
    const ok = r >= floor;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(30)} ${r.toFixed(2)}:1  (needs ${floor})`);
  }
}

// The pending-orders badge, which is not a token pair and was the worst ratio in the product:
// `bg-amber-500 text-white` measured 2.15:1, on the one element whose whole job is to be read at
// a glance across a room. The same chip appears in the sidebar and the phone header.
console.log("\nBADGES");
for (const [name, fg, bg, floor] of [["pending orders", "#451a03", "#fbbf24", 4.5]]) {
  const r = hexRatio(fg, bg);
  const ok = r >= floor;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(30)} ${r.toFixed(2)}:1  (needs ${floor})`);
}

console.log(failed ? `\n${failed} pair(s) under the line.` : "\nEvery pair clears its line.");
process.exitCode = failed ? 1 : 0;
