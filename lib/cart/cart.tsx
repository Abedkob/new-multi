"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAnalytics } from "@/components/analytics/tracker";

/**
 * The shopping cart lives ONLY in React state (no localStorage, no database), as required.
 * It holds just { variantId, quantity }; names, prices and images are resolved on the server
 * when the cart or checkout page needs them. The provider sits in the storefront layout, which
 * Next keeps mounted while shoppers move between pages with client-side navigation, so the cart
 * survives that (but not a full page reload).
 */

export type CartLine = { variantId: string; quantity: number };

type CartApi = {
  lines: CartLine[];
  /** Total number of items. */
  count: number;
  quantityOf: (variantId: string) => number;
  /** Adds up to `max` (the variant's stock) in total; returns how many were actually added. */
  add: (variantId: string, quantity: number, max: number) => number;
  setQuantity: (variantId: string, quantity: number, max: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
};

const NOOP_CART: CartApi = {
  lines: [],
  count: 0,
  quantityOf: () => 0,
  add: () => 0,
  setQuantity: () => {},
  remove: () => {},
  clear: () => {},
};

const CartContext = createContext<CartApi | null>(null);

/** Outside a CartProvider (previews) the cart is simply empty and inert. */
export const useCart = () => useContext(CartContext) ?? NOOP_CART;

/**
 * Cart analytics (Phase 3, D19).
 *
 * The events are emitted HERE, where the state actually changes, and not from the buttons that
 * trigger it. There are already several ways into the cart (the product page, the cart page's
 * own stepper, a remove link) and there will be more; emitting at the single point of change
 * means no entry point can be forgotten and no path can fire twice for one change.
 *
 * `useAnalytics()` is inert outside a storefront with collection active, so the cart keeps
 * working untouched in the admin previews and for a visitor who refused analytics.
 *
 * Two changes deliberately emit nothing:
 *   - lowering a quantity without reaching zero. The line is still in the cart, and counting it
 *     as a removal would double-count the same line in the funnel.
 *   - clear(), which runs after an order is placed. Nothing was removed; the cart was bought.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const { track } = useAnalytics();

  const quantityOf = useCallback(
    (variantId: string) => lines.find((l) => l.variantId === variantId)?.quantity ?? 0,
    [lines],
  );

  const add = useCallback(
    (variantId: string, quantity: number, max: number) => {
      const current = lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
      const next = Math.min(max, current + Math.max(1, Math.floor(quantity)));
      const added = Math.max(0, next - current);
      if (added === 0) return 0;
      setLines((ls) =>
        ls.some((l) => l.variantId === variantId)
          ? ls.map((l) => (l.variantId === variantId ? { ...l, quantity: next } : l))
          : [...ls, { variantId, quantity: next }],
      );
      // The quantity that was actually added, not the quantity asked for: a shopper who asks
      // for 5 of a variant with 2 left added 2.
      track({ type: "ADD_TO_CART", variantId, quantity: added });
      return added;
    },
    [lines, track],
  );

  const setQuantity = useCallback(
    (variantId: string, quantity: number, max: number) => {
      const q = Math.min(max, Math.max(0, Math.floor(quantity) || 0));
      const leaving = q === 0 ? lines.find((l) => l.variantId === variantId) : undefined;
      setLines((ls) =>
        q === 0
          ? ls.filter((l) => l.variantId !== variantId)
          : ls.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l)),
      );
      // Stepping down to zero is a removal, and it is the same removal the remove button makes.
      if (leaving) track({ type: "REMOVE_FROM_CART", variantId, quantity: leaving.quantity });
    },
    [lines, track],
  );

  const remove = useCallback(
    (variantId: string) => {
      const leaving = lines.find((l) => l.variantId === variantId);
      setLines((ls) => ls.filter((l) => l.variantId !== variantId));
      if (leaving) track({ type: "REMOVE_FROM_CART", variantId, quantity: leaving.quantity });
    },
    [lines, track],
  );
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartApi>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      quantityOf,
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, quantityOf, add, setQuantity, remove, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
