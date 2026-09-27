import { z } from "zod";
import { CONTENT_KEY_NAMES, IMAGE_CONTENT_KEYS } from "@/lib/content";
// Pure format check only — lib/domain-check.ts (the real DNS/env-dependent checks) must never be
// imported here: this file is also imported by a client component (live-preview.tsx), and
// domain-check.ts pulls in node:dns/promises and env.ts, neither of which can reach a client
// bundle. See lib/domain-check.ts's own docstring for the full story.
import { isValidDomainFormat, normalizeHostname } from "@/lib/domain-format";
import { INTEGRATION_FORMATS, extractMetaContent, type IntegrationKey } from "@/lib/integrations";
import { encodeMessage } from "@/lib/i18n/types";
import { variantSetIssues } from "@/lib/variants";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(1, "Password is required"),
});

export const createStoreSchema = z.object({
  storeName: z.string().trim().min(2, "At least 2 characters").max(80),
  ownerName: z.string().trim().min(2, "At least 2 characters").max(80),
  ownerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email")),
});

export const updateStoreSchema = z.object({
  storeName: z.string().trim().min(2, "At least 2 characters").max(80),
});

/** Empty clears the connected domain (mirrors saveContent's "empty value deletes the row"
 * convention). A pasted full URL ("https://acme.com/") is trimmed down to the bare host, since
 * that's the single most likely paste mistake. */
export const domainFormSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => normalizeHostname(v.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "")))
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || v.length <= 253, "Too long to be a real domain")
    .refine((v) => v === null || isValidDomainFormat(v), {
      message: "Enter a bare domain like acme.com (no https:// or path)",
    }),
  // The "is this the platform's own hostname" check lives in the server action instead of here
  // (see its comment) — it needs lib/domain-check.ts, which this file must never import.
});

/** Empty -> null (turns the integration off); otherwise trimmed and format-checked. */
function integrationField(key: IntegrationKey, message: string, normalize = (v: string) => v) {
  return z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : normalize(v)))
    .refine((v) => v === null || INTEGRATION_FORMATS[key].test(v), { message });
}

/** Platform admin -> store -> Google Search. */
export const searchSettingsSchema = z.object({
  googleSiteVerification: integrationField(
    "googleSiteVerification",
    "Paste the whole <meta> tag from Search Console, or just its content value.",
    extractMetaContent,
  ),
});

/** Platform admin -> store -> Analytics & ads. */
export const analyticsSettingsSchema = z
  .object({
    gaMeasurementId: integrationField(
      "gaMeasurementId",
      "A GA4 Measurement ID looks like G-ABC123XYZ.",
      (v) => v.toUpperCase(),
    ),
    googleAdsId: integrationField("googleAdsId", "A Google Ads tag ID looks like AW-123456789.", (v) =>
      // Accept a pasted "AW-123/label" send_to value; the label goes in its own field.
      v.toUpperCase().split("/")[0],
    ),
    googleAdsPurchaseLabel: integrationField(
      "googleAdsPurchaseLabel",
      "The conversion label is the part after the slash in AW-123456789/AbC-dEfGh.",
      (v) => (v.includes("/") ? v.split("/").pop()! : v),
    ),
    metaPixelId: integrationField("metaPixelId", "A Meta Pixel (dataset) ID is 10-20 digits."),
    metaDomainVerification: integrationField(
      "metaDomainVerification",
      "Paste the whole <meta> tag from Meta Business settings, or just its content value.",
      extractMetaContent,
    ),
  })
  .refine((v) => !v.googleAdsPurchaseLabel || v.googleAdsId, {
    path: ["googleAdsId"],
    message: "Add the Google Ads tag ID too — the label alone can't be sent anywhere.",
  });

// bcrypt only uses the first 72 bytes, so cap the length instead of silently truncating.
export const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "validation.password.tooShort")
      .max(72, "validation.password.tooLong"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "validation.password.mismatch",
  });

