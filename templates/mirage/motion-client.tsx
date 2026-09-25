"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function MirageHeroMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const select = gsap.utils.selector(root);
        const visual = select("[data-mirage-visual]");
        const words = select("[data-mirage-word]");
        const details = select("[data-mirage-detail]");
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });

        intro.from(visual, { scale: 1.1, duration: 1.6 });
        intro.from(words, { y: 48, autoAlpha: 0, duration: 0.9 }, 0.16);
        intro.from(details, { y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1 }, 0.38);

        gsap.to(visual, {
          yPercent: 8,
          scale: 1.05,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom top",
            scrub: 0.8,
          },
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );

  return <div ref={root}>{children}</div>;
}

export function MirageCollectionMotion({ children, count }: { children: ReactNode; count: number }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (count < 2) return;
      const media = gsap.matchMedia();
      media.add(
        {
          animate: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          if (!context.conditions?.animate) return;
          const cards = gsap.utils.toArray<HTMLElement>("[data-mirage-collection]", root.current);
          if (cards.length < 2) return;
          gsap.from(cards, {
            y: 56,
            autoAlpha: 0,
            duration: 0.85,
            stagger: 0.12,
            ease: "power3.out",
            scrollTrigger: {
              trigger: root.current,
              start: "top 78%",
              once: true,
            },
          });
        },
        root,
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [count] },
  );

  return <div ref={root}>{children}</div>;
}

export function MirageReveal({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(root.current, {
        y: 32,
        autoAlpha: 0,
        duration: 0.75,
        ease: "power3.out",
        scrollTrigger: { trigger: root.current, start: "top 88%", once: true },
      });
    },
    { scope: root },
  );
  return <div ref={root} className={className}>{children}</div>;
}
