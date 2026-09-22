"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCartDetailsAction, type CartDetail } from "@/app/store/[slug]/cart/actions";
import { useCart } from "@/lib/cart/cart";

export type CartItem = CartDetail & { quantity: number };

/**
 * Resolves the cart's { variantId, quantity } entries into names, prices, images and current
 * stock (from the server), and keeps the cart honest: items that no longer exist are dropped
 * (with a notice) and quantities above current stock are lowered to what is available.
 */
export function useCartDetails(slug: string) {
  const { lines, setQuantity, remove } = useCart();
  const [details, setDetails] = useState<Map<string, CartDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [removedNotice, setRemovedNotice] = useState(false);

  // Always read the latest cart inside the async callback.
  const latest = useRef(lines);
  useEffect(() => {
    latest.current = lines;
  });

  const key = lines
    .map((l) => l.variantId)
    .sort()
    .join(",");

  const refresh = useCallback(async () => {
    const current = latest.current;
    if (current.length === 0) {
      setDetails(new Map());
      return;
    }
    setLoading(true);
    try {
      const { items } = await getCartDetailsAction(
        slug,
        current.map((l) => l.variantId),
      );
      const map = new Map(items.map((d) => [d.variantId, d]));
      setDetails(map);
      for (const line of latest.current) {
        const d = map.get(line.variantId);
        if (!d || d.stock <= 0) {
          remove(line.variantId);
          setRemovedNotice(true);
        } else if (line.quantity > d.stock) {
          setQuantity(line.variantId, d.stock, d.stock);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [slug, remove, setQuantity]);

  useEffect(() => {
    // Re-resolve whenever the set of items in the cart changes.
    void refresh();
  }, [key, refresh]);

  const items: CartItem[] = lines.flatMap((l) => {
    const d = details.get(l.variantId);
    return d ? [{ ...d, quantity: l.quantity }] : [];
  });
  const subtotal = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

  return { items, subtotal, loading, removedNotice, refresh, hasLines: lines.length > 0 };
}
