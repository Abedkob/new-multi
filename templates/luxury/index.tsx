import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Variants } from "motion/react";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionUl } from "../motion";
import { StoreFooter } from "../store-footer";
import {
  HeroPicture,
  Picture,
  StoreBrand,
  StoreMenuButton,
  cardPrice,
  productHref,
  sectionHref,
  shopHref,
  storeHref,
} from "../shared";
import { CartLink, SearchBox } from "../nav-client";
import { AddToCart, ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker } from "../product-client";
import type { SectionComponent, StoreInfo, StoreProduct, Template } from "../types";
import { OrbitScroller } from "./orbit-scroller-client";

/**
 * "Luxury": celestial couture. Deep-space bands (the theme's primary colour) scattered with
 * twinkling stars, a planet-like hero wrapped in slowly turning orbits, categories set like
 * planets along an ecliptic, Roman-numeral rankings, an eclipse promo and a planet rising out
 * of the footer. Light serif type and wide letter-spacing keep it quiet and expensive.
 * Every colour is a theme token (primary / accent / background ...), never a literal.
 */

const wrap = "mx-auto max-w-7xl px-5 sm:px-8";
const eyebrow = "text-[10px] font-medium uppercase tracking-[0.4em]";
const serif = "font-serif font-light tracking-tight";
const capsule =
  "group inline-flex h-14 items-center justify-center gap-3 rounded-full border px-10 text-[11px] font-medium uppercase tracking-[0.3em] transition-colors duration-500";

/**
 * "Luxury"'s animation language: things surface slowly from depth (a long, soft scale-up),
 * while orbits turn and stars twinkle in the background — unhurried, never snappy.
 */
const ease = [0.16, 1, 0.3, 1] as const;
const emerge: Variants = {
  hidden: { opacity: 0, scale: 0.92, y: 24 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 1.3, ease } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.14, delayChildren: 0.1 } },
};
// A tiny threshold: a long product grid on a phone can be several screens tall, so "25% in
// view" would never be reached and the grid would stay invisible until scrolled far enough.
const viewport = { once: true, amount: 0.05 } as const;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const roman = (n: number) => ROMAN[n - 1] ?? String(n);

// A fixed, seeded star map: identical on every render, so server and client HTML always match.
const STARS = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 70 }, () => ({
    left: rnd() * 100,
    top: rnd() * 100,
    size: rnd() < 0.85 ? 1 : 2,
    accent: rnd() < 0.2,
    delay: rnd() * 4,
    duration: 2.5 + rnd() * 3,
  }));
})();

/**
 * A twinkling starfield that fills its (relatively positioned) parent. "dark" is for the
 * primary-coloured bands; "light" is a faint dusting for pale backgrounds.
 */
