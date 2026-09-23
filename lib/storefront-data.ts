import type { ContentKey, ContentMap } from "@/lib/content";
import { descendantIds, type CategoryNode } from "@/lib/categories";
import { PAGE_SLUGS } from "@/lib/pages";
import { parseSectionVisibility } from "@/lib/sections";
import type {
  CategoryTile,
  InstagramInfo,
  PageLink,
  ReviewItem,
  StoreInfo,
  StoreProduct,
  StorefrontData,
} from "@/templates/types";

const at = (content: ContentMap, key: string) =>
  (content[key as ContentKey] ?? "").trim();

/**
 * Turns raw rows (content map, visibility JSON, product lists) into the shape every
 * template consumes. Pure: no database access, so it is easy to reuse and test.
 */
export function buildStorefrontData(input: {
  store: StoreInfo;
  content: ContentMap;
  sectionVisibility: unknown;
  newArrivals: StoreProduct[];
  bestSellers: StoreProduct[];
  categories: CategoryNode[];
  /** Newest first. Used to pick a photo for each category tile. */
  categoryProductImages: { categoryId: string | null; imageUrl: string }[];
}): StorefrontData {
  const { store, content, newArrivals, bestSellers, categories, categoryProductImages } = input;

  const known = new Set(categories.map((c) => c.id));
  const categoryTiles: CategoryTile[] = categories
    .filter((c) => !c.parentId || !known.has(c.parentId))
    .sort((x, y) => x.name.localeCompare(y.name))
    .slice(0, 6)
    .map((c) => {
      const inTree = descendantIds(categories, c.id);
      // A manually set cover image wins; otherwise fall back to a photo from a product in
      // this category or one of its subcategories.
      const image =
        c.imageUrl ||
        categoryProductImages.find((p) => p.categoryId && inTree.has(p.categoryId) && p.imageUrl)
          ?.imageUrl ||
        "";
      return {
        id: c.id,
        label: c.name,
        slug: c.slug,
        image,
        href: `${store.basePath}/category/${c.slug}`,
      };
    });

  const pages: PageLink[] = [];
  for (const slug of PAGE_SLUGS) {
    if (at(content, `${slug}.body`)) {
      pages.push({
        slug,
        label: at(content, `${slug}.title`) || slug,
        href: `${store.basePath}/${slug}`,
      });
    }
  }

  const reviews: ReviewItem[] = [];
  for (const n of [1, 2, 3]) {
    const quote = at(content, `reviews.item${n}.quote`);
    if (quote) reviews.push({ quote, author: at(content, `reviews.item${n}.author`) });
  }

  const handle = at(content, "instagram.handle").replace(/^@/, "");
  const explicit = [1, 2, 3, 4]
    .map((n) => at(content, `instagram.image${n}`))
    .filter(Boolean);
  const fallback = [...newArrivals, ...bestSellers]
    .map((p) => p.imageUrl)
    .filter(Boolean);
  const images = [...new Set([...explicit, ...fallback])].slice(0, 6);
  const instagram: InstagramInfo = {
    handle,
    url: handle ? `https://www.instagram.com/${handle}` : null,
    tiles: images.map((image) => ({ image })),
  };

  return {
    store,
    content,
    visibility: parseSectionVisibility(input.sectionVisibility),
    newArrivals,
    bestSellers,
    categoryTiles,
    pages,
    reviews,
    instagram,
  };
}
