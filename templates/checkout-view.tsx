"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Check, LoaderCircle, MapPin } from "lucide-react";
import { placeOrderAction } from "@/app/store/[slug]/checkout/actions";
import { buttonVariants, Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ContentMap } from "@/lib/content";
import { useTrack, useTrackOnce } from "@/lib/analytics";
import { useCart } from "@/lib/cart/cart";
import { useCartDetails } from "@/lib/cart/use-cart-details";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Template } from "./types";

/** A Google Maps link that drops a pin on exactly these coordinates. */
export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

const noSubscribe = () => () => {};

/**
 * "Use my current location": asks the browser for the shopper's live position (the browser shows
 * its own allow/block prompt on the first click) and hands back a Google Maps link to it, which
 * the owner opens from the order. Hidden where the browser has no geolocation (or the page isn't
 * a secure context, where browsers withhold it); the field stays editable either way, so a
 * pasted link or a description still works when location is blocked or unavailable.
 */
function LocationPicker({ content, onLocated, located }: { content: ContentMap; onLocated: (url: string) => void; located: string }) {
  // Checked on the client only (server snapshot: false), so hydration always matches.
  const supported = useSyncExternalStore(
    noSubscribe,
    () => "geolocation" in navigator && window.isSecureContext,
    () => false,
  );
  const [status, setStatus] = useState<"idle" | "locating" | "found" | "denied" | "unavailable">("idle");

  if (!supported) return null;

  const locate = () => {
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocated(mapsUrl(pos.coords.latitude, pos.coords.longitude));
        setStatus("found");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <div className="grid gap-2" data-testid="location-picker">
      <Button type="button" variant="outline" onClick={locate} disabled={status === "locating"} className="h-11 justify-center gap-2 sm:w-fit" data-testid="use-location">
        {status === "locating" ? <LoaderCircle className="size-4 animate-spin" /> : <MapPin className="size-4" />}
        {status === "locating" ? content["checkout.locating"] : content["checkout.useLocation"]}
      </Button>
      {status === "found" && located.startsWith("https://www.google.com/maps?q=") && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="location-found">
          <Check className="size-4 text-primary" />
          {content["checkout.locationFound"]}
          <a href={located} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">
            {content["checkout.viewOnMap"]}
          </a>
        </p>
      )}
      {(status === "denied" || status === "unavailable") && (
        <p role="alert" className="text-sm text-destructive" data-testid="location-error">
          {status === "denied" ? content["checkout.locationDenied"] : content["checkout.locationUnavailable"]}
        </p>
      )}
    </div>
  );
}

