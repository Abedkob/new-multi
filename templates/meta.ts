import type { ThemeColors } from "@/lib/theme";

// Metadata only (no React components), so client code and Zod can import it.

export const TEMPLATE_IDS = ["minimal", "bold", "classic", "tonkic", "fashion", "luxury"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const DEFAULT_TEMPLATE_ID: TemplateId = "minimal";

export const TEMPLATE_META: Record<
  TemplateId,
  { label: string; description: string; defaults: ThemeColors }
> = {
  luxury: {
    label: "Luxury",
    description: "High-end luxury with generous whitespace, clean lines, and serif typography.",
    defaults: {
      primaryColor: "#171717", // near black
      secondaryColor: "#fdfbf7", // warm off-white
      accentColor: "#a38c64", // muted gold
      backgroundColor: "#ffffff",
    },
  },
  fashion: {
    label: "Fashion",
    description: "Modern, chic layout with soft rounded corners and impactful hero.",
    defaults: {
      primaryColor: "#09090b",
      secondaryColor: "#f4f4f5",
      accentColor: "#ec4899",
      backgroundColor: "#ffffff",
    },
  },
  tonkic: {
    label: "Tonkic",
    description: "Modern, clean, gradient hero with floating cards.",
    defaults: {
      primaryColor: "#000000",
      secondaryColor: "#f3f4f6",
      accentColor: "#3b82f6",
      backgroundColor: "#ffffff",
    },
  },
  minimal: {
    label: "Minimal",
    description: "Airy, understated, boutique feel.",
    defaults: {
      primaryColor: "#1f2937",
      secondaryColor: "#f3f4f6",
      accentColor: "#b45309",
      backgroundColor: "#ffffff",
    },
  },
  bold: {
    label: "Bold",
    description: "Big imagery and high-contrast sections.",
    defaults: {
      primaryColor: "#0f0f0f",
      secondaryColor: "#ffe14d",
      accentColor: "#ff3d2e",
      backgroundColor: "#ffffff",
    },
  },
  classic: {
    label: "Classic",
    description: "Traditional shop look: serif headings, bordered cards, structured grids.",
    defaults: {
      primaryColor: "#1e4d8c",
      secondaryColor: "#eef2f7",
      accentColor: "#c2410c",
      backgroundColor: "#ffffff",
    },
  },
};

export function isTemplateId(id: string): id is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

/** Unknown/legacy ids fall back to the default template. */
export function normalizeTemplateId(id: string): TemplateId {
  return isTemplateId(id) ? id : DEFAULT_TEMPLATE_ID;
}
