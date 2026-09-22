"use client";

import { useRef } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CarouselClient({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLUListElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollTo = direction === "left" ? scrollLeft - clientWidth / 2 : scrollLeft + clientWidth / 2;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: "smooth" });
    }
  };

  return (
    <div className="relative group">
      <motion.ul
        ref={scrollRef}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
        }}
        className="flex gap-6 overflow-x-auto pb-8 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {children}
      </motion.ul>
      
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-1/2 -translate-y-1/2 -ml-4 flex h-12 w-12 items-center justify-center rounded-full bg-background/80 shadow-md backdrop-blur-sm border border-border opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-0"
        aria-label="Scroll left"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 -mr-4 flex h-12 w-12 items-center justify-center rounded-full bg-background/80 shadow-md backdrop-blur-sm border border-border opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-0"
        aria-label="Scroll right"
      >
        <ChevronRight className="h-6 w-6" />
      </button>
    </div>
  );
}
