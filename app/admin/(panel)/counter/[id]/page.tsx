import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import { can, requireCapability } from "@/lib/permissions";
import { counterSaleRef, counterSaleTotal, hasCounterSaleHistory } from "@/lib/counter-sales";
import { getCounterSale } from "@/lib/data/counter-sales";
import { getTenantById } from "@/lib/data/tenants";
import { parseAttributes, variantLabel } from "@/lib/variants";
import { PrintButton } from "./print-button";
import { VoidControl } from "./void-control";

/**
 * One sale's receipt. Readable by anyone who may read the till; voidable only by the owner.
 *
 * The whole receipt sits inside one `[data-print-area]`, which is the only thing the `@media
 * print` block in globals.css leaves visible — so what a cashier hands the customer is the store's
 * name, this sale and its total, and never the admin sidebar or the Void control. Anything that is
 * a control rather than a record is marked `data-print-hide`.
 */
export default async function CounterSalePage({ params }: PageProps<"/admin/counter/[id]">) {
  const { id } = await params;
  const { tenantId, role } = await requireCapability("counter:read");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant || !hasCounterSaleHistory(tenant)) notFound();

  const sale = await getCounterSale(tenantId, id);
  if (!sale) notFound();

  const total = counterSaleTotal(sale.items);
  const unreturnedLines =
    sale.status === "VOIDED" ? sale.items.length - (sale.voidRestoredLines ?? 0) : 0;

  return (
    <div className="grid gap-4">
      <PageHeader
        title={`${t("counter.sale.title")} ${counterSaleRef(sale.id)}`}
        back={{ href: "/admin/counter", label: t("counter.sale.back") }}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={sale.status === "VOIDED" ? "outline" : "secondary"}>
              {t(`counter.status.${sale.status}` as const)}
            </Badge>
            <PrintButton />
          </div>
        }
      />

      <section data-print-area className="grid gap-4">
        {/*
          Paper has no page header, no breadcrumb and no sidebar to say which shop this is or
          which sale it was, so the receipt carries all three itself. On screen this is redundant
          with the page header above it, which is why it is print-only.
        */}
        <header className="hidden print:grid print:gap-1 print:pb-3 print:text-center">
          <p className="text-base font-semibold">{tenant.name}</p>
          <p className="text-xs">
            {t("counter.sale.title")} {counterSaleRef(sale.id)}
          </p>
          <p className="text-xs">{sale.createdAt.toLocaleString()}</p>
          {sale.status === "VOIDED" && (
            <p className="text-xs font-semibold">{t("counter.status.VOIDED")}</p>
          )}
        </header>

        <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3 print:hidden">
          <Pair label={t("counter.sale.when")} value={sale.createdAt.toLocaleString()} />
          <Pair label={t("counter.sale.soldBy")} value={sale.soldByNameSnapshot} />
          <Pair
            label={t("counter.sale.paidBy")}
            value={t(`counter.payment.${sale.payment}` as const)}
          />
        </dl>

        <ul className="grid gap-2 print:gap-1">
          {sale.items.map((item) => {
            const label = variantLabel(parseAttributes(item.variantAttributesSnapshot), "");
            const reduced = item.manualDiscountCentsSnapshot > 0;
            return (
              <li
                key={item.id}
                className="grid gap-1 rounded-lg border p-3 print:rounded-none print:border-0 print:p-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium">
                    {item.productNameSnapshot}
                    {label ? ` · ${label}` : ""}
                    <span className="text-muted-foreground print:text-current"> × {item.quantity}</span>
                  </p>
                  <span className="shrink-0 text-sm tabular-nums">
                    {formatPrice(item.priceCentsSnapshot * item.quantity)}
                  </span>
                </div>
                {(reduced || item.discountNameSnapshot) && (
                  <p className="text-xs text-muted-foreground print:text-current">
                    {t("counter.sale.was")} {formatPrice(item.regularPriceCentsSnapshot)}
                    {item.discountNameSnapshot ? ` · ${item.discountNameSnapshot}` : ""}
                    {reduced
                      ? ` · ${t("counter.sale.reduction")} ${formatPrice(
                          item.manualDiscountCentsSnapshot,
                        )}${item.manualDiscountReason ? ` (${item.manualDiscountReason})` : ""}`
                      : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground print:text-current">
            {t("counter.sale.total")}
          </span>
          <span data-testid="receipt-total" className="text-2xl font-semibold tabular-nums">
            {formatPrice(total)}
          </span>
        </div>

        {/* On paper the payment method and the seller belong under the total, where a customer
            checking a receipt looks for them. */}
        <footer className="hidden print:grid print:gap-1 print:pt-3 print:text-xs">
          <p>
            {t("counter.sale.paidBy")}: {t(`counter.payment.${sale.payment}` as const)}
          </p>
          <p>
            {t("counter.sale.soldBy")}: {sale.soldByNameSnapshot}
          </p>
          <p className="print:pt-2 print:text-center">{t("counter.sale.thanks")}</p>
        </footer>
      </section>

      {sale.status === "VOIDED" ? (
        <div data-print-hide className="grid gap-1 rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">
            {t("counter.sale.voidedOn")} {sale.voidedAt?.toLocaleString()}
          </p>
          {sale.voidReason && <p className="text-muted-foreground">{sale.voidReason}</p>}
          {/*
            Said plainly rather than left implied. A variant the owner later removed from the
            product form is gone, so that line's stock had nowhere to go back to — and claiming a
            full restore would be a lie the owner could only find by counting the shelf.
          */}
          <p className="text-muted-foreground">
            {unreturnedLines > 0
              ? t("counter.sale.stockPartlyReturned")
              : t("counter.sale.stockReturned")}
          </p>
        </div>
      ) : (
        can(role, "counter:void") && (
          <div data-print-hide>
            <VoidControl saleId={sale.id} />
          </div>
        )
      )}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
