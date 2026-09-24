import { Prisma } from "@/generated/prisma/client";
import { NO_FILTERS, type AttributeFacet, type CatalogFilters } from "@/lib/catalog-filters";
import { withTenant, type TxClient } from "@/lib/prisma";
import { slugCandidate, slugify } from "@/lib/slug";
import { isUniqueViolation } from "@/lib/data/tenants";
import { variantSetIssues } from "@/lib/variants";

/**
 * Every function takes a tenantId and runs inside withTenant(), which scopes the queries and
 * sets the Postgres RLS context. Callers get the tenantId from the session (admin) or the slug
 * lookup (storefront), never from user-supplied form data, so a record id from another tenant
 * matches nothing (and RLS hides it at the database level regardless).
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

const withPricing = {
  ...withVariants,
  discounts: { include: { discount: true } },
};

async function assertCategory(db: TxClient, tenantId: string, categoryId: string | null) {
  if (categoryId === null) return;
  const found = await db.category.findFirst({
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
  return withTenant(tenantId, (db) =>
    db.product.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { ...withPricing, category: { select: { name: true } } },
    }),
  );
}

export const ADMIN_PAGE_SIZE = 25;

/** The owner's product list, one page at a time (a big catalog can't all load at once). */
export function listProductsPage(tenantId: string, requestedPage: number, search = "") {
  const q = search.trim().slice(0, 100);
  const where = { tenantId, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) };
  return withTenant(tenantId, async (db) => {
    const total = await db.product.count({ where });
    const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.product.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: { ...withPricing, category: { select: { name: true } } },
    });
    return { items, total, page, pages };
  });
}

// Runs on a transaction the caller already opened (see lib/sitemap.ts).
/** Lean projection for the sitemap: just enough to build a URL and a lastmod date. */
export function productSitemapQuery(db: TxClient, tenantId: string) {
  return db.product.findMany({
    where: { tenantId },
    select: { slug: true, updatedAt: true },
  });
}

export function getProduct(tenantId: string, id: string) {
  return withTenant(tenantId, (db) =>
    db.product.findFirst({ where: { id, tenantId }, include: withPricing }),
  );
}

/** Total products in a store, for the owner's dashboard. */
export function countProducts(tenantId: string) {
  return withTenant(tenantId, (db) => db.product.count({ where: { tenantId } }));
}

export async function createProduct(tenantId: string, input: ProductInput) {
  assertVariants(input.variants);

  const base = slugify(input.name);
  // The retry loop is OUTSIDE the transaction on purpose: once Postgres raises the unique
  // violation (a concurrent create took the same slug), the transaction is aborted and every
  // further statement in it fails, so each attempt needs a fresh transaction.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withTenant(tenantId, async (db) => {
        await assertCategory(db, tenantId, input.categoryId);

        const taken = new Set(
          (
            await db.product.findMany({
              where: { tenantId, slug: { startsWith: base } },
              select: { slug: true },
            })
          ).map((p) => p.slug),
        );
        let n = 1;
        while (taken.has(slugCandidate(base, n))) n++;
        // One statement: the product and its variants are created together or not at all.
        return db.product.create({
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

  return withTenant(tenantId, async (tx) => {
    await assertCategory(tx, tenantId, input.categoryId);

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
  return withTenant(tenantId, async (db) => {
    const { count } = await db.product.deleteMany({ where: { id, tenantId } });
    return count > 0;
  });
}

// ---- storefront ----------------------------------------------------------------------------

export function getProductBySlug(tenantId: string, slug: string) {
  return withTenant(tenantId, (db) =>
    db.product.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      include: withPricing,
    }),
  );
}

// Runs on a transaction the caller already opened (see loadStorefrontData).
export function newArrivalsQuery(db: TxClient, tenantId: string, take = 8) {
  return db.product.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
    include: withPricing,
  });
}

/** "New arrivals": the most recently created products. */
export function listNewArrivals(tenantId: string, take = 8) {
  return withTenant(tenantId, (db) => newArrivalsQuery(db, tenantId, take));
}

