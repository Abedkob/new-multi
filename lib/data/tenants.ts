import { Prisma } from "@/generated/prisma/client";
import { prisma, withBypass } from "@/lib/prisma";
import { getLicenseAccessSnapshot } from "@/lib/data/licenses";
import { SEED_CONTENT } from "@/lib/content";
import type { IntegrationKey } from "@/lib/integrations";
import { parseSectionVisibility } from "@/lib/sections";
import { slugCandidate, slugify } from "@/lib/slug";
import { parseThemeOverrides } from "@/lib/theme";
import type { StoreSocialLinks } from "@/lib/social-links";
import type { DeliverySettings } from "@/lib/delivery";

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

/**
 * The storefront's tenant read, with the licence snapshot canServeTenant() needs attached.
 *
 * The licence is a second query, not an `include`. TenantLicense is RLS-guarded and this lookup
 * has no tenant context yet (it resolves one by slug), so an include would come back null for
 * every store — and `isLicenseActive(null)` is true by design during the opt-in rollout, so
 * licensing would stop being enforced without a single error. getLicenseAccessSnapshot reads
 * the gate columns under the store's own context instead.
 */
export async function getTenantBySlug(slug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return null;
  return { ...tenant, license: await getLicenseAccessSnapshot(tenant.id) };
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

/**
 * The platform-admin switch for the in-store till.
 *
 * One function writes all three columns, so they cannot drift — the setTenantPaused shape, where
 * `null` means off. The timestamp is stamped here from the server's clock and never passed in,
 * like jointControllerRecordedAt.
 *
 * `counterSalesFirstEnabledAt` is set once and NEVER cleared. Disabling the till must stop new
 * sales without hiding the receipts and takings a store already has: that is the difference
 * between "may record now" (the boolean) and "has history its owner may read" (the timestamp).
 */
export function setTenantCounterSales(id: string, operatorId: string | null) {
  return withBypass(async (db) => {
    if (operatorId === null) {
      await db.tenant.update({
        where: { id },
        data: { counterSalesEnabled: false },
        select: { id: true },
      });
      return;
    }
    // COALESCE in one statement, because "set it only if it is still null" is the whole point and
    // a read-then-write would race two operators enabling the same store.
    await db.$executeRaw`
      UPDATE "Tenant"
      SET "counterSalesEnabled" = true,
          "counterSalesEnabledBy" = ${operatorId},
          "counterSalesFirstEnabledAt" = COALESCE("counterSalesFirstEnabledAt", now())
      WHERE id = ${id}`;
  });
}

/**
 * A store's privacy identity and reporting basis, edited after creation.
 *
 * Changing the reporting zone re-buckets future days only — past aggregates are not rewritten,
 * so a zone change is visible as a seam in the history rather than a silent restatement of it.
 */
export function updateTenantPrivacy(
  id: string,
  input: {
    privacyControllerName: string;
    privacyEmail: string;
    privacyPolicyUrl: string | null;
    defaultLocale: string;
    analyticsTimezone: string;
  },
) {
  return withBypass((db) =>
    db.tenant.update({ where: { id }, data: input, select: { id: true } }),
  );
}

/**
 * Records that the joint-controller terms were accepted for a store that predates them, so a
 * backfilled store carries the same audit trail as a newly created one.
 */
export function recordJointController(id: string, version: string, operatorId: string) {
  return withBypass((db) =>
    db.tenant.update({
      where: { id },
      data: {
        jointControllerVersion: version,
        jointControllerRecordedBy: operatorId,
        jointControllerRecordedAt: new Date(),
      },
      select: { id: true },
    }),
  );
}

/**
 * The platform's emergency stop for analytics alone. Deliberately separate from setTenantPaused:
 * that one takes the storefront offline, this one leaves the store selling and only stops
 * measurement. A reason is required to pause and cleared on resume, matching the pause control.
 */
export function setTenantAnalyticsPaused(id: string, reason: string | null) {
  return withBypass((db) =>
    db.tenant.update({
      where: { id },
      data:
        reason === null
          ? { analyticsPausedAt: null, analyticsPauseReason: null }
          : { analyticsPausedAt: new Date(), analyticsPauseReason: reason },
      select: { id: true },
    }),
  );
}

/** Bumping the notice version asks every visitor of this store for consent again (§4.3). */
export function bumpConsentNoticeVersion(id: string) {
  return withBypass((db) =>
    db.tenant.update({
      where: { id },
      data: { consentNoticeVersion: { increment: 1 } },
      select: { id: true, consentNoticeVersion: true },
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

/** Owner-managed public profile/location links. Null hides a link from the storefront. */
export function updateTenantSocialLinks(id: string, socialLinks: StoreSocialLinks) {
  return prisma.tenant.update({
    where: { id },
    data: socialLinks,
    select: {
      facebookUrl: true,
      instagramUrl: true,
      tiktokUrl: true,
      whatsappNumber: true,
      googleMapsUrl: true,
    },
  });
}

/** One store-wide delivery price and customer-facing expectation note. */
export function updateTenantDeliverySettings(id: string, settings: DeliverySettings) {
  return prisma.tenant.update({
    where: { id },
    data: settings,
    select: { deliveryFeeCents: true, deliveryNote: true },
  });
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
/**
 * A store's privacy identity and reporting basis, recorded at creation (§4.2). Optional on the
 * type so the e2e/demo fixtures can create a store without restating all of it; the platform
 * form always sends it, and verify:consent reports any store in the rollout still missing it.
 */
export type TenantPrivacyInput = {
  privacyControllerName: string;
  privacyEmail: string;
  privacyPolicyUrl: string | null;
  defaultLocale: string;
  analyticsTimezone: string;
  /** Which platform operator recorded the joint-controller terms (a User id). */
  jointControllerRecordedBy: string;
  jointControllerVersion: string;
};

export async function createStoreWithOwner(input: {
  storeName: string;
  ownerName: string;
  ownerEmail: string;
  passwordHash: string;
  privacy?: TenantPrivacyInput;
  /**
   * Switch the in-store till on at creation. Optional for the same reason `privacy` is: the
   * verification and demo fixtures create stores without it, and the column's own default (false)
   * is the right answer for every caller that does not care.
   */
  counterSales?: { enabledBy: string };
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
            ...(input.privacy
              ? {
                  privacyControllerName: input.privacy.privacyControllerName,
                  privacyEmail: input.privacy.privacyEmail,
                  privacyPolicyUrl: input.privacy.privacyPolicyUrl,
                  defaultLocale: input.privacy.defaultLocale,
                  analyticsTimezone: input.privacy.analyticsTimezone,
                  jointControllerVersion: input.privacy.jointControllerVersion,
                  jointControllerRecordedBy: input.privacy.jointControllerRecordedBy,
                  // Stamped here, not passed in: the record of WHEN the terms were recorded
                  // should be the server's clock at the moment of the write.
                  jointControllerRecordedAt: new Date(),
                }
              : {}),
            ...(input.counterSales
              ? {
                  counterSalesEnabled: true,
                  counterSalesEnabledBy: input.counterSales.enabledBy,
                  // Stamped here from the server's clock, like jointControllerRecordedAt.
                  counterSalesFirstEnabledAt: new Date(),
                }
              : {}),
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

/**
 * Copies a store's storefront — template, theme, section visibility, content, categories (with
 * their tree) and products (with variants and images) — into a brand-new tenant with its own
 * owner account. Category and product slugs are copied as-is: both are unique per tenant, not
 * globally, so there's no collision with the source.
 *
 * Deliberately NOT copied: the domain (must stay unique to one store), social links and marketing integration ids
 * (GA4/Meta/Ads — these identify the ORIGINAL business; copying them would send the new store's
 * traffic into someone else's accounts), the license, the pause state, automatic discounts
 * (a copied store must not unexpectedly launch on sale), and orders (transactional history
 * belongs only to the store that took them).
 *
 * Runs as several small bypass transactions rather than one big one (withBypass's callback should
 * stay small — see lib/prisma.ts), so a large catalog can't hold a pooled connection for the whole
 * copy. The tenant/owner/categories/content step is one transaction (a failure there rolls back
 * cleanly on its own); products are copied afterwards in batches — if a batch fails, the
 * already-created tenant is torn down rather than left behind half-populated.
 */
export async function duplicateTenant(
  sourceId: string,
  input: { storeName: string; ownerName: string; ownerEmail: string; passwordHash: string },
) {
  const base = slugify(input.storeName);

  // Cross-tenant read (tenant A's data, about to be written into new tenant B), so bypass —
  // there is no single tenant context that covers both sides of a copy.
  const source = await withBypass((db) =>
    db.tenant.findUniqueOrThrow({
      where: { id: sourceId },
      select: {
        templateId: true,
        themeOverrides: true,
        sectionVisibility: true,
        faviconUrl: true,
        contents: { select: { key: true, value: true } },
        categories: {
          select: { id: true, name: true, slug: true, parentId: true, imageUrl: true },
        },
      },
    }),
  );

  // A concurrent create can grab the slug (or the owner email) between our check and insert;
  // retry with a fresh slug, same as createStoreWithOwner.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { tenant, user, categoryMap } = await withBypass(async (tx) => {
        if (
          await tx.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true } })
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
            templateId: source.templateId,
            themeOverrides: { ...parseThemeOverrides(source.themeOverrides) },
            sectionVisibility: { ...parseSectionVisibility(source.sectionVisibility) },
            faviconUrl: source.faviconUrl,
            contents: { create: source.contents },
          },
        });

        // Categories can nest arbitrarily: create every category whose parent is already
        // created (roots first, since their parentId is null), repeating until none are left.
        // A category whose parent never turns up (shouldn't happen — parentId is FK-enforced)
        // is simply left out rather than looping forever.
        const categoryMap = new Map<string, string>();
        let remaining = source.categories;
        while (remaining.length > 0) {
          const ready = remaining.filter((c) => c.parentId === null || categoryMap.has(c.parentId));
          if (ready.length === 0) break;
          for (const c of ready) {
            const created = await tx.category.create({
              data: {
                tenantId: tenant.id,
                name: c.name,
                slug: c.slug,
                imageUrl: c.imageUrl,
                parentId: c.parentId ? categoryMap.get(c.parentId) : null,
              },
            });
            categoryMap.set(c.id, created.id);
          }
          remaining = remaining.filter((c) => !categoryMap.has(c.id));
        }

        return { tenant, user, categoryMap };
      });

      try {
        const products = await withBypass((db) =>
          db.product.findMany({
            where: { tenantId: sourceId },
            include: { variants: true, images: true },
            orderBy: { createdAt: "asc" },
          }),
        );
        const BATCH = 25;
        for (let i = 0; i < products.length; i += BATCH) {
          const batch = products.slice(i, i + BATCH);
          await withBypass(async (tx) => {
            for (const p of batch) {
              await tx.product.create({
                data: {
                  tenantId: tenant.id,
                  name: p.name,
                  description: p.description,
                  basePriceCents: p.basePriceCents,
                  imageUrl: p.imageUrl,
                  slug: p.slug,
                  isBestSeller: p.isBestSeller,
                  categoryId: p.categoryId ? (categoryMap.get(p.categoryId) ?? null) : null,
                  variants: {
                    create: p.variants.map((v) => ({
                      attributes: (v.attributes ?? {}) as Prisma.InputJsonValue,
                      stock: v.stock,
                      priceCentsOverride: v.priceCentsOverride,
                      imageUrl: v.imageUrl,
                      sortOrder: v.sortOrder,
                    })),
                  },
                  images: {
                    create: p.images.map((img) => ({
                      url: img.url,
                      altText: img.altText,
                      sortOrder: img.sortOrder,
                    })),
                  },
                },
              });
            }
          });
        }
      } catch (e) {
        await deleteTenant(tenant.id);
        throw e;
      }

      return { tenant, user };
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a unique store slug, please retry");
}
