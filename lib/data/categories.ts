import { prisma } from "@/lib/prisma";
import { descendantIds } from "@/lib/categories";
import { isUniqueViolation } from "@/lib/data/tenants";
import { slugCandidate, slugify } from "@/lib/slug";

/**
 * Every function takes a tenantId (from the session on the admin side, from the storefront's
 * slug lookup on the public side) and puts it in the WHERE clause, including when it checks
 * that a parent category or product belongs to the same store.
 */

/** A problem the owner can fix; the message is safe to show. */
export class CategoryError extends Error {}

export function listCategories(tenantId: string) {
  return prisma.category.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
}

export function getCategory(tenantId: string, id: string) {
  return prisma.category.findFirst({ where: { id, tenantId } });
}

export function getCategoryBySlug(tenantId: string, slug: string) {
  return prisma.category.findUnique({ where: { tenantId_slug: { tenantId, slug } } });
}

async function assertParent(tenantId: string, parentId: string | null) {
  if (parentId === null) return;
  const parent = await prisma.category.findFirst({
    where: { id: parentId, tenantId },
    select: { id: true },
  });
  if (!parent) throw new CategoryError("That parent category doesn't exist.");
}

export async function createCategory(
  tenantId: string,
  input: { name: string; parentId: string | null; imageUrl?: string | null },
) {
  await assertParent(tenantId, input.parentId);

  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = new Set(
      (
        await prisma.category.findMany({
          where: { tenantId, slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((c) => c.slug),
    );
    let n = 1;
    while (taken.has(slugCandidate(base, n))) n++;
    try {
      return await prisma.category.create({
        data: {
          tenantId,
          name: input.name,
          parentId: input.parentId,
          imageUrl: input.imageUrl,
          slug: slugCandidate(base, n),
        },
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
  const all = await prisma.category.findMany({
    where: { tenantId },
    select: { id: true, name: true, slug: true, parentId: true, imageUrl: true },
  });
  if (!all.some((c) => c.id === id)) throw new CategoryError("Category not found.");

  if (input.parentId !== null) {
    await assertParent(tenantId, input.parentId);
    // A category can't live inside itself or anything below it (that would create a loop).
    if (descendantIds(all, id).has(input.parentId)) {
      throw new CategoryError(
        "A category can't be moved inside itself or one of its own subcategories.",
      );
    }
  }

  const { count } = await prisma.category.updateMany({
    where: { id, tenantId },
    data: { name: input.name, parentId: input.parentId, imageUrl: input.imageUrl },
  });
  if (count === 0) throw new CategoryError("Category not found.");
}

/** Refuses (with a clear message) when the category still has subcategories or products. */
export async function deleteCategory(tenantId: string, id: string) {
  const category = await getCategory(tenantId, id);
  if (!category) throw new CategoryError("Category not found.");

  const [children, products] = await Promise.all([
    prisma.category.count({ where: { tenantId, parentId: id } }),
    prisma.product.count({ where: { tenantId, categoryId: id } }),
  ]);
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
  await prisma.category.deleteMany({ where: { id, tenantId } });
}