function Stars({
  count = STARS.length,
  tone = "dark",
  className,
}: {
  count?: number;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {STARS.slice(0, count).map((s, i) => (
        <span
          key={i}
          className={cn(
            "absolute animate-pulse rounded-full",
            tone === "dark"
              ? s.accent
                ? "bg-accent"
                : "bg-primary-foreground/70"
              : s.accent
                ? "bg-accent/60"
                : "bg-foreground/15",
          )}
          style={
            {
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`,
            } satisfies CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** A slowly turning orbit ring with a small moon riding on it. */
function Orbit({ className, duration, reverse = false }: { className: string; duration: number; reverse?: boolean }) {
  return (
    <MotionDiv
      aria-hidden
      animate={{ rotate: reverse ? -360 : 360 }}
      transition={{ duration, ease: "linear", repeat: Infinity }}
      className={cn("pointer-events-none absolute rounded-full border border-current opacity-20", className)}
    >
      <span className="absolute left-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_2px_var(--accent)]" />
    </MotionDiv>
  );
}

/** Three stars joined by hairlines: the small mark over every section title. */
function Constellation({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 84 18" className={cn("h-4 w-20 text-accent", className)}>
      <polyline points="4,12 28,4 54,14 80,6" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
      {[
        [4, 12],
        [28, 4],
        [54, 14],
        [80, 6],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 1 ? 2 : 1.4} fill="currentColor" />
      ))}
    </svg>
  );
}

function Heading({ title, sub, className }: { title: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-16 flex flex-col items-center text-center lg:mb-20", className)}>
      <Constellation />
      <h2 className={cn(serif, "mt-6 text-4xl text-balance sm:text-5xl lg:text-6xl")}>{title}</h2>
      {sub}
    </div>
  );
}

const Announcement: SectionComponent = ({ data }) => (
  <div className={cn(eyebrow, "relative overflow-hidden bg-primary px-6 py-3 text-center text-primary-foreground")}>
    <Stars count={18} />
    <p className="relative flex items-center justify-center gap-4">
      <span aria-hidden className="text-accent">&#10022;</span>
      <span className="truncate">{data.content["announcement.text"]}</span>
      <span aria-hidden className="text-accent">&#10022;</span>
    </p>
  </div>
);

const navLink = "text-[11px] uppercase tracking-[0.25em] transition-colors hover:text-accent";

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="relative border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className={cn(wrap, "grid h-20 grid-cols-[1fr_auto_1fr] items-center gap-4 lg:h-24")}>
        <nav className="flex items-center gap-7">
          <StoreMenuButton data={data} className="-ml-2" />
          <Link href={shopHref(store)} className={cn(navLink, "hidden lg:inline")}>
            {content["navbar.shopLabel"]}
          </Link>
          {categoryTiles.slice(0, 2).map((c) => (
            <Link key={c.id} href={c.href} className={cn(navLink, "hidden xl:inline")}>
              {c.label}
            </Link>
          ))}
          {pages.slice(0, 1).map((pg) => (
            <Link key={pg.slug} href={pg.href} className={cn(navLink, "hidden xl:inline")}>
              {pg.label}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col items-center">
          <StoreBrand
            store={store}
            content={content}
            className={cn(serif, "block max-w-[50vw] truncate text-2xl lg:text-3xl")}
            logoClassName="mx-auto h-8 lg:h-10"
          />
          {/* A tiny orbit under the name. */}
          <span aria-hidden className="relative mt-1.5 hidden h-px w-16 bg-border sm:block">
            <span className="absolute -top-[2px] left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-accent" />
          </span>
        </div>

        <div className="flex items-center justify-end gap-6">
          <SearchBox
            slug={store.slug}
            basePath={store.basePath}
            placeholder={content["search.placeholder"]}
            buttonLabel={content["search.button"]}
            className="hidden md:flex"
            inputClassName="h-9 w-36 rounded-full border-border bg-transparent px-4 text-xs tracking-wide placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-0 lg:w-48"
            buttonClassName="sr-only"
          />
          <CartLink basePath={store.basePath} className="text-xs tracking-widest transition-colors hover:text-accent" />
        </div>
      </div>
    </header>
  );
};

/**
 * A planet on a pale sky: the hero photo (or a softly lit sphere) in a circle with fine orbits
 * turning around it, and the headline set beside it on the page background.
 */
const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);
  const showText = visibility.heroText;
  return (
    <section className="relative isolate overflow-hidden bg-background">
      <Stars tone="light" count={40} />
      <div
        className={cn(
          wrap,
          "relative grid min-h-[80vh] items-center gap-16 py-20 lg:min-h-[88vh] lg:gap-10 lg:py-24",
          showText && "lg:grid-cols-2",
        )}
      >
        {showText && (
          <MotionDiv
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="order-2 flex flex-col items-center text-center lg:order-1 lg:items-start lg:text-left"
          >
            <MotionP variants={emerge} className={cn(eyebrow, "flex items-center gap-3 text-muted-foreground")}>
              <span aria-hidden className="text-accent">&#10022;</span>
              {store.name}
            </MotionP>
            <MotionH1 variants={emerge} className={cn(serif, "mt-6 max-w-xl text-5xl leading-[1.04] text-balance sm:text-6xl xl:text-7xl")}>
              {content["hero.headline"]}
            </MotionH1>
            {content["hero.subtext"] && (
              <MotionP variants={emerge} className="mt-6 max-w-md whitespace-pre-line text-base font-light leading-relaxed text-muted-foreground sm:text-lg">
                {content["hero.subtext"]}
              </MotionP>
            )}
            {content["hero.ctaLabel"] && (
              <MotionDiv variants={emerge} className="mt-10">
                <Link
                  href={sectionHref(store, "new-arrivals")}
                  className={cn(capsule, "border-foreground/25 hover:border-foreground hover:bg-foreground hover:text-background")}
                >
                  {content["hero.ctaLabel"]}
                  <span aria-hidden className="text-accent transition-transform duration-700 group-hover:rotate-180">
                    &#10022;
                  </span>
                </Link>
              </MotionDiv>
            )}
          </MotionDiv>
        )}

        {/* The planet */}
        <MotionDiv
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease }}
          className={cn(
            "relative mx-auto aspect-square w-[72vw] text-foreground",
            showText ? "order-1 max-w-[28rem] lg:order-2" : "max-w-[34rem]",
          )}
        >
          <Orbit className="-inset-[9%]" duration={60} />
          <Orbit className="-inset-[20%] hidden sm:block" duration={95} reverse />
          <div className="absolute inset-0 overflow-hidden rounded-full bg-secondary shadow-[0_30px_80px_-40px_var(--accent)]">
            {hasImage ? (
              <HeroPicture content={content} alt={store.name} className="absolute inset-0" />
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle at 32% 28%, color-mix(in oklab, var(--accent) 45%, var(--background)), var(--secondary) 70%)",
                }}
              />
            )}
          </div>
        </MotionDiv>
      </div>
    </section>
  );
};

/** Categories as planets strung along an orbit line, alternately above and below it. */
const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className="overflow-hidden py-24 lg:py-36">
    <div className={wrap}>
      <Heading title={content["featuredCategories.heading"]} />
    </div>
    <OrbitScroller
      variants={stagger}
      labels={{ previous: content["catalog.previous"], next: content["catalog.next"] }}
      className={cn(
        wrap,
        "flex snap-x snap-mandatory gap-8 overflow-x-auto pb-6 [scrollbar-width:none] sm:gap-12 [&::-webkit-scrollbar]:hidden",
        categoryTiles.length <= 4 && "lg:justify-center",
      )}
    >
        {categoryTiles.map((c, i) => (
          <MotionLi
            key={c.id}
            variants={emerge}
            className={cn("w-40 shrink-0 snap-center sm:w-52 lg:w-60", i % 2 === 1 ? "pt-24 lg:pt-32" : "pb-24 lg:pb-32")}
          >
            <Link href={c.href} className="group flex flex-col items-center text-center">
              <div className="relative w-full">
                <div className="absolute -inset-3 rounded-full border border-accent/0 transition-all duration-700 group-hover:-inset-5 group-hover:border-accent/60" />
                <div className="relative aspect-square overflow-hidden rounded-full bg-secondary ring-1 ring-border">
                  <Picture
                    src={c.image}
                    alt={c.label}
                    className="absolute inset-0"
                    imgClassName="transition-transform duration-[1.5s] ease-out group-hover:scale-110"
                    sizes="240px"
                  />
                </div>
              </div>
              <span className={cn(eyebrow, "mt-6 text-muted-foreground")}>{roman(i + 1)}</span>
              <h3 className={cn(serif, "mt-2 text-xl sm:text-2xl")}>{c.label}</h3>
              <span className={cn(eyebrow, "mt-3 text-accent opacity-0 transition-opacity duration-500 group-hover:opacity-100")}>
                {content["featuredCategories.tileCta"]}
              </span>
            </Link>
          </MotionLi>
        ))}
    </OrbitScroller>
  </section>
);

/** A tall frame; on hover a fine inner border and a star appear, like a viewfinder locking on. */
function ProductCard({ store, product, content }: { store: StoreInfo; product: StoreProduct; content: ContentMap }) {
  const second = product.images.find((im) => im.url && im.url !== product.imageUrl)?.url ?? "";
  return (
    <Link href={productHref(store, product)} className="group flex h-full flex-col">
      <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="absolute inset-0"
          imgClassName={cn("object-contain transition duration-[1.4s] ease-out group-hover:scale-105", second && "group-hover:opacity-0")}
        />
        {second && (
          <Picture
            src={second}
            alt=""
            className="absolute inset-0 opacity-0 transition-opacity duration-1000 group-hover:opacity-100"
            imgClassName="object-contain"
          />
        )}
        <div className="pointer-events-none absolute inset-3 border border-background/0 transition-colors duration-700 group-hover:border-background/70" />
        <span aria-hidden className="absolute right-5 top-4 text-background opacity-0 transition duration-700 group-hover:rotate-90 group-hover:opacity-100">
          &#10022;
        </span>
        {!product.inStock && (
          <span className={cn(eyebrow, "absolute inset-x-0 bottom-0 bg-background/85 py-3 text-center backdrop-blur")}>
            {content["product.outOfStock"]}
          </span>
        )}
      </div>
      <div className="mt-6 flex flex-1 flex-col justify-between text-center">
        <h3 className={cn(serif, "line-clamp-1 text-lg leading-snug sm:text-xl")}>{product.name}</h3>
        <p className="mt-2 flex items-center justify-center gap-3 text-sm font-light tracking-wide text-muted-foreground">
          <span aria-hidden className="h-px w-4 bg-accent" />
          {cardPrice(product, content)}
          <span aria-hidden className="h-px w-4 bg-accent" />
        </p>
      </div>
    </Link>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-24 lg:py-36")}>
    <Heading title={content["newArrivals.heading"]} />
    {newArrivals.length === 0 ? (
      <p className="text-center font-light text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        // Every other column sits lower, so the row drifts like bodies on different orbits.
        className="grid grid-cols-2 gap-x-5 gap-y-14 sm:gap-x-8 lg:grid-cols-4 lg:pb-20"
      >
        {newArrivals.map((p, i) => (
          <MotionLi key={p.id} variants={emerge} className={cn(i % 2 === 1 && "mt-12 lg:mt-20")}>
            <ProductCard store={store} product={p} content={content} />
          </MotionLi>
        ))}
      </MotionUl>
    )}
  </section>
);

/** The number-one piece shown large, the rest in round portholes numbered II, III, IV. */
const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => {
  const [lead, ...rest] = bestSellers;
  return (
    <section className="relative isolate overflow-hidden border-y border-border/60 bg-secondary/40">
      <div className={cn(wrap, "relative py-24 lg:py-36")}>
        <Heading title={content["bestSellers.heading"]} />
        {!lead ? (
          <p className="text-center font-light text-muted-foreground">{content["bestSellers.empty"]}</p>
        ) : (
          <MotionDiv
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={stagger}
            className={cn("grid items-center gap-16", rest.length > 0 && "lg:grid-cols-2 lg:gap-20")}
          >
            <MotionDiv variants={emerge} className={cn(rest.length === 0 && "mx-auto w-full max-w-md")}>
              <Link href={productHref(store, lead)} className="group block">
                <div className="relative">
                  <span aria-hidden className={cn(serif, "absolute -left-2 -top-10 z-10 text-8xl italic text-accent lg:-left-8 lg:text-9xl")}>
                    I
                  </span>
                  <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
                    <Picture
                      src={lead.imageUrl}
                      alt={lead.name}
                      className="absolute inset-0"
                      imgClassName="object-contain transition-transform duration-[1.5s] ease-out group-hover:scale-105"
                      sizes="(max-width: 1024px) 100vw, 50vw"
                    />
                  </div>
                </div>
                <div className="mt-8 flex items-baseline justify-between gap-6 border-b border-border pb-5">
                  <h3 className={cn(serif, "text-2xl sm:text-3xl")}>{lead.name}</h3>
                  <span className="shrink-0 text-sm font-light tracking-wide text-muted-foreground">{cardPrice(lead, content)}</span>
                </div>
              </Link>
            </MotionDiv>

            {rest.length > 0 && (
              <ul className="grid grid-cols-2 gap-x-6 gap-y-12 sm:gap-x-10">
                {rest.map((p, i) => (
                  <MotionLi key={p.id} variants={emerge}>
                    <Link href={productHref(store, p)} className="group flex flex-col items-center text-center">
                      <span className={cn(serif, "mb-3 text-2xl italic text-accent")}>{roman(i + 2)}</span>
                      <div className="relative aspect-square w-full max-w-52 overflow-hidden rounded-full bg-secondary ring-1 ring-border transition duration-700 group-hover:ring-accent">
                        <Picture src={p.imageUrl} alt={p.name} className="absolute inset-0" sizes="210px" imgClassName="object-contain transition-transform duration-[1.5s] group-hover:scale-110" />
                      </div>
                      <h3 className={cn(serif, "line-clamp-1 mt-5 text-lg leading-snug")}>{p.name}</h3>
                      <span className="mt-1 text-xs font-light tracking-widest text-muted-foreground">{cardPrice(p, content)}</span>
                    </Link>
                  </MotionLi>
                ))}
              </ul>
            )}
          </MotionDiv>
        )}
      </div>
    </section>
  );
};

/** An eclipse: the offer inside a dark disc, its corona glowing in the accent colour. */
const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  return (
    <section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
      {image && (
        <>
          <Picture src={image} alt={content["promoBanner.heading"]} className="absolute inset-0 -z-10" sizes="100vw" />
          <div className="absolute inset-0 -z-10 bg-primary/70" />
        </>
      )}
      <Stars count={40} />
      <div className="relative flex min-h-[90vh] items-center justify-center px-5 py-24">
        <MotionDiv
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="relative flex w-full max-w-[40rem] flex-col items-center justify-center rounded-[2.5rem] bg-primary px-8 py-14 text-center sm:aspect-square sm:rounded-full shadow-[0_0_0_1px_var(--accent),0_0_80px_10px_color-mix(in_oklab,var(--accent)_55%,transparent),0_0_220px_40px_color-mix(in_oklab,var(--accent)_25%,transparent)] sm:p-16"
        >
          <MotionP variants={emerge} className={cn(eyebrow, "text-accent")}>
            &#10022;
          </MotionP>
          <MotionH2 variants={emerge} className={cn(serif, "mt-4 text-4xl leading-[1.05] text-balance sm:text-6xl")}>
            {content["promoBanner.heading"]}
          </MotionH2>
          {content["promoBanner.subtext"] && (
            <MotionP variants={emerge} className="mt-6 max-w-sm whitespace-pre-line text-sm font-light leading-relaxed opacity-75 sm:text-base">
              {content["promoBanner.subtext"]}
            </MotionP>
          )}
          {content["promoBanner.ctaLabel"] && (
            <MotionDiv variants={emerge} className="mt-8">
              <Link
                href={sectionHref(store, "new-arrivals")}
                className={cn(capsule, "h-12 border-accent px-8 hover:bg-accent hover:text-accent-foreground")}
              >
                {content["promoBanner.ctaLabel"]}
              </Link>
            </MotionDiv>
          )}
        </MotionDiv>
      </div>
    </section>
  );
};

/** A tall portrait with an orbit ring slung across its corner, beside quiet serif text. */
const BrandStory: SectionComponent = ({ data: { store, content, pages } }) => {
  const image = content["brandStory.image"];
  const about = pages.find((pg) => pg.slug === "about");
  return (
    <section className={cn(wrap, "overflow-hidden py-24 lg:py-36")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn("grid items-center gap-16 lg:gap-24", image ? "lg:grid-cols-2" : "mx-auto max-w-3xl text-center")}
      >
        {image && (
          <MotionDiv variants={emerge} className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
              <Picture src={image} alt={store.name} className="absolute inset-0" sizes="(max-width: 1024px) 100vw, 50vw" />
            </div>
            <div aria-hidden className="absolute -bottom-16 -right-10 size-56 text-accent sm:-right-16 sm:size-72">
              <Orbit className="inset-0 opacity-60" duration={50} />
            </div>
          </MotionDiv>
        )}
        <div className={cn(!image && "flex flex-col items-center")}>
          <MotionP variants={emerge} className={cn(eyebrow, "flex items-center gap-3 text-muted-foreground")}>
            <span aria-hidden className="text-accent">&#10022;</span>
            {store.name}
          </MotionP>
          {content["brandStory.heading"] && (
            <MotionH2 variants={emerge} className={cn(serif, "mt-6 text-4xl leading-[1.1] text-balance sm:text-5xl lg:text-6xl")}>
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          <MotionDiv variants={emerge} aria-hidden className="relative my-8 h-px w-24 bg-border">
            <span className="absolute -top-[3px] left-0 size-[7px] rounded-full bg-accent" />
          </MotionDiv>
          {content["brandStory.body"] && (
            <MotionP variants={emerge} className="whitespace-pre-line text-lg font-light leading-loose text-muted-foreground">
              {content["brandStory.body"]}
            </MotionP>
          )}
          {about && (
            <MotionDiv variants={emerge} className="mt-10">
              <Link href={about.href} className={cn(capsule, "h-12 border-foreground/30 px-8 hover:border-foreground hover:bg-foreground hover:text-background")}>
                {about.label}
              </Link>
            </MotionDiv>
          )}
        </div>
      </MotionDiv>
    </section>
  );
};

// Fixed classes (Tailwind needs to see them whole): how far each hanging star drops.
const DROP = ["md:pt-0", "md:pt-24", "md:pt-10", "md:pt-32", "md:pt-4", "md:pt-20"];

/** Quotes hanging like stars on threads of different lengths from one hairline. */
const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="border-t border-border">
    <div className={cn(wrap, "py-24 lg:py-36")}>
      <Heading title={content["reviews.heading"]} />
      <div className="relative">
        <div aria-hidden className="absolute inset-x-0 top-0 hidden h-px bg-border md:block" />
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className={cn("grid gap-16 md:gap-10", reviews.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}
        >
          {reviews.slice(0, 6).map((r, i) => (
            <MotionLi key={i} variants={emerge} className={cn("relative flex flex-col items-center text-center", DROP[i % DROP.length])}>
              <span aria-hidden className="absolute left-1/2 top-0 hidden h-full w-px bg-gradient-to-b from-border to-transparent md:block" />
              <span aria-hidden className="relative mb-6 grid size-10 place-items-center rounded-full bg-background text-lg text-accent">
                &#10022;
              </span>
              <blockquote className={cn(serif, "relative bg-background text-xl italic leading-relaxed sm:text-2xl")}>
                &ldquo;{r.quote}&rdquo;
              </blockquote>
              {r.author && <p className={cn(eyebrow, "relative mt-6 bg-background text-muted-foreground")}>{r.author}</p>}
            </MotionLi>
          ))}
        </MotionUl>
      </div>
    </div>
  </section>
);

const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="luxury" />;

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-12 lg:py-20")}>
        <Link href={storeHref(store)} className={cn(eyebrow, "inline-flex items-center gap-3 text-muted-foreground transition-colors hover:text-accent")}>
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-10 grid gap-14 lg:mt-14 lg:grid-cols-12 lg:gap-20">
          <div className="lg:col-span-7">
            <div className="relative bg-secondary shadow-[0_40px_120px_-60px_var(--accent)]">
              <ProductImage className="aspect-[4/5]" />
            </div>
            <ProductGallery className="mt-5 gap-3 [&_button]:rounded-full" />
          </div>

          <div className="lg:sticky lg:top-32 lg:col-span-5 lg:self-start">
            <p className={cn(eyebrow, "flex items-center gap-3 text-muted-foreground")}>
              <span aria-hidden className="text-accent">&#10022;</span>
              {store.name}
            </p>
            <h1 className={cn(serif, "mt-5 text-4xl leading-[1.08] text-balance sm:text-5xl")}>{product.name}</h1>
            <p className="mt-5 text-xl font-light tracking-wide text-muted-foreground">
              <ProductPrice />
            </p>

            <div aria-hidden className="relative my-10 h-px bg-border">
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-accent">&#10022;</span>
            </div>

            <div className="space-y-8">
              <VariantPicker look="luxury" labelClassName={cn(eyebrow, "mb-3 block font-medium")} />
              <StockStatus look="dot" className="block text-sm font-light" />
              <AddToCart look="luxury" basePath={store.basePath} />
            </div>

            {product.description && (
              <div className="mt-14 border-t border-border pt-8">
                <h2 className={cn(eyebrow, "mb-5")}>{content["product.descriptionHeading"]}</h2>
                <p className="whitespace-pre-line text-sm font-light leading-loose text-muted-foreground">{product.description}</p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-32 border-t border-border pt-24 lg:mt-40">
            <Heading title={content["product.relatedHeading"]} />
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid grid-cols-2 gap-x-5 gap-y-14 sm:gap-x-8 lg:grid-cols-4"
            >
              {related.map((p) => (
                <MotionLi key={p.id} variants={emerge}>
                  <ProductCard store={store} product={p} content={content} />
                </MotionLi>
              ))}
            </MotionUl>
          </section>
        )}
      </div>
    </ProductProvider>
  );
};

const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <MotionUl
    initial="hidden"
    whileInView="visible"
    viewport={viewport}
    variants={stagger}
    className="grid grid-cols-2 gap-x-5 gap-y-14 sm:gap-x-8 lg:grid-cols-3"
  >
    {products.map((p) => (
      <MotionLi key={p.id} variants={emerge}>
        <ProductCard store={data.store} product={p} content={data.content} />
      </MotionLi>
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-3xl px-6 py-24 lg:py-32",
  catalogContainer: "mx-auto max-w-7xl px-6 py-24 lg:py-32",
  title: "font-serif text-5xl font-light tracking-tight text-center sm:text-6xl",
  subtitle: "mt-4 text-center text-[10px] font-medium uppercase tracking-[0.4em] text-muted-foreground",
  chip: "rounded-full border border-border px-6 py-2 text-[11px] uppercase tracking-[0.25em] transition-colors hover:border-accent hover:text-accent",
  panel: "mt-16 border-t border-border pt-10",
};

export const luxuryTemplate: Template = {
  ProductGrid,
  filterLayout: "sidebar",
  pageStyle,
  Announcement,
  Navbar,
  Hero,
  FeaturedCategories,
  NewArrivals,
  BestSellers,
  PromoBanner,
  BrandStory,
  Reviews,
  Footer,
  ProductPage,
};
