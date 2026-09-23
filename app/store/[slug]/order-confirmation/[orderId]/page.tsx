import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getOrder } from "@/lib/data/orders";
import { privatePageMeta } from "@/lib/seo";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { formatPrice } from "@/lib/format";
import { PurchaseTracker } from "@/lib/analytics";
import { isFreshOrder, orderRef, orderTotal } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { getTemplate } from "@/templates";
import { variantLabel, parseAttributes } from "@/lib/variants";
import { shopHref } from "@/templates/shared";

export const dynamic = "force-dynamic";

// Never indexed (see lib/seo.ts privatePageMeta).
export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/order-confirmation/[orderId]">): Promise<Metadata> {
  const data = await loadStorefrontData((await params).slug);
  return privatePageMeta(data?.content["confirmation.heading"] || "Thank you!");
}

/**
 * The thank-you page. The order is looked up by (store, id), so an order id from another store
 * is a 404 here. The id is a long random string that only the customer is given.
 */
export default async function OrderConfirmationPage({
  params,
}: PageProps<"/store/[slug]/order-confirmation/[orderId]">) {
  const { slug, orderId } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  const order = await getOrder(tenant.id, orderId);
  if (!order) notFound();

  const { content } = data;
  const s = getTemplate(tenant.templateId).pageStyle;

  return (
    <div className={s.container} data-testid="confirmation-page">
      {isFreshOrder(order.createdAt) && (
        <PurchaseTracker
          orderId={order.id}
          items={order.items.map((i) => {
            const label = variantLabel(parseAttributes(i.variantAttributesSnapshot), "");
            return {
              id: i.variantId ?? i.id,
              name: i.productNameSnapshot,
              ...(label ? { variant: label } : {}),
              priceCents: i.priceCentsSnapshot,
              quantity: i.quantity,
            };
          })}
        />
      )}
      <h1 className={s.title}>{content["confirmation.heading"]}</h1>
      <p className="mt-4 max-w-xl text-lg">{content["confirmation.body"]}</p>
      <p className="mt-2 text-sm text-muted-foreground">{content["confirmation.payment"]}</p>

      <section className={cn(s.panel, "mt-8 max-w-xl")}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">{content["confirmation.summary"]}</h2>
          <span className="font-mono text-sm" data-testid="order-ref">
            {orderRef(order.id)}
          </span>
        </div>
        <ul className="mt-4 grid gap-3 text-sm" data-testid="confirmation-lines">
          {order.items.map((i) => {
            const label = variantLabel(parseAttributes(i.variantAttributesSnapshot), "");
            return (
              <li key={i.id} className="flex justify-between gap-3">
                <span>
                  {i.quantity} &times; {i.productNameSnapshot}
                  {label && <span className="block text-muted-foreground">{label}</span>}
                </span>
                <span className="tabular-nums">{formatPrice(i.priceCentsSnapshot * i.quantity)}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-between border-t border-border pt-4 font-semibold">
          <span>{content["confirmation.total"]}</span>
          <span className="tabular-nums" data-testid="confirmation-total">
            {formatPrice(orderTotal(order.items))}
          </span>
        </div>
        <dl className="mt-6 grid gap-3 border-t border-border pt-4 text-sm">
          <div>
            <dt className="text-muted-foreground">{content["checkout.name"]}</dt>
            <dd>{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{content["checkout.phone"]}</dt>
            <dd>{order.customerPhone}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{content["checkout.address"]}</dt>
            <dd className="whitespace-pre-line">{order.customerAddress}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{content["checkout.location"]}</dt>
            <dd className="break-words">{order.deliveryLocation}</dd>
          </div>
        </dl>
      </section>

      <Link href={shopHref(data.store)} className={cn(buttonVariants({ variant: "outline" }), "mt-8")}>
        {content["confirmation.continue"]}
      </Link>
    </div>
  );
}
