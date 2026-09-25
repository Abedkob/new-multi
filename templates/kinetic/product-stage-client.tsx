"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowUpRight } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { Picture, cardPrice, productHref } from "../shared";
import type { StoreInfo, StoreProduct } from "../types";

gsap.registerPlugin(useGSAP);

export function ProductStage({
  store,
  products,
  content,
}: {
  store: StoreInfo;
  products: StoreProduct[];
  content: ContentMap;
}) {
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const index = Math.min(active, products.length - 1);
  const product = products[index];

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline()
          .from("[data-stage-image]", { clipPath: "inset(0 0 100% 0)", duration: 0.75, ease: "power3.inOut" })
          .from("[data-stage-copy] > *", { y: 18, autoAlpha: 0, stagger: 0.06, duration: 0.5 }, 0.28);
      });
      return () => media.revert();
    },
    { scope: stage, dependencies: [index], revertOnUpdate: true },
  );

  if (!product) return null;
  const href = productHref(store, product);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.58fr)] lg:gap-16">
      <div ref={stage} className="relative min-h-[36rem] overflow-hidden bg-secondary sm:min-h-[48rem]">
        <Link key={product.id} href={href} className="group absolute inset-0" data-stage-image>
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full"
            imgClassName="object-contain p-8 transition-transform duration-700 group-hover:scale-[1.025] sm:p-14"
            sizes="(max-width: 1024px) 100vw, 62vw"
          />
        </Link>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background/90 to-transparent" />
        <div key={`${product.id}-copy`} data-stage-copy className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-6 sm:p-10">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {String(index + 1).padStart(2, "0")} / {String(products.length).padStart(2, "0")}
            </p>
            <Link href={href} className="mt-2 block max-w-3xl text-[clamp(2.5rem,6vw,6rem)] font-black leading-[0.88] tracking-[-0.06em] text-balance">
              {product.name}
            </Link>
          </div>
          <Link
            href={href}
            aria-label={`${content["product.viewLabel"]}: ${product.name}`}
            className="pointer-events-auto grid size-14 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-transform hover:scale-105 sm:size-16"
          >
            <ArrowUpRight className="size-5" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="flex flex-col justify-between gap-10">
        <div>
          <p className="text-2xl font-semibold">{cardPrice(product, content)}</p>
          {product.description && (
            <p className="mt-5 line-clamp-4 max-w-lg whitespace-pre-line leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}
        </div>

        {products.length > 1 && (
          <ol className="border-t border-border">
            {products.map((item, itemIndex) => (
              <li key={item.id} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => setActive(itemIndex)}
                  aria-pressed={itemIndex === index}
                  className={cn(
                    "group flex min-h-16 w-full items-center gap-4 py-3 text-left transition-opacity",
                    itemIndex === index ? "opacity-100" : "opacity-45 hover:opacity-100",
                  )}
                >
                  <span className="w-7 shrink-0 text-xs tabular-nums">
                    {String(itemIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg font-semibold sm:text-xl">{item.name}</span>
                  <span className="hidden shrink-0 text-sm tabular-nums sm:block">
                    {cardPrice(item, content)}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "h-px bg-foreground transition-[width] duration-300",
                      itemIndex === index ? "w-12" : "w-0 group-hover:w-6",
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