/** Guest cash-on-delivery checkout: customer details + a read-only summary of the cart. */
export function CheckoutView({
  slug,
  basePath,
  content,
  deliveryFeeCents,
  deliveryNote,
  style,
}: {
  /** Used only for useCartDetails/placeOrderAction, which are always addressed by the real
   * tenant slug regardless of custom-domain routing. */
  slug: string;
  /** "" once the store has its own domain, else "/store/[slug]" — see templates/types.ts. */
  basePath: string;
  content: ContentMap;
  deliveryFeeCents: number;
  deliveryNote: string;
  style: Template["pageStyle"];
}) {
  const router = useRouter();
  const cart = useCart();
  const { items, subtotal, refresh, hasLines } = useCartDetails(slug);
  const base = basePath;

  // begin_checkout / InitiateCheckout once per visit, as soon as the cart's prices are known.
  const track = useTrack();
  useTrackOnce(items.length > 0, () =>
    track.beginCheckout(
      items.map((i) => ({
        id: i.variantId,
        name: i.productName,
        ...(i.label ? { variant: i.label } : {}),
        priceCents: i.priceCents,
        quantity: i.quantity,
      })),
      deliveryFeeCents,
    ),
  );

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    deliveryLocation: "",
    notes: "",
  });
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setFieldErrors({});
    startTransition(async () => {
      const res = await placeOrderAction(slug, {
        ...form,
        expectedDeliveryFeeCents: deliveryFeeCents,
        lines: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          expectedPriceCents: item.priceCents,
        })),
      });
      if (res.ok && res.orderId) {
        cart.clear();
        router.push(`${base}/order-confirmation/${res.orderId}`);
        return;
      }
      setError(res.priceChanged ? content["cart.priceChanged"] : res.error);
      setFieldErrors(res.fieldErrors ?? {});
      // Someone else may have bought the last unit: show the shopper current stock.
      if (res.stockChanged || res.priceChanged) await refresh();
      if (res.deliveryChanged) router.refresh();
    });
  };

  if (!hasLines) {
    return (
      <div className={style.container} data-testid="checkout-page">
        <h1 className={style.title}>{content["checkout.heading"]}</h1>
        <div className="mt-8 grid justify-items-start gap-4">
          {/* e.g. the last unit sold out while the shopper was filling in the form */}
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="checkout-error">
              {error}
            </p>
          )}
          <p className="text-muted-foreground">{content["cart.empty"]}</p>
          <Link href={`${base}/shop`} className={buttonVariants({ variant: "outline" })}>
            {content["cart.continue"]}
          </Link>
        </div>
      </div>
    );
  }

  const field = (
    id: keyof typeof form,
    label: string,
    opts: { textarea?: boolean; hint?: string; type?: string; autoComplete?: string } = {},
  ) => {
    const errs = fieldErrors[id];
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`co-${id}`}>{label}</Label>
        {opts.textarea ? (
          <Textarea id={`co-${id}`} name={id} rows={3} value={form[id]} onChange={set(id)} aria-invalid={!!errs?.length} />
        ) : (
          <Input
            id={`co-${id}`}
            name={id}
            type={opts.type ?? "text"}
            autoComplete={opts.autoComplete}
            value={form[id]}
            onChange={set(id)}
            aria-invalid={!!errs?.length}
          />
        )}
        {opts.hint && !errs?.length && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
        {errs?.map((m) => (
          <p key={m} className="text-sm text-destructive">
            {m}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className={style.container} data-testid="checkout-page">
      <h1 className={style.title}>{content["checkout.heading"]}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{content["checkout.cod"]}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form onSubmit={submit} className="grid max-w-xl gap-5" noValidate>
          {field("customerName", content["checkout.name"], { autoComplete: "name" })}
          {field("customerPhone", content["checkout.phone"], { type: "tel", autoComplete: "tel" })}
          {field("customerAddress", content["checkout.address"], { textarea: true, autoComplete: "street-address" })}
          <div className="grid gap-3">
            {field("deliveryLocation", content["checkout.location"], { hint: content["checkout.locationHint"] })}
            <LocationPicker
              content={content}
              located={form.deliveryLocation}
              onLocated={(url) => setForm((f) => ({ ...f, deliveryLocation: url }))}
            />
          </div>
          {field("notes", content["checkout.notes"], { textarea: true })}

          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="checkout-error">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" size="lg" disabled={pending || items.length === 0} data-testid="place-order" className="h-12 w-full sm:h-10 sm:w-auto">
              {pending ? content["checkout.placing"] : content["checkout.submit"]}
            </Button>
          </div>
        </form>

        <aside className={cn(style.panel, "h-fit")}>
          <h2 className="font-semibold">{content["checkout.summary"]}</h2>
          <ul className="mt-4 grid gap-3 text-sm" data-testid="checkout-lines">
            {items.map((i) => (
              <li key={i.variantId} className="flex justify-between gap-3">
                <span>
                  {i.quantity} &times; {i.productName}
                  {i.label && <span className="block text-muted-foreground">{i.label}</span>}
                </span>
                <span className="text-right tabular-nums">
                  {i.discountCents > 0 && (
                    <span className="block text-xs text-muted-foreground line-through">
                      {formatPrice(i.regularPriceCents * i.quantity)}
                    </span>
                  )}
                  {formatPrice(i.priceCents * i.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt>{content["cart.subtotal"]}</dt>
              <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Delivery</dt>
              <dd className="tabular-nums" data-testid="checkout-delivery-fee">
                {deliveryFeeCents === 0 ? "Free" : formatPrice(deliveryFeeCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 pt-2 text-base font-semibold">
              <dt>{content["confirmation.total"]}</dt>
              <dd className="tabular-nums" data-testid="checkout-total">
                {formatPrice(subtotal + deliveryFeeCents)}
              </dd>
            </div>
          </dl>
          {deliveryNote && (
            <p className="mt-3 text-sm text-muted-foreground">{deliveryNote}</p>
          )}
          <Link
            href={`${base}/cart`}
            className="mt-4 inline-block text-sm text-muted-foreground underline underline-offset-4"
          >
            {content["cart.heading"]}
          </Link>
        </aside>
      </div>
    </div>
  );
}
