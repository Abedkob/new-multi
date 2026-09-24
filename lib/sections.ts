import { z } from "zod";

/**
 * The storefront is a fixed sequence of sections, identical in every template.
 * Only the four OPTIONAL ones can be switched off by the store owner; the other
 * seven are always shown. Templates differ only in how each section looks.
 */

export const OPTIONAL_SECTIONS = [
  "announcementBar",
  "heroText",
  "promoBanner",
  "brandStory",
  "reviews",
] as const;
export type OptionalSection = (typeof OPTIONAL_SECTIONS)[number];
export type SectionVisibility = Record<OptionalSection, boolean>;

export const VISIBILITY_DEFAULTS: SectionVisibility = {
  announcementBar: true,
  heroText: true,
  promoBanner: false,
  brandStory: true,
  reviews: true,
};

/** Tolerant read of Tenant.sectionVisibility: valid booleans win, everything else is defaulted. */
export function parseSectionVisibility(json: unknown): SectionVisibility {
  const out = { ...VISIBILITY_DEFAULTS };
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return out;
  }
  for (const key of OPTIONAL_SECTIONS) {
    const v = (json as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

export const optionalSectionSchema = z.enum(OPTIONAL_SECTIONS);

/** The order sections appear in, top to bottom. Shared by every template. */
export const SECTION_ORDER = [
  "announcement",
  "navbar",
  "hero",
  "featuredCategories",
  "newArrivals",
  "bestSellers",
  "promoBanner",
  "brandStory",
  "reviews",
  "footer",
] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

/**
 * The 7 "home" sections (everything between navbar and footer) — the ones whose relative order
 * a template may override (templates/types.ts's Template.homeSectionOrder), e.g. to put new
 * arrivals right after the hero instead of after featured categories. Announcement, navbar and
 * footer always stay fixed at the top/bottom, so they're excluded here.
 */
export const HOME_SECTION_ORDER = [
  "hero",
  "featuredCategories",
  "newArrivals",
  "bestSellers",
  "promoBanner",
  "brandStory",
  "reviews",
] as const;
export type HomeSectionId = (typeof HOME_SECTION_ORDER)[number];