/** "12.99" | "12" | "$1,299.5" -> integer cents, or null if invalid. */
export function parsePriceToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * Empty, an http(s) URL, or a same-site path like "/demo/mug.svg".
 * (Protocol-relative "//host" is rejected.)
 */
export function isImageUrl(v: string) {
  if (v === "") return true;
  if (v.startsWith("/")) return !v.startsWith("//");
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// --- Admin-only schemas below (productFormSchema, variantInputSchema, categorySchema,
// discountFormSchema, contentSchema, changePasswordSchema) use i18n dictionary keys as their Zod
// messages (see lib/i18n/dictionaries) instead of English text — every other schema in this file
// is shared with /login, storefront checkout, or /platform and must stay plain English.

const priceString = z.string().transform((v, ctx) => {
  const cents = parsePriceToCents(v);
  if (cents === null || cents > 100_000_000) {
    ctx.addIssue({ code: "custom", message: "validation.price.invalid" });
    return z.NEVER;
  }
  return cents;
});

const stockString = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, "validation.stock.invalid")
  .transform(Number);

const optionalImage = z
  .string()
  .trim()
  .max(2000)
  .refine(isImageUrl, { message: "validation.image.mustBeUrl" })
  .transform((v) => (v === "" ? null : v));

/** One attribute row as typed in the form: both sides required, unless the row is left blank. */
const attributeRow = z.object({ key: z.string(), value: z.string() });

export const variantInputSchema = z.object({
  /** Present when editing an existing variant, so its id (and past orders) survive the save. */
  id: z.string().max(64).optional(),
  attributes: z
    .array(attributeRow)
    .max(10, "validation.attributes.tooMany")
    .transform((rows, ctx) => {
      const out: Record<string, string> = {};
      const seen = new Set<string>();
      for (const row of rows) {
        const key = row.key.trim();
        const value = row.value.trim();
        if (key === "" && value === "") continue; // untouched blank row
        if (key === "" || value === "") {
          ctx.addIssue({ code: "custom", message: "validation.attributes.needNameAndValue" });
          return z.NEVER;
        }
        if (key.length > 40 || value.length > 80) {
          ctx.addIssue({ code: "custom", message: "validation.attributes.tooLong" });
          return z.NEVER;
        }
        if (seen.has(key.toLowerCase())) {
          ctx.addIssue({ code: "custom", message: encodeMessage("validation.attributes.duplicate", key) });
          return z.NEVER;
        }
        seen.add(key.toLowerCase());
        out[key] = value;
      }
      return out;
    }),
  stock: stockString,
  /** Empty = use the product's base price. */
  price: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const cents = parsePriceToCents(v);
      if (cents === null || cents > 100_000_000) {
        ctx.addIssue({ code: "custom", message: "validation.price.invalidOrEmpty" });
        return z.NEVER;
      }
      return cents;
    }),
  imageUrl: optionalImage,
});

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, "validation.name.required").max(120),
    description: z.string().trim().max(5000).default(""),
    price: priceString,
    imageUrl: z
      .string()
      .trim()
      .max(2000)
      .refine(isImageUrl, { message: "validation.image.mustBeUrl" }),
    images: z.array(z.object({
      id: z.string().optional(),
      url: z.string().trim().max(2000).refine(isImageUrl, { message: "validation.image.mustBeUrl" }),
      altText: z.string().trim().max(100).optional(),
    })).max(10, "validation.images.tooMany").default([]),
    isBestSeller: z.boolean().default(false),
    /** "" = no category. */
    categoryId: z
      .string()
      .trim()
      .max(64)
      .transform((v) => (v === "" ? null : v)),
    variants: z.array(variantInputSchema).max(100, "validation.variants.tooMany"),
  })
  .superRefine((product, ctx) => {
    for (const issue of variantSetIssues(
      product.variants.map((v) => ({ attributes: v.attributes })),
    )) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.index === null ? ["variants"] : ["variants", issue.index, "attributes"],
      });
    }
  });

