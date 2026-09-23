/**
 * The fallback favicon for a store without one: the store name's first letter on its primary
 * theme color, as an inline SVG data URI (no request, nothing stored). Pure and dependency-free,
 * so client components can use it too.
 *
 * Safe to inline: the SVG is built here from one escaped character and a hex color that's been
 * validated, never from owner-supplied markup.
 */
export function letterFavicon(storeName: string, color: string): string {
  const letter = [...storeName.trim()][0]?.toUpperCase() ?? "S";
  const bg = /^#[0-9a-f]{6}$/i.test(color) ? color : "#111111";
  const escaped = letter.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Arial,sans-serif" ` +
    `font-size="38" font-weight="700" fill="${readableOn(bg)}">${escaped}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Black or white, whichever reads better on the given #rrggbb background. */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111111" : "#ffffff";
}
