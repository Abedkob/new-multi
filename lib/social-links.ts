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
    key: "whatsappNumber",
    platform: "whatsapp",
    label: "WhatsApp",
    placeholder: "+961 70 123 456",
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

const optionalWhatsappNumber = z
  .string()
  .trim()
  .max(32, "Use a phone number shorter than 32 characters")
  .transform((value, context) => {
    if (value === "") return null;
    if (!/^[+\d().\s-]+$/.test(value)) {
      context.addIssue({ code: "custom", message: "Enter a valid WhatsApp phone number" });
      return z.NEVER;
    }

    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    // Make common Lebanese local formats useful without asking owners to understand wa.me URLs.
    if (digits.startsWith("0")) digits = `961${digits.slice(1)}`;
    else if (!digits.startsWith("961") && (digits.length === 7 || digits.length === 8)) {
      digits = `961${digits}`;
    }
    if (digits.length < 8 || digits.length > 15) {
      context.addIssue({ code: "custom", message: "Include a valid number with its country code" });
      return z.NEVER;
    }
    return digits;
  });

export const socialLinksSchema = z.object({
  instagramUrl: optionalPublicUrl,
  facebookUrl: optionalPublicUrl,
  tiktokUrl: optionalPublicUrl,
  whatsappNumber: optionalWhatsappNumber,
  googleMapsUrl: optionalPublicUrl,
});

export function socialLinksFromStore(store: Partial<StoreSocialLinks>): StoreSocialLinks {
  return Object.fromEntries(
    SOCIAL_LINK_FIELDS.map(({ key }) => [key, store[key]?.trim() || null]),
  ) as StoreSocialLinks;
}

export function publicSocialLinks(store: Partial<StoreSocialLinks>) {
  const normalized = socialLinksFromStore(store);
  return SOCIAL_LINK_FIELDS.flatMap(({ key, platform, label }) => {
    const value = normalized[key];
    if (!value) return [];
    const href = platform === "whatsapp" ? `https://wa.me/${value}` : value;
    return [{ platform, label, href }];
  });
}
