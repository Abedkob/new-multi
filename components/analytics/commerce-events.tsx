"use client";

/**
 * The funnel's two page-level steps (§3.2).
 *
 * PAGE_VIEW already records that a cart or checkout page was shown. These are different and
 * narrower claims: the shopper reached their cart with something in it, and the shopper reached
 * checkout with something in it. "Put things in a cart and never started checkout" and "started
 * checkout and did not finish" are the two steps a merchant can actually act on, so they get
 * their own events rather than being inferred from page views.
 *
 * Both mount-once, and both read the cart, so they live in a client component that the server
 * pages drop in. They are no-ops wherever collection is off: useAnalytics() is inert outside a
 * storefront with a granted visitor.
 */

import { useEffect, useRef } from "react";
import { useAnalytics } from "@/components/analytics/tracker";
import { useCart } from "@/lib/cart/cart";

/** CART_VIEW: the cart page was opened with at least one line in it. */
export function CartViewTracker() {
  const { track } = useAnalytics();
  const cart = useCart();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || cart.count === 0) return;
    sent.current = true;
    track({ type: "CART_VIEW", pageKind: "cart" });
  }, [cart.count, track]);

  return null;
}

/**
 * CHECKOUT_STARTED: the shopper arrived at checkout with a non-empty cart.
 *
 * On arrival, not on submit (D18). Firing it at submit would make "started checkout and did not
 * finish" unmeasurable, which is the one step in this funnel where a merchant can still
 * recover the sale.
 */
export function CheckoutStartedTracker() {
  const { track } = useAnalytics();
  const cart = useCart();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || cart.count === 0) return;
    sent.current = true;
    track({ type: "CHECKOUT_STARTED", pageKind: "checkout" });
  }, [cart.count, track]);

  return null;
}
