"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * A generic scroll-in reveal for sections that don't have their own bespoke motion (unlike Hero,
 * the category filmstrip and the product stage). Fades/rises every `[data-reveal]` descendant,
 * staggered, the first time this section scrolls into view. Works identically on every device —
 * only gated by `prefers-reduced-motion`.
 */
export function KineticReveal({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const select = gsap.utils.selector(root);
        const targets = select("[data-reveal]");
        if (targets.length === 0) return;
        gsap.from(targets, {
          y: 28,
          duration: 0.8,
          stagger: 0.07,
          ease: "power3.out",
          scrollTrigger: { trigger: root.current, start: "top 88%", once: true },
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );
  return <div ref={root} className={className}>{children}</div>;
}
