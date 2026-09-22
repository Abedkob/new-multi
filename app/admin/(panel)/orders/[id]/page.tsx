import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getOrder } from "@/lib/data/orders";
import { formatPrice } from "@/lib/format";
import { orderRef, orderTotal } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import { parseAttributes, variantLabel } from "@/lib/variants";
import { StatusBadge } from "../status-badge";
import { StatusControl } from "./status-control";

/** Only http(s) links are rendered as links (the field is free text from a customer). */
function asSafeUrl(text: string) {
  try {
    const u = new URL(text.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { tenantId } = await requireOwner();
  const { id } = await params;

  // Scoped by tenantId: another store's order id is simply "not found".
  const order = await getOrder(tenantId, id);
  if (!order) notFound();

  const mapUrl = asSafeUrl(order.deliveryLocation);

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/admin/orders" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; All orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="order-title">
            Order {orderRef(order.id)}
          </h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Placed {order.createdAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}
        </p>
      </div>

      <StatusControl id={order.id} status={order.status} />

      <section className="grid gap-3 rounded-xl border p-5">
        <h2 className="font-semibold">Customer</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Phone</dt>
            <dd>
              <a href={`tel:${order.customerPhone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
                {order.customerPhone}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="whitespace-pre-line">{order.customerAddress}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Delivery location</dt>
            <dd className="break-words">
              {mapUrl ? (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  {order.deliveryLocation}
                </a>
              ) : (
                order.deliveryLocation
              )}
            </dd>
          </div>
          {order.notes && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Order notes</dt>
              <dd className="whitespace-pre-line">{order.notes}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Items</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((i) => {
              const label = variantLabel(parseAttributes(i.variantAttributesSnapshot), "");
              return (
                <TableRow key={i.id}>
                  <TableCell>
                    <span className="font-medium">{i.productNameSnapshot}</span>
                    {label && <span className="block text-xs text-muted-foreground">{label}</span>}
                  </TableCell>
                  <TableCell className="text-right">{formatPrice(i.priceCentsSnapshot)}</TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                  <TableCell className="text-right">{formatPrice(i.priceCentsSnapshot * i.quantity)}</TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={3} className="text-right font-semibold">
                Total (pay on delivery)
              </TableCell>
              <TableCell className="text-right font-semibold" data-testid="order-total">
                {formatPrice(orderTotal(order.items))}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
