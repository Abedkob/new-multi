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
import { getT } from "@/lib/i18n/locale";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { encodeMessage, resolveMessage } from "@/lib/i18n/types";
import { orderRef, orderSubtotal, orderTotal, type OrderStatusValue } from "@/lib/orders";
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
const NEXT_STEP_KEYS: Record<OrderStatusValue, DictionaryKey> = {
  PENDING: "orders.detail.nextStep.PENDING",
  CONFIRMED: "orders.detail.nextStep.CONFIRMED",
  DELIVERED: "orders.detail.nextStep.DELIVERED",
  CANCELLED: "orders.detail.nextStep.CANCELLED",
};

const STEPS: { status: OrderStatusValue; label: DictionaryKey }[] = [
  { status: "PENDING", label: "orders.detail.steps.placed" },
  { status: "CONFIRMED", label: "orders.status.CONFIRMED" },
  { status: "DELIVERED", label: "orders.status.DELIVERED" },
];

export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { tenantId } = await requireOwner();
  const t = await getT();
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
        back={{ href: "/admin/orders", label: t("orders.detail.backLabel") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span data-testid="order-title">
              {t("orders.detail.orderRefPrefix")} {orderRef(order.id)}
            </span>
            <StatusBadge status={order.status} />
          </span>
        }
        description={resolveMessage(
          t,
          encodeMessage(
            "orders.detail.placedOn",
            order.createdAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }),
          ),
        )}
      />

      {/* Progress: Placed -> Confirmed -> Delivered (or a cancelled note). */}
      <Card>
        <CardContent className="grid gap-5">
          {order.status === "CANCELLED" ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                <X className="size-4" aria-hidden />
              </span>
              <span className="font-medium">{t("orders.detail.cancelled")}</span>
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
                      <span className={cn("text-sm", done ? "font-medium" : "text-muted-foreground")}>{t(s.label)}</span>
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
              <span className="font-medium">{t("orders.detail.nextStepLabel")} </span>
              {t(NEXT_STEP_KEYS[order.status])}
            </p>
            <StatusControl id={order.id} status={order.status} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("orders.detail.customerTitle")}</CardTitle>
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
                <Phone className="size-4" aria-hidden /> {t("orders.detail.call")}
              </a>
              <a
                href={`https://wa.me/${phoneDigits.replace(/^\+/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                title={t("orders.detail.whatsappTitle")}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <MessageCircle className="size-4" aria-hidden /> {t("orders.detail.whatsapp")}
              </a>
              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <MapPin className="size-4" aria-hidden /> {t("orders.detail.openMap")}
                </a>
              )}
            </div>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("orders.detail.address")}</dt>
                <dd className="whitespace-pre-line">{order.customerAddress}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("orders.detail.deliveryLocation")}</dt>
                {/* A map link opens from the "Open map" button above. */}
                <dd className="break-words">{order.deliveryLocation}</dd>
              </div>
              {order.notes && (
                <div>
                  <dt className="text-muted-foreground">{t("orders.detail.notes")}</dt>
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
            <CardTitle>{t("orders.detail.itemsTitle")}</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="ps-6">{t("products.table.product")}</TableHead>
                <TableHead className="text-end">{t("products.table.price")}</TableHead>
                <TableHead className="text-end">{t("orders.detail.table.qty")}</TableHead>
                <TableHead className="pe-6 text-end">{t("orders.detail.table.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((i) => {
                const label = variantLabel(parseAttributes(i.variantAttributesSnapshot), "");
                return (
                  <TableRow key={i.id}>
                    <TableCell className="ps-6">
                      <span className="font-medium">{i.productNameSnapshot}</span>
                      {label && <span className="block text-xs text-muted-foreground">{label}</span>}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {i.discountCentsSnapshot > 0 && (
                        <span className="block text-xs text-muted-foreground line-through">
                          {formatPrice(i.regularPriceCentsSnapshot)}
                        </span>
                      )}
                      {formatPrice(i.priceCentsSnapshot)}
                      {i.discountNameSnapshot && (
                        <span className="block text-xs text-destructive">{i.discountNameSnapshot}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="pe-6 text-end tabular-nums">
                      {formatPrice(i.priceCentsSnapshot * i.quantity)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={3} className="ps-6 text-end">
                  {t("orders.detail.subtotal")}
                </TableCell>
                <TableCell className="pe-6 text-end tabular-nums">
                  {formatPrice(orderSubtotal(order.items))}
                </TableCell>
              </TableRow>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={3} className="ps-6 text-end">
                  {t("orders.detail.delivery")}
                </TableCell>
                <TableCell className="pe-6 text-end tabular-nums">
                  {order.deliveryFeeCentsSnapshot === 0 ? t("orders.detail.free") : formatPrice(order.deliveryFeeCentsSnapshot)}
                </TableCell>
              </TableRow>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={3} className="ps-6 text-end font-semibold">
                  {t("orders.detail.totalToCollect")}
                </TableCell>
                <TableCell className="pe-6 text-end text-base font-semibold tabular-nums" data-testid="order-total">
                  {formatPrice(orderTotal(order.items, order.deliveryFeeCentsSnapshot))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
