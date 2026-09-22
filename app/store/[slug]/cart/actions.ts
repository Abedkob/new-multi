"use server";

import { getVariantsForStore } from "@/lib/data/products";
import { getTenantBySlug } from "@/lib/data/tenants";
import { effectiveImage, effectivePrice, parseAttributes, variantLabel } from "@/lib/variants";

/**
 * Public on purpose: shoppers are anonymous. Safety comes from scoping instead of a login:
 * the store is resolved from the slug, and variant ids from the (client-held) cart are only
 * resolved through products of THAT store, so another store's ids simply come back missing.
 */

export type CartDetail = {
  variantId: string;
  productName: string;
  productSlug: string;
  label: string;
  priceCents: number;
  stock: number;
  imageUrl: string;
};

export async function getCartDetailsAction(
  slug: string,
  variantIds: string[],
): Promise<{ items: CartDetail[] }> {
  const tenant = typeof slug === "string" ? await getTenantBySlug(slug) : null;
  if (!tenant || !Array.isArray(variantIds)) return { items: [] };

  const ids = [...new Set(variantIds.filter((v): v is string => typeof v === "string" && v.length <= 64))].slice(0, 50);
  if (ids.length === 0) return { items: [] };

  const rows = await getVariantsForStore(tenant.id, ids);
  return {
    items: rows.map((v) => ({
      variantId: v.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      label: variantLabel(parseAttributes(v.attributes), ""),
      priceCents: effectivePrice(v.product.basePriceCents, v.priceCentsOverride),
      stock: v.stock,
      imageUrl: effectiveImage(v.product.imageUrl, v.imageUrl),
    })),
  };
}
