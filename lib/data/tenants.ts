import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
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

export function listTenants() {
  return prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { name: true, email: true } },
      _count: { select: { products: true } },
    },
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
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
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
