"use client";

import { useRef } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** A horizontal product rail with always-visible circular arrow buttons (Pearl's rail look). */
export function CarouselClient({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLUListElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollTo = direction === "left" ? scrollLeft - clientWidth * 0.85 : scrollLeft + clientWidth * 0.85;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: "smooth" });
    }
  };

  return (
    <div className="relative">
      <motion.ul
        ref={scrollRef}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
        }}
        className="flex gap-5 overflow-x-auto pb-2 snap-x snap-mandatory sm:gap-8 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {children}
      </motion.ul>

      <button
        onClick={() => scroll("left")}
        className="absolute left-1 top-[38%] hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background sm:flex"
        aria-label="Scroll left"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        onClick={() => scroll("right")}
        className="absolute right-1 top-[38%] hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background sm:flex"
        aria-label="Scroll right"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
