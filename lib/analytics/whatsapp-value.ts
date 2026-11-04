/**
 * What a WhatsApp order click was potentially worth (§3.4), computed on the server.
 *
 * The browser says which product, which variant and how many. It does not say what that costs,
 * and it is not asked: the contract refuses a `valueCents` from a client outright, and this
 * module resolves the figure the same way the product page and the order both do, through
 * `lib/pricing.ts`. A shopper who edits their own request can therefore misreport what they
 * looked at, but never what it was worth.
 *
 * The value is resolved at click time and stored on the event, exactly as order items snapshot
 * their price: a price change tomorrow must not rewrite what today's click was worth.
 *
 * This is POTENTIAL value, and it is kept rigorously apart from revenue — it lives on
 * AnalyticsEvent.valueCents, never on an Order, and nothing sums the two (§3.4, §5.4). A
 * merchant who mistakes intent for income makes real decisions on a fiction.
 */

import type { AnalyticsEventInput } from "@/lib/analytics/contract";
import { calculatePrice } from "@/lib/pricing";
import type { TxClient } from "@/lib/prisma";

/** The one event type that carries a value. Everything else stores null. */
export const VALUED_EVENT_TYPE = "WHATSAPP_ORDER_CLICK" as const;

/**
 * Unit price, times quantity, per event id. An event whose product cannot be priced (deleted
 * mid-session, or never ours) is absent from the map and stores null rather than a zero, which
 * would read as "worth nothing" in a report.
 *
 * Runs inside the ingestion transaction, so `db` is already scoped to this tenant by RLS and
 * these reads cost no extra connection.
 */
export async function resolveWhatsappValues(
  db: TxClient,
  tenantId: string,
  events: readonly AnalyticsEventInput[],
  at: Date,
): Promise<Map<string, number>> {
  const values = new Map<string, number>();
  const clicks = events.filter((event) => event.type === VALUED_EVENT_TYPE && event.productId);
  if (clicks.length === 0) return values;

  const productIds = [...new Set(clicks.map((event) => event.productId!))];
  const variantIds = [...new Set(clicks.map((event) => event.variantId).filter(Boolean))] as string[];

  const [products, variants] = await Promise.all([
    db.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: {
        id: true,
        basePriceCents: true,
        discounts: { select: { discount: true } },
      },
    }),
    variantIds.length
      ? db.productVariant.findMany({
          where: { id: { in: variantIds }, product: { tenantId } },
          select: { id: true, productId: true, priceCentsOverride: true },
        })
      : Promise.resolve([]),
  ]);
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  for (const event of clicks) {
    const variant = event.variantId ? variantById.get(event.variantId) : undefined;
    // A variant is only allowed to price the product it actually belongs to.
    const product = productById.get(
      variant && variant.productId === event.productId ? variant.productId : event.productId!,
    );
    if (!product) continue;

    const price = calculatePrice(
      product.basePriceCents,
      variant?.priceCentsOverride ?? null,
      product.discounts.map((assignment) => assignment.discount),
      at,
    );
    values.set(event.eventId, price.finalPriceCents * (event.quantity ?? 1));
  }
  return values;
}
