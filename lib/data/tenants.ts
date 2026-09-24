import { Prisma } from "@/generated/prisma/client";
import { prisma, withBypass } from "@/lib/prisma";
import { SEED_CONTENT } from "@/lib/content";
import type { IntegrationKey } from "@/lib/integrations";
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
  return prisma.tenant.findUnique({
    where: { slug },
    include: {
      license: { select: { status: true, expiresAt: true, offlineGraceUntil: true } },
    },
  });
}

/** Tenant.domain is stored normalized (lib/domain-format.ts), so pass a normalized hostname. */
export function getTenantByDomain(domain: string) {
  return prisma.tenant.findUnique({ where: { domain }, select: { id: true, slug: true } });
}

export function getTenantById(id: string) {
  return prisma.tenant.findUnique({ where: { id } });
}

/**
 * Lean listing for the platform's sitemap index and robots.txt: every store still reachable at
 * /store/[slug] (a custom domain removes a store from here — see lib/store-url.ts — since once
 * a store has its own domain, its pages shouldn't also be indexed under the platform's path).
 * Tenant itself isn't RLS-guarded (see withTenant's docstring), so this is a bare query.
 */
export function listTenantSlugsWithoutDomain() {
  return prisma.tenant.findMany({ where: { domain: null, isPaused: false }, select: { slug: true } });
}

// Platform admin's store detail page: owner contact info plus counts that live on
// RLS-guarded tables, so this runs with the bypass context set (like listTenants).
export function getTenantForAdmin(slug: string) {
  return withBypass((db) =>
    db.tenant.findUnique({
      where: { slug },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        license: {
          select: {
            status: true,
            productCode: true,
            keyHint: true,
            licenseType: true,
            expiresAt: true,
            checkAfter: true,
            offlineGraceUntil: true,
            lastCheckedAt: true,
            lastError: true,
          },
        },
        _count: { select: { products: true, orders: true } },
      },
    }),
  );
}

export function updateTenantName(id: string, name: string) {
  return withBypass((db) => db.tenant.update({ where: { id }, data: { name } }));
}

/** Platform-admin pause controls public access while preserving owner dashboard access. */
export function setTenantPaused(id: string, reason: string | null) {
  return withBypass((db) =>
    db.tenant.update({
      where: { id },
      data: reason === null
        ? { isPaused: false, pausedAt: null, pauseReason: null }
        : { isPaused: true, pausedAt: new Date(), pauseReason: reason },
      select: { id: true },
    }),
  );
}

/** null disconnects the domain (the store falls back to /store/[slug]). The caller is
 * responsible for the DNS-resolves check and the "verified and live" invariant on this column
 * (see schema.prisma) — this just writes it. */
export function updateTenantDomain(id: string, domain: string | null) {
  return withBypass((db) => db.tenant.update({ where: { id }, data: { domain } }));
}

/** Marketing integrations (lib/integrations.ts). The caller validates; null turns one off. */
export function updateTenantIntegrations(
  id: string,
  data: Partial<Record<IntegrationKey, string | null>>,
) {
  return withBypass((db) => db.tenant.update({ where: { id }, data, select: { id: true } }));
}

export function updateTenantFavicon(id: string, faviconUrl: string | null) {
  return withBypass((db) =>
    db.tenant.update({ where: { id }, data: { faviconUrl }, select: { id: true } }),
  );
}

/**
 * Deletes the store and its owner account together. The Tenant row cascades to every
 * tenant-owned table (Category, Product, ProductVariant, ProductImage, TenantContent, Order,
 * OrderItem); the owner User has no cascade from Tenant (FK points the other way), so it is
 * deleted in the same transaction once the Tenant row referencing it is gone.
 * Runs under bypass: the cascaded deletes touch RLS-guarded tables with no tenant context.
 */
export async function deleteTenant(id: string) {
  await withBypass(async (db) => {
    const tenant = await db.tenant.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!tenant) return;
    await db.tenant.delete({ where: { id } });
    await db.user.delete({ where: { id: tenant.ownerId } });
  });
}

/**
 * Platform admin issues a new temporary password for a store owner (forgot their password,
 * or a support reset — possibly because the account was compromised). Forces
 * mustChangePassword, and bumps sessionVersion so every existing session is revoked on its
 * next request (requireOwner() compares it), not merely redirected to change-password. The
 * User table isn't RLS-guarded, so no bypass needed.
 */
export function resetOwnerPassword(ownerId: string, passwordHash: string) {
  return prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } },
  });
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
