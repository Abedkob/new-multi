"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * The template's one page-load composition. The HTML stays visible and useful before
 * hydration; GSAP only adds a scoped enhancement and fully reverts it on navigation.
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          animate: "(prefers-reduced-motion: no-preference)",
          desktop: "(min-width: 1024px)",
        },
        (context) => {
          if (!context.conditions?.animate) return;

          const select = gsap.utils.selector(root);
          const mediaTargets = select("[data-kinetic-media]");
          const wordTargets = select("[data-kinetic-word]");
          const detailTargets = select("[data-kinetic-detail]");
          const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });

          if (mediaTargets.length > 0) {
            timeline.from(mediaTargets, { scale: 1.08, duration: 1.4 });
          }
          if (wordTargets.length > 0) {
            timeline.from(
              wordTargets,
              { yPercent: 115, rotate: 3, duration: 0.9, stagger: 0.055 },
              0.12,
            );
          }
          if (detailTargets.length > 0) {
            timeline.from(
              detailTargets,
              { y: 24, autoAlpha: 0, duration: 0.75, stagger: 0.09 },
              0.52,
            );
          }

          if (context.conditions.desktop && mediaTargets.length > 0) {
            gsap.to(mediaTargets, {
              yPercent: 12,
              ease: "none",
              scrollTrigger: {
                trigger: root.current,
                start: "top top",
                end: "bottom top",
                scrub: 0.8,
              },
            });
          }
        },
        root,
      );

      return () => media.revert();
    },
    { scope: root },
  );

  return <div ref={root}>{children}</div>;
}
