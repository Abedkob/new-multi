"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { AnalyticsConfig } from "@/lib/integrations";

/**
 * Per-store GA4 / Google Ads / Meta Pixel for the storefront. Mounted ONLY by
 * app/store/[slug]/layout.tsx — never by templates/render or the admin preview iframes — so
 * editing a store never sends pageviews or events into that store's analytics. Everything that
 * fires an event goes through useTrack(), which is a no-op outside this provider (the previews).
 *
 * Load order: next/script loads gtag.js / fbevents.js after hydration, but child components'
 * effects (a product view, the purchase) can fire before that. So every call first installs the
 * standard queue stubs (window.dataLayer + gtag, window.fbq) and the one-time config/init calls;
 * the real libraries replay the queue when they arrive, and nothing fired early is lost.
 *
 * Money: cents in, dollars out (value: 12.5), currency USD — see lib/format.ts.
 */

const CURRENCY = "USD";

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

// Which ids this page has already configured, so re-renders never re-init.
const configured = new Set<string>();

function gtagFor(config: AnalyticsConfig): Gtag | null {
  if (!config.gaId && !config.adsId) return null;
  window.dataLayer = window.dataLayer || [];
  // gtag.js requires the real `arguments` object in the dataLayer, not an array copy.
  window.gtag =
    window.gtag ||
    function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
  if (!configured.has("gtag")) {
    configured.add("gtag");
    window.gtag("js", new Date());
  }
  for (const id of [config.gaId, config.adsId]) {
    if (id && !configured.has(id)) {
      configured.add(id);
      // GA4 sends the first page_view itself; later client-side navigations are picked up by
      // GA4's enhanced measurement ("page changes based on browser history events", on by
      // default), so no manual page_view here — that would double count.
      window.gtag("config", id);
    }
  }
  return window.gtag;
}

function fbqFor(pixelId: string | null): Fbq | null {
  if (!pixelId) return null;
  if (!window.fbq) {
    // Meta's own bootstrap stub, minus the script injection (next/script does that).
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    window.fbq = n;
    window._fbq = window._fbq || n;
  }
  if (!configured.has(`fb:${pixelId}`)) {
    configured.add(`fb:${pixelId}`);
    window.fbq("init", pixelId);
  }
  return window.fbq;
}

export type TrackItem = {
  /** Variant id when known (what the shopper actually picks), else product id. */
  id: string;
  name: string;
  variant?: string;
  priceCents: number;
  quantity: number;
};

const dollars = (cents: number) => Math.round(cents) / 100;
const sumCents = (items: TrackItem[]) => items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
const gaItems = (items: TrackItem[]) =>
  items.map((i) => ({
    item_id: i.id,
    item_name: i.name,
    ...(i.variant ? { item_variant: i.variant } : {}),
    price: dollars(i.priceCents),
    quantity: i.quantity,
  }));
const metaContents = (items: TrackItem[]) =>
  items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: dollars(i.priceCents) }));