// Runs on a transaction the caller already opened (see loadStorefrontData).
export function bestSellersQuery(db: TxClient, tenantId: string, take = 8) {
  return db.product.findMany({
    where: { tenantId, isBestSeller: true },
    orderBy: { createdAt: "desc" },
    take,
    include: withPricing,
  });
}

/** "Best sellers": products the owner flagged (no sales data yet). */
export function listBestSellers(tenantId: string, take = 8) {
  return withTenant(tenantId, (db) => bestSellersQuery(db, tenantId, take));
}

export function listRelatedProducts(tenantId: string, excludeId: string, take = 4) {
  return withTenant(tenantId, (db) =>
    db.product.findMany({
      where: { tenantId, id: { not: excludeId } },
      orderBy: { createdAt: "desc" },
      take,
      include: withPricing,
    }),
  );
}

export const CATALOG_PAGE_SIZE = 12;

type CatalogScope = { categoryIds?: string[]; q?: string };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// A variant's attributes, as a jsonb object even if a stored value is somehow not one
// (jsonb_each_text raises on anything else).
const ATTRS = Prisma.sql`jsonb_each_text(CASE WHEN jsonb_typeof(v."attributes") = 'object' THEN v."attributes" ELSE '{}'::jsonb END)`;

/** WHERE conditions on product `p` for the page's own scope: this store, category tree, search. */
function scopeConditions(tenantId: string, scope: CatalogScope): Prisma.Sql[] {
  const conds = [Prisma.sql`p."tenantId" = ${tenantId}`];
  if (scope.categoryIds) {
    conds.push(
      scope.categoryIds.length
        ? Prisma.sql`p."categoryId" IN (${Prisma.join(scope.categoryIds)})`
        : Prisma.sql`FALSE`,
    );
  }
  const q = scope.q?.trim().slice(0, 100);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    conds.push(Prisma.sql`(p."name" ILIKE ${like} OR p."description" ILIKE ${like})`);
  }
  return conds;
}

/**
 * The shop, category and search pages. `categoryIds` is the category plus everything below it
 * (callers compute that from the store's own category list), `q` is a case-insensitive
 * "contains" match on name or description, `filters` come from the URL (lib/catalog-filters.ts).
 *
 * Raw SQL for the filtering and ordering, because price means each product's LOWEST variant
 * price (an override, else the base price: what the card shows as "From ..."), which Prisma's
 * query builder can't sort on. Stock and attribute filters must hold for ONE variant together:
 * "size 40, black, in stock" needs a variant that is all three, not three different variants.
 * The page of ids is then loaded through Prisma as usual.
 */
