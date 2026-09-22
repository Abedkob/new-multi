import { prisma } from "@/lib/prisma";
import { slugCandidate, slugify } from "@/lib/slug";
import { isUniqueViolation } from "@/lib/data/tenants";
import { variantSetIssues } from "@/lib/variants";

/**
 * Every function takes a tenantId and puts it in the WHERE clause. Callers get it from the
 * session (admin) or from the slug lookup (storefront), never from user-supplied form data,
 * so a record id from another tenant matches nothing.
 *
 * Variants have no tenantId of their own: they are always reached through their product, so
 * variant queries here filter on `product: { tenantId }`. Never query ProductVariant by id
 * alone.
 */

/** A problem the owner can fix; the message is safe to show. */
export class ProductError extends Error {}

export type VariantInput = {
  /** An existing variant of this product to update in place (keeps its id). Omit to add one. */
  id?: string;
  attributes: Record<string, string>;
  stock: number;
  priceCentsOverride: number | null;
  imageUrl: string | null;
};

export type ProductInput = {
  name: string;
  description: string;
  basePriceCents: number;
  imageUrl: string;
  images: { id?: string; url: string; altText?: string }[];
  isBestSeller: boolean;
  categoryId: string | null;
  variants: VariantInput[];
};

const withVariants = {
  variants: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
  images: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
};

async function assertCategory(tenantId: string, categoryId: string | null) {
  if (categoryId === null) return;
  const found = await prisma.category.findFirst({
    where: { id: categoryId, tenantId },
    select: { id: true },
  });
  if (!found) throw new ProductError("That category doesn't exist.");
}

/** The invariants Prisma can't express: at least one variant, and a coherent attribute set. */
function assertVariants(variants: VariantInput[]) {
  const issues = variantSetIssues(variants);
  if (issues.length) throw new ProductError(issues[0].message);
}

// ---- admin ---------------------------------------------------------------------------------

export function listProducts(tenantId: string) {
  return prisma.product.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { ...withVariants, category: { select: { name: true } } },
  });
}

export function getProduct(tenantId: string, id: string) {
  return prisma.product.findFirst({ where: { id, tenantId }, include: withVariants });
}

