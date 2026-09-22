import { effectiveImage, effectivePrice, parseAttributes, variantLabel } from "@/lib/variants";
import type { StoreProduct } from "@/templates/types";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  basePriceCents: number;
  imageUrl: string;
  isBestSeller: boolean;
  categoryId: string | null;
  variants: {
    id: string;
    attributes: unknown;
    stock: number;
    priceCentsOverride: number | null;
    imageUrl: string | null;
    sortOrder: number;
    createdAt: Date;
  }[];
  /** Pre-ordered by the caller's query (sortOrder, then createdAt). */
  images: { url: string; altText: string | null }[];
};

/**
 * The plain, serialisable shape templates render. `priceCents` is the lowest variant price
 * (shown as "From ..." when `hasPriceRange`), `inStock` means any variant has stock.
 */
export function toStoreProduct(p: ProductRow): StoreProduct {
  const variants = [...p.variants]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .map((v) => {
      const attributes = parseAttributes(v.attributes);
      return {
        id: v.id,
        attributes,
        label: variantLabel(attributes),
        stock: v.stock,
        priceCents: effectivePrice(p.basePriceCents, v.priceCentsOverride),
        imageUrl: effectiveImage(p.imageUrl, v.imageUrl),
      };
    });
  const prices = variants.length ? variants.map((v) => v.priceCents) : [p.basePriceCents];
  const min = Math.min(...prices);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    images: p.images.map((img) => ({ url: img.url, altText: img.altText ?? "" })),
    priceCents: min,
    hasPriceRange: Math.max(...prices) !== min,
    inStock: variants.some((v) => v.stock > 0),
    isBestSeller: p.isBestSeller,
    categoryId: p.categoryId,
    variants,
  };
}
