"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The luxury category row: a horizontally scrolling list with round arrow buttons under it.
 * Each arrow fades out at its end of the row, and both disappear when everything already fits.
 */
export function OrbitScroller({
  children,
  className,
  variants,
  labels,
}: {
  children: React.ReactNode;
  className?: string;
  variants: Variants;
  labels: { previous: string; next: string };
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };

  const arrow =
    "grid size-12 place-items-center rounded-full border border-border bg-background transition duration-500 hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-30";

  return (
    <>
      <div className="relative">
        {/* The orbit line the categories sit along. */}
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <motion.ul
          ref={ref}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.05 }}
          variants={variants}
          className={cn("relative", className)}
        >
          {children}
        </motion.ul>
      </div>
      <div className={cn("mt-10 flex items-center justify-center gap-6", edges.start && edges.end && "hidden")}>
        <button type="button" aria-label={labels.previous} disabled={edges.start} onClick={() => scroll(-1)} className={arrow}>
          <ArrowLeft className="size-4" />
        </button>
        <span aria-hidden className="text-accent">
          &#10022;
        </span>
        <button type="button" aria-label={labels.next} disabled={edges.end} onClick={() => scroll(1)} className={arrow}>
          <ArrowRight className="size-4" />
        </button>
      </div>
    </>
  );
}
