"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Picture } from "../shared";
import type { StoreInfo } from "../types";

export type HeroSlideContent = {
  headline: string;
  subtext: string;
  ctaLabel: string;
  image: string;
  imageMobile: string;
};

const AUTOPLAY_MS = 6000;

/** Same desktop/mobile picture-swap HeroPicture does, but for an explicit slide's src pair. */
function SlideImage({ desktop, mobile, alt }: { desktop: string; mobile: string; alt: string }) {
  return (
    <>
      {mobile && (
        <Picture src={mobile} alt={alt} sizes="100vw" className={cn("h-full w-full", desktop && "sm:hidden")} />
      )}
      {desktop && (
        <Picture src={desktop} alt={alt} sizes="100vw" className={cn("h-full w-full", mobile && "hidden sm:block")} />
      )}
    </>
  );
}

/**
 * Tonkic's hero, unchanged when there's a single slide (the common case): image and text side
 * by side, no card, no scrim. With 2-5 slides (filled in under Hero in the content editor) it
 * becomes an autoplaying slider that also flips which side the photo is on each slide, HP-style.
 */
export function HeroSlider({
  store,
  slides,
  showText,
  wrapClassName,
  ctaClassName,
  newArrivalsHref,
}: {
  store: StoreInfo;
  slides: HeroSlideContent[];
  showText: boolean;
  wrapClassName: string;
  ctaClassName: string;
  newArrivalsHref: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const multi = slides.length > 1;

  useEffect(() => {
    if (!multi || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [multi, paused, slides.length]);

  const slide = slides[index];
  if (!slide) return null;
  const hasImage = Boolean(slide.image || slide.imageMobile);
  // Even slides: text left, image right (like slide 1 above). Odd slides: flipped.
  const imageFirst = index % 2 === 1;

  return (
    <section
      className="relative overflow-hidden bg-background"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className={cn(
            wrapClassName,
            "grid items-center gap-10 py-16 md:py-24",
            hasImage && showText && "lg:grid-cols-2 lg:gap-16",
          )}
        >
          {showText && (
            <div className={cn(imageFirst ? "lg:order-2" : "lg:order-1", !hasImage && "mx-auto max-w-2xl text-center")}>
              <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-foreground sm:text-6xl md:text-[4rem]">
                {slide.headline}
              </h1>
              {slide.subtext && (
                <p
                  className={cn(
                    "mt-6 max-w-md whitespace-pre-line text-base leading-relaxed text-muted-foreground sm:text-lg",
                    !hasImage && "mx-auto",
                  )}
                >
                  {slide.subtext}
                </p>
              )}
              {slide.ctaLabel && (
                <div className="mt-9">
                  <Link href={newArrivalsHref} className={ctaClassName}>
                    {slide.ctaLabel} <ArrowRight className="ml-2 w-4 h-4 inline" />
                  </Link>
                </div>
              )}
            </div>
          )}

          {hasImage && (
            <div className={cn("relative", imageFirst ? "lg:order-1" : "lg:order-2", !showText && "mx-auto max-w-3xl")}>
              <div className="relative aspect-square sm:aspect-[4/5] lg:aspect-square">
                <SlideImage desktop={slide.image} mobile={slide.imageMobile} alt={store.name} />
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {multi && (
        <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center">
          <div className="flex items-center gap-1 rounded-full bg-background/90 p-1.5 shadow-lg ring-1 ring-border/50 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
              aria-label="Previous slide"
              className="flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex items-center gap-1.5 px-1">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show slide ${i + 1}`}
                  aria-current={i === index}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === index ? "w-6 bg-foreground" : "w-1.5 bg-foreground/30 hover:bg-foreground/60",
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % slides.length)}
              aria-label="Next slide"
              className="flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