export async function createProduct(tenantId: string, input: ProductInput) {
  assertVariants(input.variants);
  await assertCategory(tenantId, input.categoryId);

  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = new Set(
      (
        await prisma.product.findMany({
          where: { tenantId, slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((p) => p.slug),
    );
    let n = 1;
    while (taken.has(slugCandidate(base, n))) n++;
    try {
      // One statement: the product and its variants are created together or not at all.
      return await prisma.product.create({
        data: {
          tenantId,
          slug: slugCandidate(base, n),
          name: input.name,
          description: input.description,
          basePriceCents: input.basePriceCents,
          imageUrl: input.imageUrl,
          isBestSeller: input.isBestSeller,
          categoryId: input.categoryId,
          variants: {
            create: input.variants.map((v, i) => ({
              attributes: v.attributes,
              stock: v.stock,
              priceCentsOverride: v.priceCentsOverride,
              imageUrl: v.imageUrl,
              sortOrder: i,
            })),
          },
          images: {
            create: input.images.map((img, i) => ({
              url: img.url,
              altText: img.altText,
              sortOrder: i,
            })),
          },
        },
        include: withVariants,
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new ProductError("Could not allocate a unique product URL, please retry.");
}

/**
 * Updates the product and syncs its variants in one transaction: variants that carry an id of
 * this product are updated in place (so orders and carts keep pointing at them), new ones are
 * added, and any the owner removed are deleted. Returns false if the product isn't in this store.
 */
export async function updateProduct(tenantId: string, id: string, input: ProductInput) {
  assertVariants(input.variants);
  await assertCategory(tenantId, input.categoryId);

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id, tenantId },
      select: { id: true, variants: { select: { id: true } }, images: { select: { id: true } } },
    });
    if (!product) return false;

    await tx.product.update({
      where: { id: product.id },
      data: {
        name: input.name,
        description: input.description,
        basePriceCents: input.basePriceCents,
        imageUrl: input.imageUrl,
        isBestSeller: input.isBestSeller,
        categoryId: input.categoryId,
      },
    });

    // Only ids that really belong to this product count as "existing"; anything else is new.
    const existingVariants = new Set(product.variants.map((v) => v.id));
    const keepVariants = new Set(
      input.variants.map((v) => v.id).filter((vid): vid is string => !!vid && existingVariants.has(vid)),
    );
    await tx.productVariant.deleteMany({
      where: { productId: product.id, id: { notIn: [...keepVariants] } },
    });

    for (const [i, v] of input.variants.entries()) {
      const data = {
        attributes: v.attributes,
        stock: v.stock,
        priceCentsOverride: v.priceCentsOverride,
        imageUrl: v.imageUrl,
        sortOrder: i,
      };
      if (v.id && keepVariants.has(v.id)) {
        await tx.productVariant.update({ where: { id: v.id }, data });
      } else {
        await tx.productVariant.create({ data: { ...data, productId: product.id } });
      }
    }

    const existingImages = new Set(product.images.map((img) => img.id));
    const keepImages = new Set(
      input.images.map((img) => img.id).filter((imgId): imgId is string => !!imgId && existingImages.has(imgId)),
    );
    await tx.productImage.deleteMany({
      where: { productId: product.id, id: { notIn: [...keepImages] } },
    });

    for (const [i, img] of input.images.entries()) {
      const data = {
        url: img.url,
        altText: img.altText,
        sortOrder: i,
      };
      if (img.id && keepImages.has(img.id)) {
        await tx.productImage.update({ where: { id: img.id }, data });
      } else {
        await tx.productImage.create({ data: { ...data, productId: product.id } });
      }
    }

    return true;
  });
}

export async function deleteProduct(tenantId: string, id: string) {
  const { count } = await prisma.product.deleteMany({ where: { id, tenantId } });
  return count > 0;
}

// ---- storefront ----------------------------------------------------------------------------

export function getProductBySlug(tenantId: string, slug: string) {
  return prisma.product.findUnique({
    where: { tenantId_slug: { tenantId, slug } },
    include: withVariants,
  });
}

/** "New arrivals": the most recently created products. */
export function listNewArrivals(tenantId: string, take = 8) {
  return prisma.product.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
    include: withVariants,
  });
}

/** "Best sellers": products the owner flagged (no sales data yet). */
export function listBestSellers(tenantId: string, take = 8) {
  return prisma.product.findMany({
    where: { tenantId, isBestSeller: true },
    orderBy: { createdAt: "desc" },
    take,
    include: withVariants,
  });
}

export function listRelatedProducts(tenantId: string, excludeId: string, take = 4) {
  return prisma.product.findMany({
    where: { tenantId, id: { not: excludeId } },
    orderBy: { createdAt: "desc" },
    take,
    include: withVariants,
  });
}

export const CATALOG_PAGE_SIZE = 12;

/**
 * The shop, category and search pages. `categoryIds` is the category plus everything below it
 * (callers compute that from the store's own category list), `q` is a case-insensitive
 * "contains" match on name or description.
 */
export async function listCatalog(
  tenantId: string,
  opts: { categoryIds?: string[]; q?: string; page?: number; pageSize?: number },
) {
  const pageSize = opts.pageSize ?? CATALOG_PAGE_SIZE;
  const q = opts.q?.trim().slice(0, 100);
  const where = {
    tenantId,
    ...(opts.categoryIds ? { categoryId: { in: opts.categoryIds } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const total = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pages);
  const items = await prisma.product.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: withVariants,
  });
  return { items, total, page, pages, pageSize };
}

/**
 * Cart entries carry client-supplied variant ids, so they are only resolved through a
 * product of THIS store: an id from another store simply isn't returned.
 */
export function getVariantsForStore(tenantId: string, variantIds: string[]) {
  return prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { tenantId } },
    include: { product: true },
  });
}
