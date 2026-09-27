import type { DiscountType } from "@/generated/prisma/client";
import { normalizeAdminPageSize } from "@/lib/admin-pagination";
import { withTenant } from "@/lib/prisma";

/**
 * A problem the owner can fix. `message` stays English (logs); `code` is the admin i18n
 * dictionary key shown to the owner.
 */
export class DiscountError extends Error {
  constructor(
    message: string,
    public readonly code: string = message,
  ) {
    super(message);
  }
}

export type DiscountInput = {
  name: string;
  type: DiscountType;
  value: number;
  isEnabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

function assertDiscount(input: DiscountInput) {
  if (!input.name.trim()) throw new DiscountError("Name is required.", "validation.name.required");
  if (!Number.isInteger(input.value) || input.value < 1) {
    throw new DiscountError("Enter a valid discount value.", "discounts.error.invalidValue");
  }
  if (input.type === "PERCENTAGE" && input.value > 100) {
    throw new DiscountError("Percentage discounts cannot exceed 100%.", "discounts.error.percentageOver100");
  }
  if (input.endsAt && input.startsAt && input.endsAt <= input.startsAt) {
    throw new DiscountError("End time must be after the start time.", "discounts.error.endBeforeStart");
  }
}

export function listDiscountsPage(
  tenantId: string,
  requestedPage: number,
  includeArchived = false,
  requestedPageSize = 25,
) {
  const pageSize = normalizeAdminPageSize(requestedPageSize);
  const where = { tenantId, ...(includeArchived ? {} : { archivedAt: null }) };
  return withTenant(tenantId, async (db) => {
    const total = await db.discountCampaign.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.discountCampaign.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { products: true } } },
    });
    return { items, total, page, pages, pageSize };
  });
}

export function getDiscount(tenantId: string, id: string) {
  return withTenant(tenantId, (db) =>
    db.discountCampaign.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true } } },
    }),
  );
}

export function createDiscount(tenantId: string, input: DiscountInput) {
  assertDiscount(input);
  return withTenant(tenantId, (db) =>
    db.discountCampaign.create({ data: { tenantId, ...input, name: input.name.trim() } }),
  );
}

export async function updateDiscount(tenantId: string, id: string, input: DiscountInput) {
  assertDiscount(input);
  return withTenant(tenantId, async (db) => {
    const { count } = await db.discountCampaign.updateMany({
      where: { id, tenantId, archivedAt: null },
      data: { ...input, name: input.name.trim() },
    });
    return count > 0;
  });
}

export async function archiveDiscount(tenantId: string, id: string) {
  return withTenant(tenantId, async (db) => {
    const { count } = await db.discountCampaign.updateMany({
      where: { id, tenantId, archivedAt: null },
      data: { archivedAt: new Date(), isEnabled: false },
    });
    return count > 0;
  });
}

/** Restoring never enables a campaign automatically; the owner reviews it before activation. */
export async function restoreDiscount(tenantId: string, id: string) {
  return withTenant(tenantId, async (db) => {
    const { count } = await db.discountCampaign.updateMany({
      where: { id, tenantId, archivedAt: { not: null } },
      data: { archivedAt: null, isEnabled: false },
    });
    return count > 0;
  });
}

export const DISCOUNT_PRODUCTS_PAGE_SIZE = 20;

/** A scalable product picker: the current page says whether each row belongs to this campaign. */
export function listDiscountProductsPage(
  tenantId: string,
  discountId: string,
  requestedPage: number,
  search = "",
) {
  const q = search.trim().slice(0, 100);
  const where = {
    tenantId,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };
  return withTenant(tenantId, async (db) => {
    const discount = await db.discountCampaign.findFirst({
      where: { id: discountId, tenantId },
      select: { id: true },
    });
    if (!discount) return null;
    const total = await db.product.count({ where });
    const pages = Math.max(1, Math.ceil(total / DISCOUNT_PRODUCTS_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
    const items = await db.product.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * DISCOUNT_PRODUCTS_PAGE_SIZE,
      take: DISCOUNT_PRODUCTS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        imageUrl: true,
        basePriceCents: true,
        variants: { select: { priceCentsOverride: true } },
        discounts: {
          select: {
            discountId: true,
            discount: {
              select: {
                name: true,
                isEnabled: true,
                startsAt: true,
                endsAt: true,
                archivedAt: true,
              },
            },
          },
        },
      },
    });
    return { items, total, page, pages };
  });
}

/** Replace assignments only for the visible picker page; selections on other pages stay intact. */
export async function setDiscountAssignmentsForProducts(
  tenantId: string,
  discountId: string,
  visibleProductIds: string[],
  selectedProductIds: string[],
) {
  const visible = [...new Set(visibleProductIds)].slice(0, DISCOUNT_PRODUCTS_PAGE_SIZE);
  const selected = [...new Set(selectedProductIds)].filter((id) => visible.includes(id));
  return withTenant(tenantId, async (db) => {
    const [discount, ownedProducts] = await Promise.all([
      db.discountCampaign.findFirst({
        where: { id: discountId, tenantId, archivedAt: null },
        select: { id: true },
      }),
      db.product.findMany({
        where: { tenantId, id: { in: visible } },
        select: { id: true },
      }),
    ]);
    if (!discount) throw new DiscountError("Discount not found.", "discounts.error.notFound");
    if (ownedProducts.length !== visible.length) {
      throw new DiscountError(
        "One or more products are no longer available.",
        "discounts.error.productsUnavailable",
      );
    }
    await db.discountProduct.deleteMany({
      where: { tenantId, discountId, productId: { in: visible.filter((id) => !selected.includes(id)) } },
    });
    if (selected.length) {
      await db.discountProduct.createMany({
        data: selected.map((productId) => ({ tenantId, discountId, productId })),
        skipDuplicates: true,
      });
    }
    return selected.length;
  });
}
