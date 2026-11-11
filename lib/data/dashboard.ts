import { CONTENT_KEYS } from "@/lib/content";
import { ORDER_STATUSES, type OrderStatusValue } from "@/lib/orders";
import { withTenant } from "@/lib/prisma";
import { LOW_STOCK } from "@/lib/variants";

/** One row of the running-low read, flat as the SQL returns it. */
type LowStockRow = {
  id: string;
  stock: number;
  attributes: unknown;
  lowAt: number;
  productId: string;
  productName: string;
  productImageUrl: string;
};

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
          SELECT COALESCE(SUM(x.merchandise - x.coupon), 0)::int AS cents, COUNT(*)::int AS orders
          FROM (
            SELECT o.id, o."couponMerchandiseDiscountCentsSnapshot" AS coupon,
                   SUM(i."priceCentsSnapshot" * i.quantity) AS merchandise
            FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o.id
            WHERE o."tenantId" = ${tenantId}
              AND o.status IN ('CONFIRMED', 'DELIVERED')
              AND o."createdAt" >= ${monthStart}
            GROUP BY o.id
          ) x`,
        db.order.count({ where: { tenantId, createdAt: { gte: weekAgo }, status: { not: "CANCELLED" } } }),
        db.order.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { items: { select: { priceCentsSnapshot: true, quantity: true } } },
        }),
        // Raw, because the threshold is per product now (D95) and
        // `stock <= COALESCE(p."lowStockThreshold", 3)` compares two columns, which Prisma's query
        // builder cannot express. With no product carrying a threshold — every store until an owner
        // sets one — COALESCE returns the same LOW_STOCK this read has always used, so the card
        // does not move. Same ordering, same take, same shape, one statement either way.
        db.$queryRaw<LowStockRow[]>`
          SELECT v."id", v."stock", v."attributes",
                 COALESCE(p."lowStockThreshold", ${LOW_STOCK}) AS "lowAt",
                 p."id" AS "productId", p."name" AS "productName", p."imageUrl" AS "productImageUrl"
          FROM "ProductVariant" v
          JOIN "Product" p ON p."id" = v."productId"
          WHERE p."tenantId" = ${tenantId}
            AND v."stock" <= COALESCE(p."lowStockThreshold", ${LOW_STOCK})
          ORDER BY v."stock" ASC, v."createdAt" DESC
          LIMIT 6`,
        db.product.count({ where: { tenantId } }),
        db.category.count({ where: { tenantId } }),
        db.tenantContent.findMany({
          where: { tenantId, key: { in: ["navbar.logo", "hero.headline", "hero.image"] } },
          select: { key: true, value: true },
        }),
      ]);

    // In-store takings, as their OWN figure. Deliberately not added to salesThisMonthCents
    // above: one is money taken online and the other money taken at a counter, and a single
    // "revenue" number would make the web conversion rate and the pilot's order reconciliation
    // meaningless. The same rule the reports already keep between order value and WhatsApp
    // potential value — and pnpm verify:aggregates greps for anyone adding the two together.
    //
    // Read only when the store has a till. A shop that has never had one pays a single
    // primary-key lookup for the question and nothing more, which matters because these queries
    // share one connection and therefore run one after another.
    const till = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { counterSalesEnabled: true, counterSalesFirstEnabledAt: true },
    });
    const hasTill = !!till && (till.counterSalesEnabled || till.counterSalesFirstEnabledAt !== null);
    const [counterRow] = hasTill
      ? await db.$queryRaw<{ cents: number; sales: number }[]>`
          SELECT COALESCE(SUM(x.total), 0)::int AS cents, COUNT(*)::int AS sales
          FROM (
            SELECT s.id, SUM(i."priceCentsSnapshot" * i.quantity) AS total
            FROM "CounterSale" s
            JOIN "CounterSaleItem" i ON i."counterSaleId" = s.id AND i."tenantId" = s."tenantId"
            WHERE s."tenantId" = ${tenantId}
              AND s.status = 'RECORDED'
              AND s."createdAt" >= ${monthStart}
            GROUP BY s.id
          ) x`
      : [];

    const orderCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatusValue, number>;
    for (const row of byStatus) orderCounts[row.status] = row._count._all;
    const value = (key: string) => content.find((c) => c.key === key)?.value.trim() ?? "";
    // New stores are seeded with the default headline, so only a changed one (or a photo) counts.
    const defaultHeadline = CONTENT_KEYS.find((c) => c.key === "hero.headline")?.default ?? "";

    return {
      orderCounts,
      salesThisMonthCents: sales?.cents ?? 0,
      paidOrdersThisMonth: sales?.orders ?? 0,
      /** null when this store has no till, so the dashboard shows no tile rather than a zero. */
      counterSalesThisMonth: hasTill
        ? { cents: counterRow?.cents ?? 0, sales: counterRow?.sales ?? 0 }
        : null,
      ordersThisWeek,
      recentOrders,
      lowStock: lowStock.map((v) => ({
        id: v.id,
        stock: v.stock,
        attributes: v.attributes,
        lowAt: v.lowAt,
        product: { id: v.productId, name: v.productName, imageUrl: v.productImageUrl },
      })),
      productCount,
      categoryCount,
      hasLogo: !!value("navbar.logo"),
      hasHero: !!value("hero.image") || (!!value("hero.headline") && value("hero.headline") !== defaultHeadline),
    };
  });
}
