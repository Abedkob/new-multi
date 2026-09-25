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
        const aperture = select("[data-mirage-aperture]");
        const words = select("[data-mirage-word]");
        const details = select("[data-mirage-detail]");
        const intro = gsap.timeline({ defaults: { ease: "expo.out" } });

        intro.from(aperture, { clipPath: "ellipse(8% 10% at 50% 50%)", scale: 1.12, duration: 1.45 });
        intro.from(words, { yPercent: 110, rotate: 3, duration: 1.05, stagger: 0.07 }, 0.12);
        intro.from(details, { y: 20, autoAlpha: 0, duration: 0.75, stagger: 0.08 }, 0.58);

        gsap.to(aperture, {
          clipPath: "ellipse(72% 78% at 50% 50%)",
          scale: 1.08,
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
          desktop: "(min-width: 1024px)",
          animate: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          if (!context.conditions?.desktop || !context.conditions.animate) return;
          const cards = gsap.utils.toArray<HTMLElement>("[data-mirage-collection]", root.current);
          if (cards.length < 2) return;

          gsap.set(cards.slice(1), { clipPath: "inset(100% 0 0 0)", yPercent: 8 });
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: root.current,
              start: "top top",
              end: `+=${(cards.length - 1) * 85}%`,
              pin: true,
              scrub: 0.75,
              anticipatePin: 1,
            },
          });

          cards.slice(1).forEach((card, index) => {
            timeline
              .to(cards[index], { scale: 0.9, autoAlpha: 0.35, duration: 1 }, index)
              .to(card, { clipPath: "inset(0% 0 0 0)", yPercent: 0, duration: 1 }, index);
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
        y: 48,
        autoAlpha: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: root.current, start: "top 88%", once: true },
      });
    },
    { scope: root },
  );
  return <div ref={root} className={className}>{children}</div>;
}
