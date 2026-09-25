import { withTenant, type TxClient } from "@/lib/prisma";
import { descendantIds } from "@/lib/categories";
import { normalizeAdminPageSize } from "@/lib/admin-pagination";
import { isUniqueViolation } from "@/lib/data/tenants";
import { slugCandidate, slugify } from "@/lib/slug";

/**
 * Every function takes a tenantId (from the session on the admin side, from the storefront's
 * slug lookup on the public side) and runs inside withTenant(), which both scopes the queries
 * and sets the Postgres RLS context. The explicit `tenantId` in each WHERE is kept as a second
 * layer on top of the database policies.
 */

/** A problem the owner can fix; the message is safe to show. */
export class CategoryError extends Error {}

// Runs on a transaction the caller already opened (see loadStorefrontData).
export function categoriesQuery(db: TxClient, tenantId: string) {
  return db.category.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
}

// Runs on a transaction the caller already opened (see lib/sitemap.ts).
/** Lean projection for the sitemap: just the slug (categories have no updatedAt). */
export function categorySitemapQuery(db: TxClient, tenantId: string) {
  return db.category.findMany({ where: { tenantId }, select: { slug: true } });
}

export function listCategories(tenantId: string) {
  return withTenant(tenantId, (db) => categoriesQuery(db, tenantId));
}

type CategoryPageRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  imageUrl: string | null;
  depth: number;
  path: string;
  productCount: number;
};

/**
 * The owner category table, ordered depth-first like flattenCategories but paged in Postgres.
 * The recursive query keeps hierarchy depth and full paths available even when a page starts
 * with a child whose parent was on the previous page.
 */
export function listCategoriesPage(
  tenantId: string,
  requestedPage: number,
  requestedPageSize: number,
) {
  const pageSize = normalizeAdminPageSize(requestedPageSize);
  return withTenant(tenantId, async (db) => {
    const total = await db.category.count({ where: { tenantId } });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const offset = (page - 1) * pageSize;
    const rows = await db.$queryRaw<CategoryPageRow[]>`
      WITH RECURSIVE category_tree AS (
        SELECT
          c.id,
          c.name,
          c.slug,
          c."parentId",
          c."imageUrl",
          0 AS depth,
          ARRAY[c.id]::text[] AS id_path,
          ARRAY[c.name]::text[] AS name_path,
          ARRAY[lower(c.name) || chr(31) || c.id]::text[] AS sort_path
        FROM "Category" c
        WHERE c."tenantId" = ${tenantId}
          AND (
            c."parentId" IS NULL OR NOT EXISTS (
              SELECT 1 FROM "Category" parent
              WHERE parent.id = c."parentId" AND parent."tenantId" = ${tenantId}
            )
          )

        UNION ALL

        SELECT
          child.id,
          child.name,
          child.slug,
          child."parentId",
          child."imageUrl",
          tree.depth + 1,
          tree.id_path || child.id,
          tree.name_path || child.name,
          tree.sort_path || (lower(child.name) || chr(31) || child.id)
        FROM "Category" child
        JOIN category_tree tree ON child."parentId" = tree.id
        WHERE child."tenantId" = ${tenantId}
          AND NOT child.id = ANY(tree.id_path)
      )
      SELECT
        tree.id,
        tree.name,
        tree.slug,
        tree."parentId",
        tree."imageUrl",
        tree.depth,
        array_to_string(tree.name_path, ' / ') AS path,
        (
          SELECT count(*)::int FROM "Product" product
          WHERE product."tenantId" = ${tenantId} AND product."categoryId" = tree.id
        ) AS "productCount"
      FROM category_tree tree
      ORDER BY tree.sort_path
      LIMIT ${pageSize} OFFSET ${offset}`;

    return {
      items: rows.map(({ productCount, ...row }) => ({
        ...row,
        _count: { products: productCount },
      })),
      total,
      page,
      pages,
      pageSize,
    };
  });
}

export function getCategory(tenantId: string, id: string) {
  return withTenant(tenantId, (db) => db.category.findFirst({ where: { id, tenantId } }));
}

export function getCategoryBySlug(tenantId: string, slug: string) {
  return withTenant(tenantId, (db) =>
    db.category.findUnique({ where: { tenantId_slug: { tenantId, slug } } }),
  );
}

async function assertParent(db: TxClient, tenantId: string, parentId: string | null) {
  if (parentId === null) return;
  const parent = await db.category.findFirst({
    where: { id: parentId, tenantId },
    select: { id: true },
  });
  if (!parent) throw new CategoryError("That parent category doesn't exist.");
}

export async function createCategory(
  tenantId: string,
  input: { name: string; parentId: string | null; imageUrl?: string | null },
) {
  const base = slugify(input.name);
  // Retry OUTSIDE the transaction: a unique violation aborts the Postgres transaction, so a
  // retry inside the same one would fail on its first statement.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withTenant(tenantId, async (db) => {
        await assertParent(db, tenantId, input.parentId);

        const taken = new Set(
          (
            await db.category.findMany({
              where: { tenantId, slug: { startsWith: base } },
              select: { slug: true },
            })
          ).map((c) => c.slug),
        );
        let n = 1;
        while (taken.has(slugCandidate(base, n))) n++;
        return db.category.create({
          data: {
            tenantId,
            name: input.name,
            parentId: input.parentId,
            imageUrl: input.imageUrl,
            slug: slugCandidate(base, n),
          },
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new CategoryError("Could not allocate a unique category URL, please retry.");
}

/** The slug stays the same on rename so storefront links keep working. */
export async function updateCategory(
  tenantId: string,
  id: string,
  input: { name: string; parentId: string | null; imageUrl?: string | null },
) {
  return withTenant(tenantId, async (db) => {
    const all = await db.category.findMany({
      where: { tenantId },
      select: { id: true, name: true, slug: true, parentId: true, imageUrl: true },
    });
    if (!all.some((c) => c.id === id)) throw new CategoryError("Category not found.");

    if (input.parentId !== null) {
      await assertParent(db, tenantId, input.parentId);
      // A category can't live inside itself or anything below it (that would create a loop).
      if (descendantIds(all, id).has(input.parentId)) {
        throw new CategoryError(
          "A category can't be moved inside itself or one of its own subcategories.",
        );
      }
    }

    const { count } = await db.category.updateMany({
      where: { id, tenantId },
      data: { name: input.name, parentId: input.parentId, imageUrl: input.imageUrl },
    });
    if (count === 0) throw new CategoryError("Category not found.");
  });
}

/** Refuses (with a clear message) when the category still has subcategories or products. */
export async function deleteCategory(tenantId: string, id: string) {
  return withTenant(tenantId, async (db) => {
    const category = await db.category.findFirst({ where: { id, tenantId } });
    if (!category) throw new CategoryError("Category not found.");

    // Sequential, not Promise.all: both run on this one transaction's connection, which can
    // only execute one query at a time.
    const children = await db.category.count({ where: { tenantId, parentId: id } });
    const products = await db.product.count({ where: { tenantId, categoryId: id } });
    if (children > 0) {
      throw new CategoryError(
        `"${category.name}" has ${children} ${children === 1 ? "subcategory" : "subcategories"}. Move or delete ${children === 1 ? "it" : "them"} first.`,
      );
    }
    if (products > 0) {
      throw new CategoryError(
        `"${category.name}" has ${products} ${products === 1 ? "product" : "products"} assigned. Move ${products === 1 ? "it" : "them"} to another category first.`,
      );
    }
    await db.category.deleteMany({ where: { id, tenantId } });
  });
}
