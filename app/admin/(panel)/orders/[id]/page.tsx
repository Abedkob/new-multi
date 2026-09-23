import { notFound } from "next/navigation";
import { Check, MapPin, MessageCircle, Phone, X } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { orderRef, orderTotal, type OrderStatusValue } from "@/lib/orders";
import { requireOwner } from "@/lib/session";
import { cn } from "@/lib/utils";
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

// What the owner should do next, in plain words, for each status.
const NEXT_STEP: Record<OrderStatusValue, string> = {
  PENDING: "Call or message the customer to confirm the order and the delivery address, then mark it Confirmed.",
  CONFIRMED: "Deliver the order and collect the cash, then mark it Delivered.",
  DELIVERED: "All done: this order was delivered and paid.",
  CANCELLED: "This order was cancelled and its items went back into stock.",
};

const STEPS: { status: OrderStatusValue; label: string }[] = [
  { status: "PENDING", label: "Placed" },
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "DELIVERED", label: "Delivered" },
];

export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { tenantId } = await requireOwner();
  const { id } = await params;

  // Scoped by tenantId: another store's order id is simply "not found".
  const order = await getOrder(tenantId, id);
  if (!order) notFound();

  const mapUrl = asSafeUrl(order.deliveryLocation);
  const phoneDigits = order.customerPhone.replace(/[^\d+]/g, "");
  const reached = STEPS.findIndex((s) => s.status === order.status);

  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ href: "/admin/orders", label: "All orders" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span data-testid="order-title">Order {orderRef(order.id)}</span>
            <StatusBadge status={order.status} />
          </span>
        }
        description={`Placed ${order.createdAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`}
      />

      {/* Progress: Placed -> Confirmed -> Delivered (or a cancelled note). */}
      <Card>
        <CardContent className="grid gap-5">
          {order.status === "CANCELLED" ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                <X className="size-4" aria-hidden />
              </span>
              <span className="font-medium">Cancelled</span>
            </div>
          ) : (
            <ol className="flex items-center">
              {STEPS.map((s, i) => {
                const done = i <= reached;
                return (
                  <li key={s.status} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
                          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30 text-muted-foreground",
                        )}
                      >
                        {done ? <Check className="size-4" aria-hidden /> : i + 1}
                      </span>
                      <span className={cn("text-sm", done ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
                    </span>
                    {i < STEPS.length - 1 && (
                      <span className={cn("mx-3 h-0.5 flex-1 rounded", i < reached ? "bg-emerald-500" : "bg-muted")} />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <div className="grid gap-4 rounded-lg bg-muted/60 p-4">
            <p className="text-sm">
              <span className="font-medium">Next step: </span>
              {NEXT_STEP[order.status]}
            </p>
            <StatusControl id={order.id} status={order.status} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <p className="font-medium">{order.customerName}</p>
              <a href={`tel:${phoneDigits}`} className="text-sm text-muted-foreground underline underline-offset-4">
                {order.customerPhone}
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`tel:${phoneDigits}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Phone className="size-4" aria-hidden /> Call
              </a>
              <a
                href={`https://wa.me/${phoneDigits.replace(/^\+/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Works when the number includes the country code"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <MessageCircle className="size-4" aria-hidden /> WhatsApp
              </a>
              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <MapPin className="size-4" aria-hidden /> Open map
                </a>
              )}
            </div>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="whitespace-pre-line">{order.customerAddress}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Delivery location</dt>
                {/* A map link opens from the "Open map" button above. */}
                <dd className="break-words">{order.deliveryLocation}</dd>
              </div>
              {order.notes && (
                <div>
                  <dt className="text-muted-foreground">Order notes</dt>
                  <dd className="rounded-md bg-amber-50 px-3 py-2 whitespace-pre-line text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {order.notes}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden pb-0 lg:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="pl-6">Product</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="pr-6 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((i) => {
                const label = variantLabel(parseAttributes(i.variantAttributesSnapshot), "");
                return (
                  <TableRow key={i.id}>
                    <TableCell className="pl-6">
                      <span className="font-medium">{i.productNameSnapshot}</span>
                      {label && <span className="block text-xs text-muted-foreground">{label}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPrice(i.priceCentsSnapshot)}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {formatPrice(i.priceCentsSnapshot * i.quantity)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={3} className="pl-6 text-right font-semibold">
                  Total to collect (cash on delivery)
                </TableCell>
                <TableCell className="pr-6 text-right text-base font-semibold tabular-nums" data-testid="order-total">
                  {formatPrice(orderTotal(order.items))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
