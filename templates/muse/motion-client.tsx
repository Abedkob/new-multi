"use client";

import { Fragment, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { Picture, cardPrice, productHref } from "../shared";
import type { StoreInfo, StoreProduct } from "../types";

/**
 * Muse's scroll-driven pieces. MotionConfig's reducedMotion="user" only neutralizes transforms,
 * so anything scroll-linked or opacity-based here checks the media query itself. It's read
 * through useSyncExternalStore (server snapshot: false), so hydration always matches the server
 * HTML and a reduced-motion shopper gets the still version one render later.
 */
function useStill() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Drifts its children vertically against the scroll. The children are oversized (inset -12%
 * top and bottom) so the drift never reveals an edge. */
export function Parallax({ children, className, strength = 12 }: { children: ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const still = useStill();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [`-${strength}%`, `${strength}%`]);
  return (
    <div ref={ref} className={cn("absolute inset-0 overflow-hidden", className)}>
      <motion.div style={{ y: still ? 0 : y }} className="absolute inset-x-0 -inset-y-[12%]">
        {children}
      </motion.div>
    </div>
  );
}

function LitWord({ progress, range, still, children }: { progress: MotionValue<number>; range: [number, number]; still: boolean; children: ReactNode }) {
  const opacity = useTransform(progress, range, [0.15, 1]);
  return <motion.span style={{ opacity: still ? 1 : opacity }}>{children}</motion.span>;
}

/** A pill-shaped photo set into a line of text; it stretches open once it's on screen. */
function TextPill({ src }: { src: string }) {
  return (
    <motion.span
      initial={{ width: "0.9em" }}
      whileInView={{ width: "2.6em" }}
      viewport={{ once: true, amount: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      className="relative mx-[0.12em] inline-block h-[0.78em] overflow-hidden rounded-full bg-secondary align-[-0.06em]"
    >
      <Picture src={src} alt="" className="absolute inset-0" sizes="160px" />
    </motion.span>
  );
}

/**
 * The statement heading: each word lights up as the heading scrolls through the viewport, with
 * up to two photo pills set between the words. Screen readers (and the verify script) get the
 * plain sentence; the lit-up copy is aria-hidden.
 */
export function ScrollStatement({ text, pills, className }: { text: string; pills: string[]; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const still = useStill();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "end 0.55"] });
  const words = text.split(/\s+/).filter(Boolean);
  const slots = words.length >= 4 ? [Math.round(words.length * 0.4), Math.round(words.length * 0.8)].slice(0, pills.length) : [];
  return (
    <h2 ref={ref} className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, i) => (
          <Fragment key={i}>
            {slots.includes(i) && (
              <>
                <TextPill src={pills[slots.indexOf(i)]} />{" "}
              </>
            )}
            <LitWord progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} still={still}>
              {word}
            </LitWord>{" "}
          </Fragment>
        ))}
      </span>
    </h2>
  );
}

/** A round badge with `text` running around its rim (spinning, via CSS) and an arrow at the center. */
export function SpinBadge({ text, className }: { text: string; className?: string }) {
  // Repeat the label so it wraps the whole rim; textLength then spaces it out to close the loop.
  const unit = `${text.toUpperCase()} • `;
  const label = unit.repeat(Math.max(1, Math.floor(40 / unit.length)));
  return (
    <span className={cn("relative grid size-28 place-items-center rounded-full bg-accent text-accent-foreground", className)}>
      <svg viewBox="0 0 100 100" aria-hidden className="muse-spin absolute inset-0 size-full">
        <defs>
          <path id="muse-rim" d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" />
        </defs>
        <text fontSize="8.5" letterSpacing="1" fill="currentColor">
          <textPath href="#muse-rim" textLength="230" lengthAdjust="spacing">
            {label}
          </textPath>
        </text>
      </svg>
      <ArrowUpRight aria-hidden className="size-6" />
    </span>
  );
}

/**
 * Best sellers: a large photo of the "active" product beside a ranked list. Hovering or focusing
 * a row swaps the photo (crossfade + settle). Every best seller's name and price is in the list,
 * so the server HTML already carries all of them.
 */
export function BestSellerShowcase({
  store,
  content,
  products,
  heading,
}: {
  store: StoreInfo;
  content: ContentMap;
  products: StoreProduct[];
  heading: string;
}) {
  const [active, setActive] = useState(0);
  const current = products[active];
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
      <Link
        href={productHref(store, current)}
        className="group relative block aspect-[4/5] overflow-hidden rounded-[2rem] bg-secondary sm:aspect-[4/3] lg:aspect-auto lg:min-h-[36rem]"
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0"
          >
            <Picture src={current.imageUrl} alt={current.name} className="size-full" sizes="(max-width: 1024px) 100vw, 50vw" />
          </motion.div>
        </AnimatePresence>
        <SpinBadge text={heading} className="absolute right-5 top-5 transition-transform duration-500 group-hover:scale-110" />
      </Link>

      <div className="flex flex-col rounded-[2rem] bg-primary p-6 text-primary-foreground sm:p-10">
        <h2 className="font-muse text-4xl leading-none sm:text-6xl">{heading}</h2>
        <ol className="mt-8 flex-1 sm:mt-12">
          {products.map((p, i) => (
            <li key={p.id} className="border-b border-primary-foreground/15 last:border-b-0">
              <Link
                href={productHref(store, p)}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                className={cn(
                  "group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-5 transition-opacity duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground sm:gap-5",
                  i === active ? "opacity-100" : "opacity-45 hover:opacity-100",
                )}
              >
                <span className="text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <span className="block truncate font-muse text-2xl transition-transform duration-500 group-hover:translate-x-2 sm:text-3xl">
                    {p.name}
                  </span>
                  <span className="mt-1 block text-sm sm:hidden">{cardPrice(p, content)}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="hidden text-sm sm:block">{cardPrice(p, content)}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-9 place-items-center rounded-full bg-accent text-accent-foreground transition-transform duration-500",
                      i === active ? "rotate-45 scale-100" : "scale-0",
                    )}
                  >
                    <ArrowUpRight className="size-4" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
