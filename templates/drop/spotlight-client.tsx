"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ContentMap } from "@/lib/content";
import { Picture, cardPrice, productHref } from "../shared";
import type { StoreInfo, StoreProduct } from "../types";

/**
 * One product shown large at a time, switched by a thumbnail rail below it — a lookbook slide,
 * not a grid or a carousel. Thumbnails are real buttons (click, not hover-only), so it works
 * the same on touch and with a keyboard.
 */
export function Spotlight({
  store,
  products,
  content,
  badgeLabel,
}: {
  store: StoreInfo;
  products: StoreProduct[];
  content: ContentMap;
  badgeLabel: string;
}) {
  const [active, setActive] = useState(0);
  const index = Math.min(active, products.length - 1);
  const product = products[index];
  const href = productHref(store, product);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-16">
      <Link href={href} className="group relative block aspect-[4/5] overflow-hidden bg-secondary sm:aspect-[16/10] lg:aspect-[4/5]">
        <span className="absolute left-4 top-4 z-10 bg-accent px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-accent-foreground">
          {badgeLabel}
        </span>
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="h-full w-full"
          imgClassName="object-contain p-6 transition-transform duration-700 group-hover:scale-105 sm:p-12"
        />
      </Link>

      <div className="flex flex-col">
        <div className="border-b border-border pb-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")} / {String(products.length).padStart(2, "0")}
          </p>
          <Link href={href} className="mt-4 block text-4xl font-black uppercase leading-[0.9] tracking-tight transition-opacity hover:opacity-70 sm:text-5xl">
            {product.name}
          </Link>
          <p className="mt-4 text-2xl font-bold">{cardPrice(product, content)}</p>
          <Link
            href={href}
            className="mt-8 inline-flex h-12 items-center bg-primary px-8 text-xs font-bold uppercase tracking-[0.2em] text-primary-foreground transition hover:opacity-90"
          >
            {content["product.viewLabel"]}
          </Link>
        </div>

        {products.length > 1 && (
          <ul className="mt-8 flex flex-wrap gap-3">
            {products.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={i === index}
                  aria-label={p.name}
                  className={cn(
                    "relative size-16 overflow-hidden bg-secondary outline outline-2 -outline-offset-2 transition-colors sm:size-20",
                    i === index ? "outline-accent" : "outline-transparent",
                  )}
                >
                  <Picture src={p.imageUrl} alt="" className="size-full" imgClassName="object-contain p-2" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