/** What the product form sends (everything is a string, as typed). */
export type ProductFormInput = {
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  images: { id?: string; url: string; altText: string }[];
  isBestSeller: boolean;
  categoryId: string;
  variants: {
    id?: string;
    attributes: { key: string; value: string }[];
    stock: string;
    price: string;
    imageUrl: string;
  }[];
};

const optionalIsoDate = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "validation.date.invalid" });
      return z.NEVER;
    }
    return date;
  });

export const discountFormSchema = z
  .object({
    name: z.string().trim().min(1, "validation.name.required").max(120, "validation.discount.nameTooLong"),
    type: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    value: z.string().trim().min(1, "validation.discount.valueRequired"),
    isEnabled: z.boolean().default(false),
    startsAt: optionalIsoDate,
    endsAt: optionalIsoDate,
  })
  .superRefine((discount, ctx) => {
    if (discount.type === "PERCENTAGE") {
      if (!/^\d+$/.test(discount.value) || Number(discount.value) < 1 || Number(discount.value) > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "validation.discount.percentageRange",
        });
      }
    } else {
      const cents = parsePriceToCents(discount.value);
      if (cents === null || cents < 1 || cents > 100_000_000) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "validation.discount.amountInvalid",
        });
      }
    }
    if (discount.startsAt && discount.endsAt && discount.endsAt <= discount.startsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "validation.discount.endBeforeStart",
      });
    }
  })
  .transform((discount) => ({
    ...discount,
    value:
      discount.type === "PERCENTAGE"
        ? Number(discount.value)
        : (parsePriceToCents(discount.value) ?? 0),
  }));

/** Client shape before validation converts money and timestamps. */
export type DiscountFormInput = {
  name: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: string;
  isEnabled: boolean;
  startsAt: string;
  endsAt: string;
};

export const contentSchema = z.object({
  entries: z.array(
    z
      .object({
        key: z.string().refine((k) => CONTENT_KEY_NAMES.includes(k), {
          message: "validation.content.unknownKey",
        }),
        value: z.string().trim().max(2000, "validation.content.tooLong"),
      })
      .superRefine((entry, ctx) => {
        if (IMAGE_CONTENT_KEYS.includes(entry.key) && !isImageUrl(entry.value)) {
          ctx.addIssue({
            code: "custom",
            path: ["value"],
            message: "validation.content.imageInvalid",
          });
        }
      }),
  ),
});

export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const categorySchema = z.object({
  name: z.string().trim().min(1, "validation.name.required").max(80, "validation.category.nameTooLong"),
  // "" (top level) becomes null
  parentId: z
    .string()
    .trim()
    .max(64)
    .transform((v) => (v === "" ? null : v)),
  imageUrl: optionalImage,
});

// ---- checkout (guest, cash on delivery) ---------------------------------------------------

/** Digits, spaces and + - ( ) . only, with 7 to 15 actual digits (E.164 max is 15). */
export function isPhoneNumber(v: string) {
  if (!/^\+?[0-9\s\-().]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

export const checkoutSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(100, "At most 100 characters"),
  customerPhone: z
    .string()
    .trim()
    .max(30)
    .refine(isPhoneNumber, { message: "Enter a valid phone number, like +1 555 010 0199" }),
  customerAddress: z
    .string()
    .trim()
    .min(5, "Enter your address")
    .max(300, "At most 300 characters"),
  // A Google Maps link or a description of where to deliver; free text.
  deliveryLocation: z
    .string()
    .trim()
    .min(3, "Tell us where to deliver (a Google Maps link or a description)")
    .max(500, "At most 500 characters"),
  notes: z.string().trim().max(500, "At most 500 characters").default(""),
});

export const cartLinesSchema = z
  .array(
    z.object({
      variantId: z.string().min(1).max(64),
      quantity: z.number().int().min(1).max(99),
      expectedPriceCents: z.number().int().min(0).max(100_000_000).optional(),
    }),
  )
  .min(1, "Your cart is empty")
  .max(50, "Too many different items in one order");
