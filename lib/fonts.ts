/**
 * Store fonts: a curated list of Google Fonts the platform admin can pick from in the theme
 * editor, one for headings and one for body text. Stored by id in Tenant.themeOverrides
 * (headingFont / bodyFont) next to the colors; unset means "whatever the template uses".
 *
 * Only ids from this list are ever accepted or rendered, so a stored value can never inject
 * CSS or load an arbitrary stylesheet. Pure and dependency-free: used on the server
 * (storefront) and in the browser (editor, live preview).
 */

export const FONTS = [
  // Sans serif
  { id: "inter", label: "Inter", group: "Sans serif", family: "Inter", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "poppins", label: "Poppins", group: "Sans serif", family: "Poppins", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "montserrat", label: "Montserrat", group: "Sans serif", family: "Montserrat", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "dm-sans", label: "DM Sans", group: "Sans serif", family: "DM Sans", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "work-sans", label: "Work Sans", group: "Sans serif", family: "Work Sans", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "nunito", label: "Nunito", group: "Sans serif", family: "Nunito", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "raleway", label: "Raleway", group: "Sans serif", family: "Raleway", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "space-grotesk", label: "Space Grotesk", group: "Sans serif", family: "Space Grotesk", weights: "300;400;500;600;700", fallback: "sans-serif" },
  // Serif
  { id: "playfair-display", label: "Playfair Display", group: "Serif", family: "Playfair Display", weights: "400;500;600;700", fallback: "serif" },
  { id: "lora", label: "Lora", group: "Serif", family: "Lora", weights: "400;500;600;700", fallback: "serif" },
  { id: "merriweather", label: "Merriweather", group: "Serif", family: "Merriweather", weights: "300;400;700", fallback: "serif" },
  { id: "cormorant-garamond", label: "Cormorant Garamond", group: "Serif", family: "Cormorant Garamond", weights: "300;400;500;600;700", fallback: "serif" },
  { id: "libre-baskerville", label: "Libre Baskerville", group: "Serif", family: "Libre Baskerville", weights: "400;700", fallback: "serif" },
  { id: "dm-serif-display", label: "DM Serif Display", group: "Serif", family: "DM Serif Display", weights: "400", fallback: "serif" },
  // Arabic + Latin
  { id: "cairo", label: "Cairo", group: "Arabic", family: "Cairo", weights: "300;400;500;600;700", fallback: "sans-serif" },
  { id: "tajawal", label: "Tajawal", group: "Arabic", family: "Tajawal", weights: "300;400;500;700", fallback: "sans-serif" },
  { id: "almarai", label: "Almarai", group: "Arabic", family: "Almarai", weights: "300;400;700", fallback: "sans-serif" },
  { id: "ibm-plex-sans-arabic", label: "IBM Plex Sans Arabic", group: "Arabic", family: "IBM Plex Sans Arabic", weights: "300;400;500;600;700", fallback: "sans-serif" },
] as const;

export type FontId = (typeof FONTS)[number]["id"];
export const FONT_IDS = FONTS.map((f) => f.id) as [FontId, ...FontId[]];
export const FONT_GROUPS = ["Sans serif", "Serif", "Arabic"] as const;

export type ThemeFonts = { headingFont?: FontId; bodyFont?: FontId };

const byId = new Map<string, (typeof FONTS)[number]>(FONTS.map((f) => [f.id, f]));

export const isFontId = (v: unknown): v is FontId => typeof v === "string" && byId.has(v);

/** Tolerant read of the stored theme JSON: keep known font ids, drop anything else. */
export function parseThemeFonts(json: unknown): ThemeFonts {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const j = json as Record<string, unknown>;
  return {
    ...(isFontId(j.headingFont) ? { headingFont: j.headingFont } : {}),
    ...(isFontId(j.bodyFont) ? { bodyFont: j.bodyFont } : {}),
  };
}

/** The CSS font-family value for a font, with a generic fallback. */
export function fontStack(id: FontId): string {
  const f = byId.get(id)!;
  return `"${f.family}", ${f.fallback}`;
}

export function fontLabel(id: FontId): string {
  return byId.get(id)!.label;
}

/** One Google Fonts stylesheet URL for the given fonts (duplicates and unset ones skipped). */
export function googleFontsHref(ids: (FontId | undefined)[]): string | null {
  const unique = [...new Set(ids.filter((id): id is FontId => !!id))];
  if (unique.length === 0) return null;
  const families = unique.map((id) => {
    const f = byId.get(id)!;
    return `family=${f.family.replaceAll(" ", "+")}:wght@${f.weights}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/**
 * CSS variables for a store's fonts, set on the theme scope. Body text: --font-sans (what
 * Tailwind's font-sans and inherited text use). Headings: --font-heading (applied to h1-h6 and
 * the brand name by a rule in globals.css) and --font-serif, which templates use for display text.
 */
export function fontVars(fonts: ThemeFonts): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fonts.bodyFont) vars["--font-sans"] = fontStack(fonts.bodyFont);
  if (fonts.headingFont) {
    vars["--font-heading"] = fontStack(fonts.headingFont);
    vars["--font-serif"] = fontStack(fonts.headingFont);
  }
  return vars;
}