function makeTracker(config: AnalyticsConfig) {
  const ga = (event: string, params: Record<string, unknown>) => {
    const gtag = gtagFor(config);
    if (gtag && config.gaId) gtag("event", event, { ...params, send_to: config.gaId });
  };
  const meta = (event: string, params: Record<string, unknown>, eventID?: string) => {
    const fbq = fbqFor(config.metaPixelId);
    if (fbq) fbq("track", event, params, ...(eventID ? [{ eventID }] : []));
  };

  return {
    viewItem(item: TrackItem) {
      const value = dollars(item.priceCents);
      ga("view_item", { currency: CURRENCY, value, items: gaItems([item]) });
      meta("ViewContent", {
        content_ids: [item.id],
        content_name: item.name,
        content_type: "product",
        value,
        currency: CURRENCY,
      });
    },
    addToCart(item: TrackItem) {
      const value = dollars(item.priceCents * item.quantity);
      ga("add_to_cart", { currency: CURRENCY, value, items: gaItems([item]) });
      meta("AddToCart", {
        content_ids: [item.id],
        contents: metaContents([item]),
        content_type: "product",
        value,
        currency: CURRENCY,
      });
    },
    beginCheckout(items: TrackItem[], deliveryFeeCents = 0) {
      const value = dollars(sumCents(items) + deliveryFeeCents);
      ga("begin_checkout", { currency: CURRENCY, value, shipping: dollars(deliveryFeeCents), items: gaItems(items) });
      meta("InitiateCheckout", {
        contents: metaContents(items),
        content_type: "product",
        num_items: items.reduce((n, i) => n + i.quantity, 0),
        value,
        currency: CURRENCY,
      });
    },
    purchase(orderId: string, items: TrackItem[], deliveryFeeCents = 0) {
      const value = dollars(sumCents(items) + deliveryFeeCents);
      // transaction_id lets GA4 and Google Ads drop a repeat of the same order.
      ga("purchase", {
        transaction_id: orderId,
        currency: CURRENCY,
        value,
        shipping: dollars(deliveryFeeCents),
        items: gaItems(items),
      });
      const gtag = gtagFor(config);
      if (gtag && config.adsId && config.adsPurchaseLabel) {
        gtag("event", "conversion", {
          send_to: `${config.adsId}/${config.adsPurchaseLabel}`,
          transaction_id: orderId,
          value,
          currency: CURRENCY,
        });
      }
      // eventID = order id, so Meta can dedupe it (and match a future Conversions API event).
      meta(
        "Purchase",
        { contents: metaContents(items), content_type: "product", value, currency: CURRENCY },
        orderId,
      );
    },
  };
}

type Tracker = ReturnType<typeof makeTracker>;

const NOOP: Tracker = {
  viewItem: () => {},
  addToCart: () => {},
  beginCheckout: () => {},
  purchase: () => {},
};

const Ctx = createContext<Tracker | null>(null);

/** Event helpers; inert outside a storefront with analytics configured (e.g. admin previews). */
export const useTrack = () => useContext(Ctx) ?? NOOP;

export function StoreAnalytics({
  config,
  children,
}: {
  config: AnalyticsConfig;
  children: React.ReactNode;
}) {
  // Keyed on the id strings, not the object: a router.refresh() re-sends the layout's props as a
  // new object, which must not re-create the tracker or fire another PageView.
  const { gaId, adsId, adsPurchaseLabel, metaPixelId } = config;
  const tracker = useMemo(
    () => makeTracker({ gaId, adsId, adsPurchaseLabel, metaPixelId }),
    [gaId, adsId, adsPurchaseLabel, metaPixelId],
  );
  const pathname = usePathname();
  const gtagId = gaId ?? adsId;

  // Meta has no automatic SPA page tracking: exactly one PageView per path, including the first.
  useEffect(() => {
    fbqFor(metaPixelId)?.("track", "PageView");
  }, [metaPixelId, pathname]);

  // Install the gtag stub + config calls on first mount even if no event fires on this page.
  useEffect(() => {
    gtagFor({ gaId, adsId, adsPurchaseLabel, metaPixelId });
  }, [gaId, adsId, adsPurchaseLabel, metaPixelId]);

  return (
    <Ctx.Provider value={tracker}>
      {gtagId && (
        <Script
          id="store-gtag"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gtagId)}`}
          strategy="afterInteractive"
        />
      )}
      {metaPixelId && (
        <Script
          id="store-meta-pixel"
          src="https://connect.facebook.net/en_US/fbevents.js"
          strategy="afterInteractive"
        />
      )}
      {children}
    </Ctx.Provider>
  );
}

/** Fires one event once per mount (StrictMode-safe), when `ready`. */
export function useTrackOnce(ready: boolean, fire: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    fire();
  });
}

/**
 * The purchase, fired from the order confirmation page. That URL stays valid forever (and gets
 * reloaded, bookmarked, shared), so a revisit must not count a second sale: the server only
 * renders this for a freshly placed order, and a per-browser flag stops a reload within that
 * window. transaction_id / eventID dedupe anything that still slips through on Google's/Meta's side.
 */
export function PurchaseTracker({
  orderId,
  items,
  deliveryFeeCents = 0,
}: {
  orderId: string;
  items: TrackItem[];
  deliveryFeeCents?: number;
}) {
  const track = useTrack();
  useTrackOnce(true, () => {
    const key = `purchase-tracked:${orderId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: fall back to the server-side freshness window + platform dedupe.
    }
    track.purchase(orderId, items, deliveryFeeCents);
  });
  return null;
}
