import { CONTENT_KEYS } from "@/lib/content";
import { ORDER_STATUSES, type OrderStatusValue } from "@/lib/orders";
import { withTenant } from "@/lib/prisma";
import { LOW_STOCK } from "@/lib/variants";

/**
 * Everything the owner's home page shows, in one transaction (one pooled connection, see
 * lib/prisma.ts). Sales count confirmed + delivered orders only: pending ones may never happen
 * and cancelled ones didn't.
 */
export function getDashboard(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [byStatus, [sales], ordersThisWeek, recentOrders, lowStock, productCount, categoryCount, content] =
      await Promise.all([
        db.order.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
        db.$queryRaw<{ cents: number; orders: number }[]>`
          SELECT COALESCE(SUM(i."priceCentsSnapshot" * i."quantity"), 0)::int AS cents,
                 COUNT(DISTINCT o."id")::int AS orders
          FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o."id"
          WHERE o."tenantId" = ${tenantId}
            AND o."status" IN ('CONFIRMED', 'DELIVERED')
            AND o."createdAt" >= ${monthStart}`,
        db.order.count({ where: { tenantId, createdAt: { gte: weekAgo }, status: { not: "CANCELLED" } } }),
        db.order.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { items: { select: { priceCentsSnapshot: true, quantity: true } } },
        }),
        db.productVariant.findMany({
          where: { product: { tenantId }, stock: { lte: LOW_STOCK } },
          orderBy: [{ stock: "asc" }, { createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            stock: true,
            attributes: true,
            product: { select: { id: true, name: true, imageUrl: true } },
          },
        }),
        db.product.count({ where: { tenantId } }),
        db.category.count({ where: { tenantId } }),
        db.tenantContent.findMany({
          where: { tenantId, key: { in: ["navbar.logo", "hero.headline", "hero.image"] } },
          select: { key: true, value: true },
        }),
      ]);

    const orderCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatusValue, number>;
    for (const row of byStatus) orderCounts[row.status] = row._count._all;
    const value = (key: string) => content.find((c) => c.key === key)?.value.trim() ?? "";
    // New stores are seeded with the default headline, so only a changed one (or a photo) counts.
    const defaultHeadline = CONTENT_KEYS.find((c) => c.key === "hero.headline")?.default ?? "";

    return {
      orderCounts,
      salesThisMonthCents: sales?.cents ?? 0,
      paidOrdersThisMonth: sales?.orders ?? 0,
      ordersThisWeek,
      recentOrders,
      lowStock,
      productCount,
      categoryCount,
      hasLogo: !!value("navbar.logo"),
      hasHero: !!value("hero.image") || (!!value("hero.headline") && value("hero.headline") !== defaultHeadline),
    };
  });
}
