"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 7000;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollToSlide(track: HTMLDivElement | null, i: number, count: number) {
  if (!track) return;
  const target = ((i % count) + count) % count;
  track.scrollTo({ left: target * track.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
}

/**
 * Mirage's scrollable hero. The slides sit side by side in a horizontal scroll-snap track, so a
 * shopper can swipe (phones), scroll sideways (trackpads) or use the arrows and progress bars;
 * the active slide always follows the real scroll position. It autoplays every 7 s, pausing
 * while hovered or focused, and not at all for reduced-motion shoppers. Off-screen slides are
 * `inert`, so their links aren't tabbable. With one slide there's no track chrome at all.
 * `footer` (the category links) is pinned along the bottom over every slide.
 */
export function MirageHeroCarousel({
  slides,
  footer,
  wrapClassName,
}: {
  slides: ReactNode[];
  footer?: ReactNode;
  wrapClassName: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const multi = count > 1;

  useEffect(() => {
    if (!multi || paused || reducedMotion()) return;
    const timer = setTimeout(() => scrollToSlide(track.current, index + 1, count), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [index, paused, multi, count]);

  const go = (i: number) => scrollToSlide(track.current, i, count);

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        ref={track}
        data-mirage-track
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / el.clientWidth);
          if (next !== index) setIndex(next);
        }}
        className={cn(
          "flex",
          multi && "snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {slides.map((slide, i) => (
          <div key={i} data-mirage-slide inert={multi && i !== index} className="w-full shrink-0 snap-start snap-always">
            {slide}
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className={cn(wrapClassName, "pb-8 sm:pb-10 lg:pb-12")}>
          {multi && (
            <div className="pointer-events-auto mb-6 flex items-center gap-4 sm:gap-6">
              <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-primary-foreground/70">
                {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
              </span>
              <div className="flex max-w-md flex-1 gap-2">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`${i + 1} / ${count}`}
                    aria-current={i === index}
                    className="group flex-1 py-3"
                  >
                    <span className="block h-[3px] overflow-hidden rounded-full bg-primary-foreground/25 transition-colors group-hover:bg-primary-foreground/40">
                      {i < index && <span className="block h-full w-full bg-primary-foreground" />}
                      {i === index && (
                        <motion.span
                          key={`${index}-${paused}`}
                          className="block h-full bg-primary-foreground"
                          initial={{ width: paused ? "100%" : "0%" }}
                          animate={{ width: "100%" }}
                          transition={{ duration: paused ? 0 : AUTOPLAY_MS / 1000, ease: "linear" }}
                        />
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <div className="ml-auto flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  aria-label="←"
                  className="grid size-11 place-items-center rounded-full border border-primary-foreground/30 text-primary-foreground backdrop-blur-sm transition hover:bg-primary-foreground hover:text-primary"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => go(index + 1)}
                  aria-label="→"
                  className="grid size-11 place-items-center rounded-full border border-primary-foreground/30 text-primary-foreground backdrop-blur-sm transition hover:bg-primary-foreground hover:text-primary"
                >
                  <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          )}
          {footer && <div className="pointer-events-auto">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