export async function listCatalog(
  tenantId: string,
  opts: CatalogScope & { page?: number; pageSize?: number; filters?: CatalogFilters },
) {
  const pageSize = opts.pageSize ?? CATALOG_PAGE_SIZE;
  const f = opts.filters ?? NO_FILTERS;
  const at = new Date();

  const conds = scopeConditions(tenantId, opts);
  const variantConds: Prisma.Sql[] = [];
  if (f.inStock) variantConds.push(Prisma.sql`v."stock" > 0`);
  for (const [key, values] of Object.entries(f.attrs)) {
    variantConds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ${ATTRS} e
      WHERE lower(trim(e.key)) = ${key} AND lower(trim(e.value)) IN (${Prisma.join(values)}))`);
  }
  if (variantConds.length) {
    conds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" v
      WHERE v."productId" = p."id" AND ${Prisma.join(variantConds, " AND ")})`);
  }
  if (f.minCents !== null) conds.push(Prisma.sql`mp.price >= ${f.minCents}`);
  if (f.maxCents !== null) conds.push(Prisma.sql`mp.price <= ${f.maxCents}`);

  const from = Prisma.sql`
    FROM "Product" p
    CROSS JOIN LATERAL (
      SELECT COALESCE(MIN(COALESCE(v."priceCentsOverride", p."basePriceCents")), p."basePriceCents") AS price
      FROM "ProductVariant" v WHERE v."productId" = p."id"
    ) rp
    CROSS JOIN LATERAL (
      SELECT LEAST(
        rp.price,
        COALESCE(MIN(CASE d.type
          WHEN 'PERCENTAGE' THEN GREATEST(0, rp.price - ROUND((rp.price::numeric * d.value) / 100)::int)
          WHEN 'FIXED_AMOUNT' THEN GREATEST(0, rp.price - d.value)
        END), rp.price)
      ) AS price
      FROM "DiscountProduct" dp
      JOIN "DiscountCampaign" d ON d.id = dp."discountId" AND d."tenantId" = dp."tenantId"
      WHERE dp."productId" = p.id
        AND dp."tenantId" = ${tenantId}
        AND d."isEnabled" = true
        AND d."archivedAt" IS NULL
        AND (d."startsAt" IS NULL OR d."startsAt" <= ${at})
        AND (d."endsAt" IS NULL OR d."endsAt" > ${at})
    ) mp
    WHERE ${Prisma.join(conds, " AND ")}`;

  const orderBy = {
    newest: Prisma.sql`p."createdAt" DESC, p."id" ASC`,
    "price-asc": Prisma.sql`mp.price ASC, p."createdAt" DESC, p."id" ASC`,
    "price-desc": Prisma.sql`mp.price DESC, p."createdAt" DESC, p."id" ASC`,
    name: Prisma.sql`lower(p."name") ASC, p."id" ASC`,
  }[f.sort];

  return withTenant(tenantId, async (db) => {
    const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from}`;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pages);
    const ids = (
      await db.$queryRaw<{ id: string }[]>`
        SELECT p."id" ${from} ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
    ).map((r) => r.id);
    const rows = ids.length
      ? await db.product.findMany({ where: { tenantId, id: { in: ids } }, include: withPricing })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = ids.flatMap((id) => byId.get(id) ?? []);
    return { items, total, page, pages, pageSize };
  });
}

// Clothing sizes in their natural order; anything else sorts numerically, then alphabetically.
const SIZE_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl"];
function compareValues(a: string, b: string) {
  const [ia, ib] = [SIZE_ORDER.indexOf(a), SIZE_ORDER.indexOf(b)];
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Which attribute options exist among the products in scope (this category tree / search), for
 * the filter bar: e.g. size 40/41/42, color black/white. Keys and values are grouped
 * case-insensitively; the label is the stored spelling. Bounded, since a store could have
 * thousands of variants.
 */
export function listAttributeFacets(tenantId: string, scope: CatalogScope) {
  const conds = scopeConditions(tenantId, scope);
  return withTenant(tenantId, async (db) => {
    const rows = await db.$queryRaw<{ k: string; kl: string; v: string; vl: string }[]>`
      SELECT lower(trim(e.key)) AS k, min(trim(e.key)) AS kl,
             lower(trim(e.value)) AS v, min(trim(e.value)) AS vl
      FROM "Product" p
      JOIN "ProductVariant" v ON v."productId" = p."id"
      CROSS JOIN LATERAL ${ATTRS} e
      WHERE ${Prisma.join(conds, " AND ")} AND trim(e.key) <> '' AND trim(e.value) <> ''
      GROUP BY 1, 3
      ORDER BY 1, 3
      LIMIT 400`;
    const facets = new Map<string, AttributeFacet>();
    for (const r of rows) {
      const facet = facets.get(r.k) ?? { key: r.k, label: r.kl, values: [] };
      facet.values.push({ value: r.v, label: r.vl });
      facets.set(r.k, facet);
    }
    return [...facets.values()].map((facet) => ({
      ...facet,
      values: facet.values.sort((a, b) => compareValues(a.value, b.value)).slice(0, 50),
    }));
  });
}

/**
 * Cart entries carry client-supplied variant ids, so they are only resolved through a
 * product of THIS store: an id from another store simply isn't returned.
 */
export function getVariantsForStore(tenantId: string, variantIds: string[]) {
  return withTenant(tenantId, (db) =>
    db.productVariant.findMany({
      where: { id: { in: variantIds }, product: { tenantId } },
      include: { product: { include: { discounts: { include: { discount: true } } } } },
    }),
  );
}
