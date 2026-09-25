"use client";

import { useRef } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowUpRight } from "lucide-react";
import { Picture } from "../shared";
import type { CategoryTile } from "../types";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** Native vertical cards on small screens; one pinned horizontal filmstrip on desktop. */
export function CategoryFilm({
  heading,
  categories,
}: {
  heading: string;
  categories: CategoryTile[];
}) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLUListElement>(null);

  useGSAP(
    () => {
      if (categories.length < 2) return;
      const media = gsap.matchMedia();
      media.add(
        {
          desktop: "(min-width: 1024px)",
          animate: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          if (!context.conditions?.desktop || !context.conditions.animate || !track.current) return;

          const distance = () => Math.max(0, track.current!.scrollWidth - window.innerWidth + 48);
          const tween = gsap.to(track.current, {
            x: () => -distance(),
            ease: "none",
            scrollTrigger: {
              trigger: root.current,
              start: "top top",
              end: () => `+=${distance()}`,
              pin: true,
              scrub: 0.75,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
          });

          const observer = new ResizeObserver(() => ScrollTrigger.refresh());
          observer.observe(track.current);
          return () => {
            observer.disconnect();
            tween.kill();
          };
        },
        root,
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [categories.length] },
  );

  return (
    <section ref={root} className="overflow-hidden bg-primary text-primary-foreground">
      <div className="px-5 py-16 sm:px-8 lg:flex lg:h-screen lg:min-h-[44rem] lg:flex-col lg:justify-center lg:px-12 lg:py-10">
        <div className="mb-10 lg:mb-8">
          <h2 className="max-w-5xl text-[clamp(2.4rem,6vw,6.5rem)] font-black leading-[0.88] tracking-[-0.055em] text-balance [overflow-wrap:anywhere]">
            {heading}
          </h2>
        </div>

        <ul ref={track} className="grid gap-5 lg:flex lg:w-max lg:gap-6">
          {categories.map((category, index) => (
            <li key={category.id} className="lg:w-[min(72vw,62rem)] lg:shrink-0">
              <Link
                href={category.href}
                className="group relative grid min-h-[28rem] overflow-hidden border border-primary-foreground/20 sm:min-h-[34rem] lg:h-[58vh] lg:min-h-[28rem] lg:grid-cols-[minmax(0,1fr)_20rem]"
              >
                <Picture
                  src={category.image}
                  alt={category.label}
                  className="absolute inset-0 lg:relative"
                  imgClassName="transition-transform duration-700 group-hover:scale-[1.035]"
                  sizes="(max-width: 1024px) 100vw, 65vw"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-primary via-primary/15 to-transparent lg:hidden" />
                <span className="relative mt-auto flex items-end justify-between gap-6 p-6 sm:p-8 lg:mt-0 lg:flex-col lg:items-start lg:bg-primary lg:p-8">
                  <span className="text-sm tabular-nums text-primary-foreground/60">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="max-w-full text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.88] tracking-[-0.055em] text-balance [overflow-wrap:anywhere] lg:text-[clamp(2rem,3.4vw,4rem)]">
                    {category.label}
                  </span>
                  <ArrowUpRight className="size-6 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
