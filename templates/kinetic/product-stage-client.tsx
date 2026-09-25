"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { Picture, cardPrice, productHref } from "../shared";
import type { StoreInfo, StoreProduct } from "../types";

gsap.registerPlugin(useGSAP);

const ROTATION_MS = 5200;

export function ProductStage({ store, products, content }: {
  store: StoreInfo;
  products: StoreProduct[];
  content: ContentMap;
}) {
  const [active, setActive] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const index = Math.min(active, products.length - 1);
  const product = products[index];
  const isRunning = products.length > 1 && autoRotate && motionAllowed && inView && pageVisible && !interacting;

  useEffect(() => {
    const root = stage.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setMotionAllowed(!reducedMotion.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.35 },
    );

    syncMotion();
    syncVisibility();
    observer.observe(root);
    reducedMotion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % products.length);
    }, ROTATION_MS);
    return () => window.clearTimeout(timer);
  }, [index, isRunning, products.length]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .fromTo(
            "[data-stage-image]",
            { clipPath: "inset(0 0 100% 0)", scale: 1.035 },
            { clipPath: "inset(0 0 0% 0)", scale: 1, duration: 0.8, ease: "power3.inOut" },
          )
          .from("[data-stage-copy] > *", { y: 22, autoAlpha: 0, stagger: 0.065, duration: 0.55 }, 0.3)
          .from("[data-stage-meta]", { x: 18, autoAlpha: 0, duration: 0.5 }, 0.38);
      });
      return () => media.revert();
    },
    { scope: stage, dependencies: [index], revertOnUpdate: true },
  );

  useGSAP(
    () => {
      gsap.set("[data-stage-progress]", { scaleX: 0, transformOrigin: "left center" });
      if (!isRunning) return;
      gsap.to("[data-stage-progress]", {
        scaleX: 1,
        duration: ROTATION_MS / 1000,
        ease: "none",
      });
    },
    { scope: stage, dependencies: [index, isRunning], revertOnUpdate: true },
  );

  if (!product) return null;

  const href = productHref(store, product);
  const move = (direction: number) => {
    setActive((current) => (current + direction + products.length) % products.length);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
  };

  return (
    <div
      ref={stage}
      role="region"
      aria-roledescription="carousel"
      aria-label={content["newArrivals.heading"]}
      data-active-index={index}
      data-auto-rotating={isRunning ? "true" : "false"}
      onPointerEnter={() => setInteracting(true)}
      onPointerLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={handleBlur}
      className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.55fr)] lg:gap-10 xl:gap-16"
    >
      <div className="relative min-h-[32rem] overflow-hidden bg-secondary sm:min-h-[46rem] lg:h-[min(72vh,44rem)] lg:min-h-[38rem]">
        <Link
          key={product.id}
          href={href}
          className="group absolute inset-0"
          data-stage-image
          aria-label={`${content["product.viewLabel"]}: ${product.name}`}
        >
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full"
            imgClassName="object-contain p-8 transition-transform duration-700 group-hover:scale-[1.025] sm:p-14 lg:p-16"
            sizes="(max-width: 1024px) 100vw, 68vw"
          />
        </Link>

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/0 to-background/10" />

        <div className="absolute left-5 top-5 flex items-center gap-2 sm:left-8 sm:top-8">
          <span className="rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground backdrop-blur-md">
            {String(index + 1).padStart(2, "0")} / {String(products.length).padStart(2, "0")}
          </span>
          {!product.inStock && (
            <span className="rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground backdrop-blur-md">
              {content["product.outOfStock"]}
            </span>
          )}
        </div>

        <div
          key={`${product.id}-copy`}
          data-stage-copy
          aria-live={isRunning ? "off" : "polite"}
          className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-5 p-5 sm:p-8 lg:p-10"
        >
          <div className="min-w-0">
            <p className="mb-3 text-sm font-semibold tabular-nums text-foreground/70">
              {cardPrice(product, content)}
            </p>
            <Link
              href={href}
              className="block max-w-3xl text-[clamp(2.65rem,6vw,6.25rem)] font-black leading-[0.86] tracking-[-0.06em] text-balance"
            >
              {product.name}
            </Link>
          </div>
          <Link
            href={href}
            aria-label={`${content["product.viewLabel"]}: ${product.name}`}
            className="pointer-events-auto grid size-14 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:size-16"
          >
            <ArrowUpRight className="size-5" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="flex min-w-0 flex-col lg:h-[min(72vh,44rem)] lg:min-h-[38rem]">
        <div data-stage-meta className="border-t border-border pt-6 lg:border-t-0 lg:pt-0">
          <div className="flex items-start justify-between gap-6">
            <p className="max-w-md text-base leading-relaxed text-muted-foreground">
              {product.description || product.name}
            </p>
            <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground xl:block">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <Link
            href={href}
            className="mt-7 inline-flex min-h-11 items-center gap-2 border-b border-foreground text-sm font-semibold"
          >
            {content["product.viewLabel"]}
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>

        {products.length > 1 && (
          <>
            <div className="mt-10 flex items-center justify-between gap-4 border-y border-border py-4 lg:mt-auto">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => move(-1)}
                  aria-label="Previous product"
                  className="grid size-11 place-items-center rounded-full border border-border transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(1)}
                  aria-label="Next product"
                  className="grid size-11 place-items-center rounded-full border border-border transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>

              {motionAllowed && (
                <button
                  type="button"
                  onClick={() => setAutoRotate((current) => !current)}
                  aria-label={autoRotate ? "Pause product rotation" : "Play product rotation"}
                  aria-pressed={!autoRotate}
                  className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {autoRotate ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                  <span>{autoRotate ? "Pause" : "Play"}</span>
                </button>
              )}
            </div>

            <div className="h-0.5 overflow-hidden bg-border" aria-hidden>
              <span data-stage-progress className="block h-full w-full bg-accent" />
            </div>

            <ol className="mt-5 flex snap-x gap-3 overflow-x-auto pb-2 lg:block lg:overflow-visible lg:pb-0">
              {products.map((item, itemIndex) => (
                <li key={item.id} className="min-w-[min(18rem,78vw)] snap-start lg:min-w-0">
                  <button
                    type="button"
                    onClick={() => setActive(itemIndex)}
                    aria-pressed={itemIndex === index}
                    className={cn(
                      "group flex min-h-20 w-full items-center gap-4 border border-border p-2.5 text-left transition-colors lg:border-x-0 lg:border-t-0",
                      itemIndex === index ? "bg-secondary" : "hover:bg-secondary/60",
                    )}
                  >
                    <span className="relative size-14 shrink-0 overflow-hidden bg-secondary">
                      <Picture src={item.imageUrl} alt="" className="absolute inset-0" imgClassName="object-contain p-1.5" sizes="56px" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.name}</span>
                      <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                        {cardPrice(item, content)}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "mr-1 size-2 shrink-0 rounded-full border border-foreground transition-colors",
                        itemIndex === index && "bg-foreground",
                      )}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
