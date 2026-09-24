import { z } from "zod";

export const SOCIAL_LINK_FIELDS = [
  {
    key: "instagramUrl",
    platform: "instagram",
    label: "Instagram",
    placeholder: "https://www.instagram.com/yourstore",
  },
  {
    key: "facebookUrl",
    platform: "facebook",
    label: "Facebook",
    placeholder: "https://www.facebook.com/yourstore",
  },
  {
    key: "tiktokUrl",
    platform: "tiktok",
    label: "TikTok",
    placeholder: "https://www.tiktok.com/@yourstore",
  },
  {
    key: "googleMapsUrl",
    platform: "googleMaps",
    label: "Visit us",
    placeholder: "https://maps.app.goo.gl/...",
  },
] as const;

export type SocialLinkKey = (typeof SOCIAL_LINK_FIELDS)[number]["key"];
export type SocialPlatform = (typeof SOCIAL_LINK_FIELDS)[number]["platform"];
export type StoreSocialLinks = Record<SocialLinkKey, string | null>;

const optionalPublicUrl = z
  .string()
  .trim()
  .max(2048, "Use a link shorter than 2,048 characters")
  .transform((value) => (value === "" ? null : value))
  .refine((value) => {
    if (value === null) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full link beginning with https:// or http://");

export const socialLinksSchema = z.object(
  Object.fromEntries(SOCIAL_LINK_FIELDS.map(({ key }) => [key, optionalPublicUrl])) as Record<
    SocialLinkKey,
    typeof optionalPublicUrl
  >,
);

export function socialLinksFromStore(store: Partial<StoreSocialLinks>): StoreSocialLinks {
  return Object.fromEntries(
    SOCIAL_LINK_FIELDS.map(({ key }) => [key, store[key]?.trim() || null]),
  ) as StoreSocialLinks;
}

export function publicSocialLinks(store: Partial<StoreSocialLinks>) {
  const normalized = socialLinksFromStore(store);
  return SOCIAL_LINK_FIELDS.flatMap(({ key, platform, label }) => {
    const href = normalized[key];
    return href ? [{ platform, label, href }] : [];
  });
}
