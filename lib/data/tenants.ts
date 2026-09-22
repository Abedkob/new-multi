import { Prisma } from "@/generated/prisma/client";
import { prisma, withBypass } from "@/lib/prisma";
import { SEED_CONTENT } from "@/lib/content";
import { slugCandidate, slugify } from "@/lib/slug";

export class EmailTakenError extends Error {
  constructor() {
    super("A user with this email already exists");
  }
}

export function isUniqueViolation(e: unknown) {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

export function getTenantBySlug(slug: string) {
  return prisma.tenant.findUnique({ where: { slug } });
}

export function getTenantById(id: string) {
  return prisma.tenant.findUnique({ where: { id } });
}

// Cross-tenant read for the platform admin: the product `_count` touches the RLS-guarded
// Product table, so this runs with the bypass context set.
export function listTenants() {
  return withBypass((db) =>
    db.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { name: true, email: true } },
        _count: { select: { products: true } },
      },
    }),
  );
}

/** Platform-wide totals for the admin overview (spans every tenant). */
export function getPlatformStats() {
  return withBypass(async (db) => {
    // Sequential: both queries share this transaction's single connection.
    const stores = await db.tenant.count();
    const products = await db.product.count();
    return { stores, products };
  });
}

/**
 * Creates the owner User and Tenant (plus default content) in one transaction.
 * Only the password hash is ever passed in here.
 */
export async function createStoreWithOwner(input: {
  storeName: string;
  ownerName: string;
  ownerEmail: string;
  passwordHash: string;
}) {
  const base = slugify(input.storeName);

  // A concurrent create can grab the slug between our check and insert; the
  // unique index rejects it, so re-pick the slug and try again.
  // Runs under bypass: the new tenant has no RLS context yet, and its seed content rows
  // (TenantContent is RLS-guarded) would otherwise fail the row-security WITH CHECK.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withBypass(async (tx) => {
        if (
          await tx.user.findUnique({
            where: { email: input.ownerEmail },
            select: { id: true },
          })
        ) {
          throw new EmailTakenError();
        }

        const taken = new Set(
          (
            await tx.tenant.findMany({
              where: { slug: { startsWith: base } },
              select: { slug: true },
            })
          ).map((t) => t.slug),
        );
        let n = 1;
        while (taken.has(slugCandidate(base, n))) n++;
        const slug = slugCandidate(base, n);

        const user = await tx.user.create({
          data: {
            email: input.ownerEmail,
            name: input.ownerName,
            passwordHash: input.passwordHash,
            role: "STORE_OWNER",
            mustChangePassword: true,
          },
        });
        const tenant = await tx.tenant.create({
          data: {
            slug,
            name: input.storeName,
            ownerId: user.id,
            contents: { create: SEED_CONTENT },
          },
        });
        return { tenant, user };
      });
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a unique store slug, please retry");
}
