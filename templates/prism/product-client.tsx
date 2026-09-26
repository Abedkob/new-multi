"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductImage, ProductGallery, ProductPrice, useProduct } from "../product-client";
import styles from "./prism.module.css";

export function PrismGallery() {
  const { product, variant, activeImage, setActiveImage } = useProduct();
  const start = useRef<{ x: number; y: number } | null>(null);
  const direction = useRef(1);
  const frame = useRef<HTMLDivElement>(null);
  const images = [...new Set([variant?.imageUrl, product.imageUrl, ...product.images.map((image) => image.url)].filter((url): url is string => !!url))];
  const current = activeImage || variant?.imageUrl || product.imageUrl;
  const index = Math.max(0, images.indexOf(current));
  const change = (dir: number) => { direction.current = dir; setActiveImage(images[(index + dir + images.length) % images.length]); };

  /** Crossfade the frame in from the swipe/arrow direction on every image change, instead of the
   * hard cut a remounted frame would give. */
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(frame.current, { autoAlpha: 0, xPercent: direction.current * 6 }, { autoAlpha: 1, xPercent: 0, duration: .35, ease: "power2.out" });
    });
    return () => media.revert();
  }, { scope: frame, dependencies: [current], revertOnUpdate: true });

  return <div>
    <div className="relative overflow-hidden bg-secondary"
      onTouchStart={(event) => { start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchEnd={(event) => {
        if (!start.current || images.length < 2) return;
        const dx = event.changedTouches[0].clientX - start.current.x;
        const dy = event.changedTouches[0].clientY - start.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) change(dx < 0 ? 1 : -1);
        start.current = null;
      }}>
      <div ref={frame} className={styles.galleryFrame}><ProductImage className="aspect-[4/5]" /></div>
      {images.length > 1 && <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-4">
        <button type="button" aria-label="Previous product image" onClick={() => change(-1)} className="grid size-12 place-items-center rounded-full bg-background text-foreground"><ChevronLeft aria-hidden /></button>
        <span role="status" className="rounded-full bg-background px-4 py-2 text-sm text-foreground">{index + 1} / {images.length}</span>
        <button type="button" aria-label="Next product image" onClick={() => change(1)} className="grid size-12 place-items-center rounded-full bg-background text-foreground"><ChevronRight aria-hidden /></button>
      </div>}
    </div>
    <ProductGallery className="mt-4 gap-3" />
  </div>;
}

/** A stable shortcut to the real buying controls; never creates a second variant selection. */
export function PurchaseControls({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [belowControls, setBelowControls] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setBelowControls(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <>
    <div ref={root} id={id} tabIndex={-1} className="mt-9 grid scroll-mt-28 gap-7">{children}</div>
    <div
      aria-hidden={!belowControls}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-border bg-background px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-300 ease-out lg:hidden",
        belowControls ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none",
      )}
    >
      <ProductPrice className="text-sm" />
      <button
        type="button"
        tabIndex={belowControls ? 0 : -1}
        className={styles.button}
        onClick={() => { root.current?.scrollIntoView({ block: "center" }); root.current?.focus({ preventScroll: true }); }}
      >
        View purchase options
      </button>
    </div>
  </>;
}
