/**
 * Pure variant logic shared by the admin form, the data layer and the storefront picker.
 *
 * Rules for one product's variants (enforced on save):
 *  - there is at least one variant;
 *  - with a single variant, attributes may be empty (the "default variant");
 *  - with several, every variant has at least one attribute, all variants use the SAME set of
 *    attribute keys (so the picker, built from the union of keys, is well defined), and no two
 *    variants have identical attribute values.
 * Different products can use entirely different keys (size+color, just size, material+size...).
 */

/** At or below this many left, the admin flags a variant as low on stock. */
export const LOW_STOCK = 3;

export type Attributes = Record<string, string>;

export type VariantDraft = {
  attributes: Attributes;
};

/** Tolerant read of the stored Json: only string values, trimmed, non-empty keys. */
export function parseAttributes(json: unknown): Attributes {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const out: Attributes = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    const key = k.trim();
    if (key && (typeof v === "string" || typeof v === "number")) out[key] = String(v).trim();
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Order-independent, case-insensitive identity of an attribute set. */
export function attributeSignature(attrs: Attributes): string {
  return JSON.stringify(
    Object.entries(attrs)
      .map(([k, v]) => [norm(k), norm(v)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const keySignature = (attrs: Attributes) =>
  Object.keys(attrs)
    .map(norm)
    .sort()
    .join("\u0000");

/** Human label for a variant: "size: 40, color: white" (or "Default"). */
export function variantLabel(attrs: Attributes, fallback = "Default"): string {
  const parts = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(", ") : fallback;
}

/** Attribute keys across all variants, in first-seen order, with each key's values in first-seen order. */
export function attributeOptions(variants: VariantDraft[]): { key: string; values: string[] }[] {
  const out = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes)) {
      const list = out.get(k) ?? [];
      if (!list.includes(val)) list.push(val);
      out.set(k, list);
    }
  }
  return [...out].map(([key, values]) => ({ key, values }));
}

/**
 * Problems with a set of variants, as messages (empty when valid). `index` points at the
 * offending row so the form can show the message next to it.
 */
export function variantSetIssues(
  variants: VariantDraft[],
): { index: number | null; message: string }[] {
  const issues: { index: number | null; message: string }[] = [];
  if (variants.length === 0) {
    return [{ index: null, message: "A product needs at least one variant." }];
  }
  if (variants.length === 1) return issues;

  const first = keySignature(variants[0].attributes);
  const seen = new Map<string, number>();
  variants.forEach((v, i) => {
    if (Object.keys(v.attributes).length === 0) {
      issues.push({
        index: i,
        message: "With several variants, each one needs at least one attribute (like size).",
      });
      return;
    }
    if (keySignature(v.attributes) !== first) {
      issues.push({
        index: i,
        message: "Every variant must use the same attribute names as the first one.",
      });
    }
    const sig = attributeSignature(v.attributes);
    const dup = seen.get(sig);
    if (dup !== undefined) {
      issues.push({
        index: i,
        message: `Same attributes as variant ${dup + 1}. Each variant must be different.`,
      });
    } else {
      seen.set(sig, i);
    }
  });
  return issues;
}

export const effectivePrice = (basePriceCents: number, override: number | null) =>
  override ?? basePriceCents;

export const effectiveImage = (productImage: string, variantImage: string | null) =>
  variantImage || productImage;
