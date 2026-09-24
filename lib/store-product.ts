import { calculatePrice, type DiscountCandidate } from "@/lib/pricing";
import { effectiveImage, parseAttributes, variantLabel } from "@/lib/variants";
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
  discounts?: { discount: DiscountCandidate }[];
};

/**
 * The plain, serialisable shape templates render. `priceCents` is the lowest variant price
 * (shown as "From ..." when `hasPriceRange`), `inStock` means any variant has stock.
 */
export function toStoreProduct(p: ProductRow): StoreProduct {
  const at = new Date();
  const discounts = (p.discounts ?? []).map((assignment) => assignment.discount);
  const variants = [...p.variants]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .map((v) => {
      const attributes = parseAttributes(v.attributes);
      const price = calculatePrice(p.basePriceCents, v.priceCentsOverride, discounts, at);
      return {
        id: v.id,
        attributes,
        label: variantLabel(attributes),
        stock: v.stock,
        regularPriceCents: price.regularPriceCents,
        priceCents: price.finalPriceCents,
        discountCents: price.discountCents,
        imageUrl: effectiveImage(p.imageUrl, v.imageUrl),
      };
    });
  const fallback = calculatePrice(p.basePriceCents, null, discounts, at);
  const pricedVariants = variants.length
    ? variants
    : [{ priceCents: fallback.finalPriceCents, regularPriceCents: fallback.regularPriceCents }];
  const cheapest = pricedVariants.reduce((best, variant) =>
    variant.priceCents < best.priceCents ? variant : best,
  );
  const prices = pricedVariants.map((v) => v.priceCents);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    images: p.images.map((img) => ({ url: img.url, altText: img.altText ?? "" })),
    regularPriceCents: cheapest.regularPriceCents,
    priceCents: cheapest.priceCents,
    hasPriceRange: Math.max(...prices) !== cheapest.priceCents,
    isOnSale: cheapest.priceCents < cheapest.regularPriceCents,
    inStock: variants.some((v) => v.stock > 0),
    isBestSeller: p.isBestSeller,
    categoryId: p.categoryId,
    variants,
  };
}
