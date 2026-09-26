"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** All content is readable before hydration. Context reversion also handles live previews. */
export function PrismMotion({ children, kind, revision = "", className }: {
  children: ReactNode;
  kind: "hero" | "collections" | "campaign" | "reveal";
  revision?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ animate: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 768px)" }, (context) => {
      if (!context.conditions?.animate) return;
      const select = gsap.utils.selector(root);
      const desktop = context.conditions.desktop;
      if (kind === "hero") {
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        intro.fromTo(select("[data-shutter]"), { scaleY: 1 }, { scaleY: 0, duration: 1.1, stagger: .07 });
        intro.fromTo(select("[data-prism-hero-visual]"), { scale: 1.14, xPercent: -3 }, { scale: 1, xPercent: 0, duration: 1.35 }, 0);
        const words = select("[data-word]");
        if (words.length) intro.from(words, { yPercent: 110, rotation: 4, duration: .9, stagger: .045 }, .25);
        intro.from(select("[data-hero-details]"), { y: 28, autoAlpha: 0, duration: .7 }, .55);
        if (desktop) {
          const scroll = { trigger: root.current, start: "top top", end: "bottom top", scrub: .6 };
          gsap.to(select("[data-frame]"), { scale: .84, rotation: -3, borderRadius: "2rem", ease: "none", scrollTrigger: scroll });
          gsap.to(select("[data-hero-title]"), { yPercent: -28, xPercent: 3, ease: "none", scrollTrigger: scroll });
        } else {
          const mobileScroll = { trigger: root.current, start: "top top", end: "bottom top", scrub: .45 };
          gsap.to(select("[data-prism-hero-visual]"), { yPercent: 10, scale: 1.06, ease: "none", scrollTrigger: mobileScroll });
          gsap.to(select("[data-hero-title]"), { yPercent: -18, autoAlpha: .35, ease: "none", scrollTrigger: mobileScroll });
          gsap.to(select("[data-hero-details]"), { yPercent: -9, autoAlpha: .55, ease: "none", scrollTrigger: mobileScroll });
        }
      } else if (kind === "collections") {
        const cards = select("[data-collection]") as HTMLElement[];
        if (desktop) cards.slice(0, -1).forEach((card, index) => {
          const face = card.querySelector("a");
          gsap.to(face, { scale: .9, rotationX: -5, opacity: .55, ease: "none", scrollTrigger: { trigger: cards[index + 1], start: "top 80%", end: "top 6rem", scrub: .5 } });
        });
        if (!desktop) cards.forEach((card) => {
          const face = card.querySelector("a");
          const visual = card.querySelector("[data-prism-collection-visual]");
          const label = card.querySelector("[data-prism-collection-label]");
          gsap.fromTo(face, { scale: .88, opacity: .55, yPercent: 7 }, { scale: 1, opacity: 1, yPercent: 0, ease: "none", scrollTrigger: { trigger: card, start: "top 88%", end: "top 28%", scrub: .55 } });
          if (visual) gsap.to(visual, { scale: 1.12, xPercent: -3, ease: "none", scrollTrigger: { trigger: card, start: "top bottom", end: "bottom top", scrub: .6 } });
          if (label) gsap.fromTo(label, { y: 26, opacity: .4 }, { y: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: card, start: "top 72%", end: "top 34%", scrub: .5 } });
        });
      } else if (kind === "campaign") {
        gsap.from(select("[data-campaign-image]"), { scale: desktop ? .78 : .95, clipPath: "inset(8% 12% round 2rem)", ease: "none", scrollTrigger: { trigger: root.current, start: "top 95%", end: "top 20%", scrub: .6 } });
      } else if (kind === "reveal") {
        gsap.from(select("[data-reveal]"), { y: 32, duration: .9, stagger: .08, ease: "power3.out", scrollTrigger: { trigger: root.current, start: "top 90%", once: true } });
      }
    });
    return () => media.revert();
  }, { scope: root, dependencies: [kind, revision], revertOnUpdate: true });
  return <div ref={root} className={className}>{children}</div>;
}

/** Tilt only the image surface, never its product name, price or click target. */
export function Depth({ children, className, collectionVisual = false, heroVisual = false, reveal = false }: { children: ReactNode; className?: string; collectionVisual?: boolean; heroVisual?: boolean; reveal?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)", () => {
      const element = root.current!;
      const surface = element.closest<HTMLElement>("[data-prism-hero], a") ?? element;
      const x = gsap.quickTo(element, "rotationY", { duration: .65, ease: "power3.out" });
      const y = gsap.quickTo(element, "rotationX", { duration: .65, ease: "power3.out" });
      gsap.set(element, { transformPerspective: 1000 });
      const move = (event: PointerEvent) => {
        const box = surface.getBoundingClientRect();
        x(((event.clientX - box.left) / box.width - .5) * 8);
        y(((event.clientY - box.top) / box.height - .5) * -8);
      };
      const reset = () => { x(0); y(0); };
      surface.addEventListener("pointermove", move);
      surface.addEventListener("pointerleave", reset);
      return () => { surface.removeEventListener("pointermove", move); surface.removeEventListener("pointerleave", reset); };
    });
    return () => media.revert();
  }, { scope: root });
  return <div ref={root} className={className} data-prism-collection-visual={collectionVisual ? "" : undefined} data-prism-hero-visual={heroVisual ? "" : undefined} data-reveal={reveal ? "" : undefined}>{children}</div>;
}
