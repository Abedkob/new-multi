import { Prisma, type CouponScope, type DiscountType } from "@/generated/prisma/client";
import { normalizeAdminPageSize } from "@/lib/admin-pagination";
import { couponStatus } from "@/lib/pricing";
import { withTenant, type TxClient } from "@/lib/prisma";

export class CouponError extends Error {
  constructor(message: string, public readonly code: string = message) {
    super(message);
  }
}

export type CouponInput = {
  name: string;
  code: string;
  scope: CouponScope;
  type: DiscountType | null;
  value: number | null;
  isEnabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  isAnnounced: boolean;
  announcementText: string | null;
  productIds: string[];
  revision?: number;
};

export const normalizeCouponCode = (code: string) => code.trim().toUpperCase();

async function assertOwnedProducts(db: TxClient, tenantId: string, ids: string[]) {
  if (!ids.length) return;
  const count = await db.product.count({ where: { tenantId, id: { in: ids } } });
  if (count !== ids.length) {
    throw new CouponError("One or more products are unavailable.", "coupons.error.productsUnavailable");
  }
}

async function selectAnnouncement(db: TxClient, tenantId: string, couponId: string) {
  await db.$executeRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
  await db.coupon.updateMany({
    where: { tenantId, isAnnounced: true, id: { not: couponId } },
    data: { isAnnounced: false },
  });
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new CouponError("That coupon code is already reserved.", "coupons.error.duplicateCode");
  }
  throw error;
}

export function listCouponsPage(
  tenantId: string,
  requestedPage: number,
  includeArchived = false,
  requestedPageSize = 25,
) {
  const pageSize = normalizeAdminPageSize(requestedPageSize);
  const where = { tenantId, ...(includeArchived ? { archivedAt: { not: null } } : { archivedAt: null }) };
  return withTenant(tenantId, async (db) => {
    const total = await db.coupon.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.coupon.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { products: true } } },
    });
    return { items, total, page, pages, pageSize };
  });
}

export function getCoupon(tenantId: string, id: string) {
  return withTenant(tenantId, async (db) => {
    const coupon = await db.coupon.findFirst({
      where: { tenantId, id },
      include: { products: { select: { productId: true } } },
    });
    if (!coupon) return null;
    const hasOrders = await db.order.count({ where: { tenantId, couponIdSnapshot: id } });
    return { ...coupon, hasOrders: hasOrders > 0 };
  });
}

export function listCouponProductChoices(tenantId: string) {
  return withTenant(tenantId, (db) => db.product.findMany({
    where: { tenantId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, imageUrl: true, basePriceCents: true },
  }));
}

export async function createCoupon(tenantId: string, input: CouponInput) {
  try {
    return await withTenant(tenantId, async (db) => {
      await assertOwnedProducts(db, tenantId, input.productIds);
      const coupon = await db.coupon.create({
        data: {
          tenantId,
          name: input.name.trim() || null,
          code: normalizeCouponCode(input.code),
          scope: input.scope,
          type: input.type,
          value: input.value,
          isEnabled: input.isEnabled,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          isAnnounced: false,
          announcementText: input.announcementText ?? "",
          products: input.productIds.length
            ? { createMany: { data: input.productIds.map((productId) => ({ productId })) } }
            : undefined,
        },
      });
      if (input.isAnnounced) {
        await selectAnnouncement(db, tenantId, coupon.id);
        return db.coupon.update({ where: { id: coupon.id }, data: { isAnnounced: true } });
      }
      return coupon;
    });
  } catch (error) {
    translateWriteError(error);
  }
}

export async function updateCoupon(tenantId: string, id: string, input: CouponInput) {
  try {
    return await withTenant(tenantId, async (db) => {
      // Announcement replacement always takes the tenant lock before the coupon lock. Order
      // placement follows the same tenant -> coupon ordering, avoiding cross-coupon deadlocks.
      if (input.isAnnounced) await selectAnnouncement(db, tenantId, id);
      await db.$executeRaw`SELECT id FROM "Coupon" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const current = await db.coupon.findFirst({ where: { id, tenantId, archivedAt: null } });
      if (!current) throw new CouponError("Coupon not found.", "coupons.error.notFound");
      if (input.revision !== undefined && current.revision !== input.revision) {
        throw new CouponError("Coupon changed in another tab.", "coupons.error.stale");
      }
      const used = await db.order.count({ where: { tenantId, couponIdSnapshot: id } });
      if (used > 0 && normalizeCouponCode(input.code) !== current.code) {
        throw new CouponError("A used coupon code cannot be renamed.", "coupons.error.usedCode");
      }
      await assertOwnedProducts(db, tenantId, input.productIds);
      const result = await db.coupon.updateMany({
        where: { id, tenantId, revision: current.revision, archivedAt: null },
        data: {
          name: input.name.trim() || null,
          code: normalizeCouponCode(input.code),
          scope: input.scope,
          type: input.type,
          value: input.value,
          isEnabled: input.isEnabled,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          isAnnounced: input.isAnnounced,
          announcementText: input.announcementText ?? "",
          revision: { increment: 1 },
        },
      });
      if (!result.count) throw new CouponError("Coupon changed in another tab.", "coupons.error.stale");
      await db.couponProduct.deleteMany({ where: { tenantId, couponId: id } });
      if (input.productIds.length) {
        await db.couponProduct.createMany({
          data: input.productIds.map((productId) => ({ tenantId, couponId: id, productId })),
        });
      }
      return db.coupon.findUniqueOrThrow({ where: { id } });
    });
  } catch (error) {
    translateWriteError(error);
  }
}

export function setCouponEnabled(tenantId: string, id: string, enabled: boolean) {
  return withTenant(tenantId, (db) => db.coupon.updateMany({
    where: { tenantId, id, archivedAt: null },
    data: { isEnabled: enabled, ...(!enabled ? { isAnnounced: false } : {}), revision: { increment: 1 } },
  }));
}

export function archiveCoupon(tenantId: string, id: string) {
  return withTenant(tenantId, (db) => db.coupon.updateMany({
    where: { tenantId, id, archivedAt: null },
    data: { archivedAt: new Date(), isEnabled: false, isAnnounced: false, revision: { increment: 1 } },
  }));
}

export function restoreCoupon(tenantId: string, id: string) {
  return withTenant(tenantId, (db) => db.coupon.updateMany({
    where: { tenantId, id, archivedAt: { not: null } },
    data: { archivedAt: null, isEnabled: false, isAnnounced: false, revision: { increment: 1 } },
  }));
}

export function findCouponForPricing(db: TxClient, tenantId: string, code: string) {
  return db.coupon.findFirst({
    where: { tenantId, code: normalizeCouponCode(code) },
    include: { products: { select: { productId: true } } },
  });
}

export function getEffectiveCouponAnnouncement(tenantId: string, at = new Date()) {
  return withTenant(tenantId, async (db) => {
    const coupon = await db.coupon.findFirst({
      where: { tenantId, isAnnounced: true },
      select: {
        id: true, code: true, isEnabled: true, startsAt: true, endsAt: true, archivedAt: true,
        announcementText: true,
      },
    });
    if (!coupon || couponStatus(coupon, at) !== "ACTIVE") return null;
    const template = coupon.announcementText || "Use {code} at checkout";
    return { code: coupon.code, text: template.includes("{code}") ? template.replaceAll("{code}", coupon.code) : `${template} ${coupon.code}` };
  });
}
