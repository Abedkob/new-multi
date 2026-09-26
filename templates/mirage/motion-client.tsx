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
      media.add(
        {
          animate: "(prefers-reduced-motion: no-preference)",
          desktop: "(min-width: 768px)",
        },
        (context) => {
        if (!context.conditions?.animate) return;
        const select = gsap.utils.selector(root);
        const visual = select("[data-mirage-visual]");
        const words = select("[data-mirage-word]");
        const details = select("[data-mirage-detail]");
        const content = select("[data-mirage-hero-content]");
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });

        intro.from(visual, { scale: 1.08, autoAlpha: 0.65, duration: 1.35 });
        intro.from(words, { y: 44, autoAlpha: 0, duration: 0.85 }, 0.12);
        intro.from(details, { y: 18, autoAlpha: 0, duration: 0.55, stagger: 0.08 }, 0.34);

        if (context.conditions.desktop) {
          const scroll = {
            trigger: root.current,
            start: "top top",
            end: "bottom top",
            scrub: 0.65,
          } as const;
          gsap.to(visual, { yPercent: 7, scale: 1.04, ease: "none", scrollTrigger: scroll });
          gsap.to(content, { yPercent: -6, autoAlpha: 0.55, ease: "none", scrollTrigger: scroll });
        }
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
      if (count < 1) return;
      const media = gsap.matchMedia();
      media.add(
        {
          animate: "(prefers-reduced-motion: no-preference)",
          desktop: "(min-width: 768px)",
        },
        (context) => {
          if (!context.conditions?.animate) return;
          const heading = root.current?.querySelector<HTMLElement>("[data-mirage-collection-heading]");
          const cards = gsap.utils.toArray<HTMLElement>("[data-mirage-collection]", root.current);
          const visuals = gsap.utils.toArray<HTMLElement>("[data-mirage-collection-visual]", root.current);
          if (cards.length < 1) return;
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: root.current,
              start: "top 80%",
              once: true,
            },
          });
          if (heading) timeline.from(heading, { y: 24, autoAlpha: 0, duration: 0.5, ease: "power2.out" });
          timeline.from(
            cards,
            {
              y: context.conditions.desktop ? 44 : 24,
              autoAlpha: 0,
              scale: context.conditions.desktop ? 0.975 : 1,
              duration: context.conditions.desktop ? 0.65 : 0.42,
              stagger: 0.07,
              ease: "power2.out",
            },
            heading ? "-=0.18" : 0,
          );
          timeline.from(visuals, { scale: 1.07, duration: 0.8, stagger: 0.07, ease: "power2.out" }, "<");
        },
        root,
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [count] },
  );

  return <div ref={root}>{children}</div>;
}

export function MirageProductsMotion({
  children,
  count,
  className,
}: {
  children: ReactNode;
  count: number;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (count < 1) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const heading = root.current?.querySelector<HTMLElement>("[data-mirage-product-heading]");
        const cards = gsap.utils.toArray<HTMLElement>("[data-mirage-product]", root.current);
        const timeline = gsap.timeline({
          scrollTrigger: { trigger: root.current, start: "top 84%", once: true },
        });
        if (heading) timeline.from(heading, { y: 20, autoAlpha: 0, duration: 0.45, ease: "power2.out" });
        if (cards.length > 0) {
          timeline.from(
            cards,
            {
              y: 18,
              scale: 0.985,
              autoAlpha: 0,
              duration: 0.38,
              stagger: { each: 0.045, from: "start", grid: "auto" },
              ease: "power1.out",
            },
            heading ? "-=0.12" : 0,
          );
        }
      });
      return () => media.revert();
    },
    { scope: root, dependencies: [count] },
  );

  return <div ref={root} className={className}>{children}</div>;
}

export function MirageFooterMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-footer-motion-item]", root.current);
        const bottom = root.current?.querySelector<HTMLElement>("[data-footer-motion-bottom]");
        const timeline = gsap.timeline({
          scrollTrigger: { trigger: root.current, start: "top 88%", once: true },
        });
        if (items.length > 0) {
          timeline.from(items, {
            y: 22,
            autoAlpha: 0,
            duration: 0.45,
            stagger: 0.06,
            ease: "power2.out",
          });
        }
        if (bottom) timeline.from(bottom, { autoAlpha: 0, duration: 0.35, ease: "power1.out" }, "-=0.12");
      });
      return () => media.revert();
    },
    { scope: root },
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
