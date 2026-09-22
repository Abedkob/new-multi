import { z } from "zod";
import { CONTENT_KEY_NAMES, IMAGE_CONTENT_KEYS } from "@/lib/content";
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

// bcrypt only uses the first 72 bytes, so cap the length instead of silently truncating.
export const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password must be at most 72 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
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

/** Empty, or an Instagram username with optional leading @. */
export function isInstagramHandle(v: string) {
  return v === "" || /^@?[A-Za-z0-9._]{1,30}$/.test(v);
}

const priceString = z.string().transform((v, ctx) => {
  const cents = parsePriceToCents(v);
  if (cents === null || cents > 100_000_000) {
    ctx.addIssue({ code: "custom", message: "Enter a price like 19.99" });
    return z.NEVER;
  }
  return cents;
});

const stockString = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, "Enter a whole number (0 or more)")
  .transform(Number);

const optionalImage = z
  .string()
  .trim()
  .max(2000)
  .refine(isImageUrl, { message: "Must be an http(s) URL, or empty" })
  .transform((v) => (v === "" ? null : v));

/** One attribute row as typed in the form: both sides required, unless the row is left blank. */
const attributeRow = z.object({ key: z.string(), value: z.string() });

export const variantInputSchema = z.object({
  /** Present when editing an existing variant, so its id (and past orders) survive the save. */
  id: z.string().max(64).optional(),
  attributes: z
    .array(attributeRow)
    .max(10, "At most 10 attributes")
    .transform((rows, ctx) => {
      const out: Record<string, string> = {};
      const seen = new Set<string>();
      for (const row of rows) {
        const key = row.key.trim();
        const value = row.value.trim();
        if (key === "" && value === "") continue; // untouched blank row
        if (key === "" || value === "") {
          ctx.addIssue({ code: "custom", message: "Each attribute needs a name and a value" });
          return z.NEVER;
        }
        if (key.length > 40 || value.length > 80) {
          ctx.addIssue({ code: "custom", message: "Attribute names/values are too long" });
          return z.NEVER;
        }
        if (seen.has(key.toLowerCase())) {
          ctx.addIssue({ code: "custom", message: `"${key}" is listed twice` });
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
        ctx.addIssue({ code: "custom", message: "Enter a price like 19.99, or leave empty" });
        return z.NEVER;
      }
      return cents;
    }),
  imageUrl: optionalImage,
});

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(5000).default(""),
    price: priceString,
    imageUrl: z
      .string()
      .trim()
      .max(2000)
      .refine(isImageUrl, { message: "Must be an http(s) URL, or empty" }),
    images: z.array(z.object({
      id: z.string().optional(),
      url: z.string().trim().max(2000).refine(isImageUrl, { message: "Must be an http(s) URL, or empty" }),
      altText: z.string().trim().max(100).optional(),
    })).max(10, "At most 10 images").default([]),
    isBestSeller: z.boolean().default(false),
    /** "" = no category. */
    categoryId: z
      .string()
      .trim()
      .max(64)
      .transform((v) => (v === "" ? null : v)),
    variants: z.array(variantInputSchema).max(100, "At most 100 variants"),
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

export const contentSchema = z.object({
  entries: z.array(
    z
      .object({
        key: z.string().refine((k) => CONTENT_KEY_NAMES.includes(k), {
          message: "Unknown content key",
        }),
        value: z.string().trim().max(2000, "At most 2000 characters"),
      })
      .superRefine((entry, ctx) => {
        if (IMAGE_CONTENT_KEYS.includes(entry.key) && !isImageUrl(entry.value)) {
          ctx.addIssue({
            code: "custom",
            path: ["value"],
            message: "Must be an http(s) URL, a /path, or empty",
          });
        }
        if (entry.key === "instagram.handle" && !isInstagramHandle(entry.value)) {
          ctx.addIssue({
            code: "custom",
            path: ["value"],
            message: "Use letters, numbers, . or _ (max 30), like @yourstore",
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
  name: z.string().trim().min(1, "Name is required").max(80, "At most 80 characters"),
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
    }),
  )
  .min(1, "Your cart is empty")
  .max(50, "Too many different items in one order");
