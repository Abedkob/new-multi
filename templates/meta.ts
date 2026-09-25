import type { ThemeColors } from "@/lib/theme";

// Metadata only (no React components), so client code and Zod can import it.

export const TEMPLATE_IDS = ["minimal", "classic", "tonkic", "fashion", "luxury", "atelier", "atlas", "pearl", "drop", "kinetic", "mirage"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const DEFAULT_TEMPLATE_ID: TemplateId = "minimal";

export const TEMPLATE_META: Record<
  TemplateId,
  { label: string; description: string; defaults: ThemeColors }
> = {
  mirage: {
    label: "Mirage",
    description:
      "Immersive technology retail: full-bleed campaign imagery, fast category paths and clean product-led layouts for phones and accessories.",
    defaults: {
      primaryColor: "#08131f",
      secondaryColor: "#edf2f6",
      accentColor: "#4f8cff",
      backgroundColor: "#ffffff",
    },
  },
  kinetic: {
    label: "Kinetic",
    description:
      "Cinematic product storytelling: a layered type-and-image hero, scroll-directed category film and interactive product stage with a direct mobile experience.",
    defaults: {
      primaryColor: "#101010",
      secondaryColor: "#f5f2ea",
      accentColor: "#3155ff",
      backgroundColor: "#ffffff",
    },
  },
  atlas: {
    label: "Atlas",
    description:
      "Swiss index: hairline grid cells, heavy uppercase type, monospace numbering, a bento category mosaic and a ranked best-seller ledger.",
    defaults: {
      primaryColor: "#111827",
      secondaryColor: "#f3f4f6",
      accentColor: "#2563eb",
      backgroundColor: "#ffffff",
    },
  },
  pearl: {
    label: "Pearl",
    description:
      "Multi-brand department store: full-bleed hero, horizontal product rails, a two-up editorial category mosaic and a dark promo band.",
    defaults: {
      primaryColor: "#141414",
      secondaryColor: "#f4f2ee",
      accentColor: "#a13d2c",
      backgroundColor: "#ffffff",
    },
  },
  drop: {
    label: "Drop",
    description:
      "Chaptered hype drop in daylight: a hover-swapped category directory, a lookbook spotlight instead of a grid, a watermarked best-seller list and a marquee promo band. No product grids up top.",
    defaults: {
      primaryColor: "#0a0a0a", // near black, solid CTA blocks
      secondaryColor: "#eeece4", // warm light gray, alternate sections
      accentColor: "#c8e600", // neon lime, the one pop of color
      backgroundColor: "#f7f7f2", // soft off-white, not stark white
    },
  },
  atelier: {
    label: "Atelier",
    description:
      "Editorial fashion magazine: oversized italic type, arched photos, a running ticker and a lookbook category index.",
    defaults: {
      primaryColor: "#4a1d2f", // deep wine
      secondaryColor: "#f3e4dd", // blush
      accentColor: "#c07a62", // terracotta rose
      backgroundColor: "#fcf8f5", // warm cream
    },
  },
  luxury: {
    label: "Luxury",
    description:
      "Celestial couture: starfield bands, a planet hero ringed by turning orbits, categories set like planets and an eclipse promo.",
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
