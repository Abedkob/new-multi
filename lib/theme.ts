import type { CSSProperties } from "react";
import { z } from "zod";

/**
 * Per-store colors live in Tenant.themeOverrides (all optional). Templates never
 * own colors: ThemeScope turns the resolved colors into CSS variables and the
 * templates only consume them (through the shadcn tokens mapped in ThemeScope).
 */

export const THEME_FIELDS = [
  {
    key: "primaryColor",
    label: "Primary",
    hint: "Buttons, links, headers",
  },
  {
    key: "secondaryColor",
    label: "Secondary",
    hint: "Alternate sections, footer, cards",
  },
  {
    key: "accentColor",
    label: "Accent",
    hint: "Highlights, prices, badges",
  },
  {
    key: "backgroundColor",
    label: "Background",
    hint: "Page background",
  },
] as const;

export type ThemeKey = (typeof THEME_FIELDS)[number]["key"];
export type ThemeColors = Record<ThemeKey, string>;
export type ThemeOverrides = Partial<ThemeColors>;

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1a2b3c")
  .transform((v) => v.toLowerCase());

export const themeOverridesSchema = z.object({
  primaryColor: hexColorSchema.optional(),
  secondaryColor: hexColorSchema.optional(),
  accentColor: hexColorSchema.optional(),
  backgroundColor: hexColorSchema.optional(),
});

/** The form always submits all four colors, so they are all required there. */
export const themeFormSchema = z.object({
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  backgroundColor: hexColorSchema,
});

/** Tolerant read of the stored JSON: keep valid colors, silently drop anything else. */
export function parseThemeOverrides(json: unknown): ThemeOverrides {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return {};
  }
  const out: ThemeOverrides = {};
  for (const { key } of THEME_FIELDS) {
    const parsed = hexColorSchema.safeParse((json as Record<string, unknown>)[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export function resolveTheme(
  defaults: ThemeColors,
  overrides: ThemeOverrides,
): ThemeColors {
  return { ...defaults, ...overrides };
}

const DARK_TEXT = "#111111";
const LIGHT_TEXT = "#ffffff";

function relativeLuminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Near-black or white, whichever has the higher WCAG contrast ratio on `hex`. */
export function readableOn(hex: string) {
  const l = relativeLuminance(hex);
  const withLight = 1.05 / (l + 0.05);
  const withDark = (l + 0.05) / (relativeLuminance(DARK_TEXT) + 0.05);
  return withDark > withLight ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * CSS variables injected at the root of a storefront.
 *  --color-primary/secondary/accent/background come straight from the theme;
 *  the --color-on-* / text / muted / border values are derived from them.
 * The shadcn tokens (--primary, --secondary, ...) are then pointed at those, so
 * shadcn components and the templates' Tailwind classes (bg-primary, text-accent,
 * border-border, ...) all follow the store's colors.
 */
export function themeStyle(colors: ThemeColors): CSSProperties {
  const vars: Record<string, string> = {
    "--color-primary": colors.primaryColor,
    "--color-secondary": colors.secondaryColor,
    "--color-accent": colors.accentColor,
    "--color-background": colors.backgroundColor,
    "--color-on-primary": readableOn(colors.primaryColor),
    "--color-on-secondary": readableOn(colors.secondaryColor),
    "--color-on-accent": readableOn(colors.accentColor),
    "--color-text": readableOn(colors.backgroundColor),
    "--color-muted":
      "color-mix(in oklab, var(--color-text) 6%, var(--color-background))",
    "--color-muted-text":
      "color-mix(in oklab, var(--color-text) 62%, var(--color-background))",
    "--color-border":
      "color-mix(in oklab, var(--color-text) 14%, var(--color-background))",

    // shadcn/ui tokens
    "--background": "var(--color-background)",
    "--foreground": "var(--color-text)",
    "--card": "var(--color-background)",
    "--card-foreground": "var(--color-text)",
    "--popover": "var(--color-background)",
    "--popover-foreground": "var(--color-text)",
    "--primary": "var(--color-primary)",
    "--primary-foreground": "var(--color-on-primary)",
    "--secondary": "var(--color-secondary)",
    "--secondary-foreground": "var(--color-on-secondary)",
    "--accent": "var(--color-accent)",
    "--accent-foreground": "var(--color-on-accent)",
    "--muted": "var(--color-muted)",
    "--muted-foreground": "var(--color-muted-text)",
    "--border": "var(--color-border)",
    "--input": "var(--color-border)",
    "--ring": "var(--color-primary)",
  };
  return vars as CSSProperties;
}

/** Quick-start color schemes offered in the platform admin's theme editor. */
export const COLOR_SCHEMES: { id: string; label: string; colors: ThemeColors }[] = [
  {
    id: "ocean",
    label: "Ocean",
    colors: {
      primaryColor: "#0f4c81",
      secondaryColor: "#dbeafe",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
    },
  },
  {
    id: "forest",
    label: "Forest",
    colors: {
      primaryColor: "#14532d",
      secondaryColor: "#ecfccb",
      accentColor: "#c2410c",
      backgroundColor: "#fafaf5",
    },
  },
  {
    id: "berry",
    label: "Berry",
    colors: {
      primaryColor: "#831843",
      secondaryColor: "#fce7f3",
      accentColor: "#0d9488",
      backgroundColor: "#fffafc",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    colors: {
      primaryColor: "#a78bfa",
      secondaryColor: "#1e1b4b",
      accentColor: "#fbbf24",
      backgroundColor: "#0f0d1f",
    },
  },
];
