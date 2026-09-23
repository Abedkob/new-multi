import Link from "next/link";
import type { ReactNode } from "react";
import type { Variants } from "motion/react";
import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionUl } from "../motion";
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

/**
 * Atelier: an editorial, magazine-style storefront for fashion. Oversized italic display type,
 * arched photography, a running ticker, a lookbook-style category index and hand-placed
 * "polaroid" social tiles. Same data and sections as every other template; only the look differs.
 */

const wrap = "mx-auto max-w-[88rem] px-5 sm:px-8";
const eyebrow = "text-[11px] font-medium uppercase tracking-[0.3em]";
const pill =
  "group inline-flex h-14 items-center justify-center gap-3 rounded-full px-8 text-[11px] font-medium uppercase tracking-[0.25em] transition-colors duration-300";

const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
// A tiny threshold: a long product grid on a phone can be several screens tall.
const viewport = { once: true, amount: 0.05 } as const;

/** Oversized italic heading with a rule under it, and an optional link on the right. */
function SectionHeading({ title, aside, className }: { title: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-10 flex items-end justify-between gap-6 border-b border-foreground pb-5 lg:mb-14", className)}>
      <h2 className="font-serif text-4xl italic leading-none tracking-tight text-balance sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      {aside}
    </div>
  );
}

function ShopAllLink({ store, content }: { store: StoreInfo; content: ContentMap }) {
  return (
    <Link
      href={shopHref(store)}
      className={cn(eyebrow, "group hidden shrink-0 items-center gap-2 pb-1 hover:text-primary sm:inline-flex")}
    >
      {content["navbar.shopLabel"]}
      <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </Link>
  );
}

const Announcement: SectionComponent = ({ data }) => {
  const text = data.content["announcement.text"];
  const run = (hidden: boolean) => (
    <div aria-hidden={hidden || undefined} className="flex shrink-0">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} aria-hidden={i > 0 || undefined} className="flex items-center gap-10 pr-10">
          {text}
          <span aria-hidden className="text-accent">
            &#10022;
          </span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={cn(eyebrow, "overflow-hidden bg-primary py-2.5 text-primary-foreground")}>
      <MotionDiv
        className="flex w-max"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 40, ease: "linear", repeat: Infinity }}
      >
        {run(false)}
        {run(true)}
      </MotionDiv>
    </div>
  );
};

const navLink =
  "relative text-[11px] font-medium uppercase tracking-[0.2em] after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-current after:transition-all after:duration-300 hover:after:w-full";

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-md">
      <div className={cn(wrap, "flex h-16 items-center gap-4 lg:h-20 lg:gap-8")}>
        <StoreMenuButton data={data} className="-ml-2 lg:hidden" />
        <StoreBrand
          store={store}
          content={content}
          className="min-w-0 truncate font-serif text-2xl italic tracking-tight lg:text-3xl"
          logoClassName="h-7 lg:h-9"
        />
        <nav className="hidden flex-1 items-center justify-center gap-7 lg:flex">
          <Link href={shopHref(store)} className={navLink}>
            {content["navbar.shopLabel"]}
          </Link>
          {categoryTiles.slice(0, 4).map((c) => (
            <Link key={c.id} href={c.href} className={navLink}>
              {c.label}
            </Link>
          ))}
          {pages.map((pg) => (
            <Link key={pg.slug} href={pg.href} className={cn(navLink, "text-muted-foreground hover:text-foreground")}>
              {pg.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5 lg:ml-0">
          <SearchBox
            slug={store.slug}
            basePath={store.basePath}
            placeholder={content["search.placeholder"]}
            buttonLabel={content["search.button"]}
            className="hidden md:flex"
            inputClassName="h-9 w-44 rounded-none border-0 border-b border-foreground/30 bg-transparent px-0 text-sm italic shadow-none focus-visible:border-foreground focus-visible:ring-0 xl:w-56"
            buttonClassName="sr-only"
          />
          <CartLink basePath={store.basePath} className="text-sm transition-colors hover:text-primary" />
        </div>
      </div>
    </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);
  const showText = visibility.heroText;
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-secondary/50" />
      <div className={cn(wrap, "relative grid items-center gap-12 py-10 sm:py-14 lg:grid-cols-12 lg:gap-6 lg:py-20")}>
        {showText && (
          <MotionDiv
            initial="hidden"
            animate="visible"
            variants={stagger}
            className={cn(
              "relative z-10",
              hasImage
                ? "order-2 lg:order-1 lg:col-span-6 xl:col-span-5"
                : "flex flex-col items-center py-16 text-center lg:col-span-10 lg:col-start-2 lg:py-24",
            )}
          >
            <MotionP variants={fadeUp} className={cn(eyebrow, "flex items-center gap-4 text-muted-foreground")}>
              <span aria-hidden className="h-px w-10 bg-foreground/40" />
              {store.name}
            </MotionP>
            <MotionH1
              variants={fadeUp}
              className="mt-6 font-serif text-5xl italic leading-[0.95] tracking-tight text-balance sm:text-7xl xl:text-8xl"
            >
              {content["hero.headline"]}
            </MotionH1>
            {content["hero.subtext"] && (
              <MotionP variants={fadeUp} className="mt-7 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                {content["hero.subtext"]}
              </MotionP>
            )}
            {content["hero.ctaLabel"] && (
              <MotionDiv variants={fadeUp} className="mt-10">
                <Link
                  href={sectionHref(store, "new-arrivals")}
                  className={cn(pill, "bg-primary text-primary-foreground hover:bg-foreground hover:text-background")}
                >
                  {content["hero.ctaLabel"]}
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </MotionDiv>
            )}
          </MotionDiv>
        )}

        {hasImage && (
          <MotionDiv
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease }}
            className={cn(
              "relative mx-auto w-full",
              showText
                ? "order-1 max-w-xl lg:order-2 lg:col-span-6 lg:col-start-7 lg:max-w-none xl:col-span-6 xl:col-start-7"
                : "max-w-2xl lg:col-span-8 lg:col-start-3",
            )}
          >
            {/* A thin outline arch behind the photo, offset for depth. */}
            <div
              aria-hidden
              className="absolute -right-3 -top-3 bottom-3 left-3 rounded-t-full border border-foreground/25 sm:-right-5 sm:-top-5 sm:bottom-5 sm:left-5"
            />
            <div className="relative overflow-hidden rounded-t-full bg-secondary">
              <HeroPicture content={content} alt={store.name} className="aspect-[4/5] w-full" mobileClassName="aspect-[3/4] w-full" />
            </div>
            {/* Slowly turning seal with the store name. */}
            <MotionDiv
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ duration: 28, ease: "linear", repeat: Infinity }}
              className="absolute -left-2 bottom-8 grid size-28 place-items-center rounded-full bg-accent text-accent-foreground shadow-lg sm:-left-8 sm:size-36 lg:-left-12 lg:size-40"
            >
              <svg viewBox="0 0 100 100" className="size-full">
                <defs>
                  <path id="atelier-seal" d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" />
                </defs>
                <text className="fill-current text-[8.5px] font-medium uppercase">
                  <textPath href="#atelier-seal" textLength="230" lengthAdjust="spacing">
                    {store.name} &#10022; {store.name} &#10022;
                  </textPath>
                </text>
              </svg>
              <span className="absolute font-serif text-3xl italic">&#10022;</span>
            </MotionDiv>
          </MotionDiv>
        )}
      </div>
    </section>
  );
};

/** A lookbook index: big italic category names, a photo sliding open beside the one you hover. */
const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-20 lg:py-28")}>
    <SectionHeading
      title={content["featuredCategories.heading"]}
      aside={
        <span className={cn(eyebrow, "shrink-0 pb-1 tabular-nums text-muted-foreground")}>
          ({String(categoryTiles.length).padStart(2, "0")})
        </span>
      }
    />
    <MotionUl initial="hidden" whileInView="visible" viewport={viewport} variants={stagger}>
      {categoryTiles.map((c, i) => (
        <MotionLi key={c.id} variants={fadeUp} className="border-b border-border">
          <Link href={c.href} className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 py-5 sm:gap-8 sm:py-6">
            <span className="w-8 text-xs tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <span className="flex min-w-0 items-center gap-4 sm:gap-6">
              <span className="relative h-20 w-16 shrink-0 overflow-hidden rounded-t-full bg-secondary transition-all duration-500 ease-out lg:h-28 lg:w-0 lg:opacity-0 lg:group-hover:w-24 lg:group-hover:opacity-100">
                <Picture src={c.image} alt={c.label} className="absolute inset-0" sizes="96px" />
              </span>
              <span className="truncate font-serif text-3xl italic leading-tight tracking-tight transition-all duration-500 group-hover:text-primary sm:text-5xl lg:text-7xl lg:group-hover:translate-x-2">
                {c.label}
              </span>
            </span>
            <span className={cn(eyebrow, "flex items-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground")}>
              <span className="hidden sm:inline">{content["featuredCategories.tileCta"]}</span>
              <ArrowUpRight className="size-5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </Link>
        </MotionLi>
      ))}
    </MotionUl>
  </section>
);

/**
 * Product card: a tall photo that crossfades to the second gallery photo on hover, a "view"
 * bar that slides up, and the name in italic serif. `feature` stretches the photo to fill a
 * double-height grid cell (the lead item of New arrivals).
 */
function ProductCard({
  store,
  product,
  content,
  feature = false,
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  feature?: boolean;
}) {
  const second = product.images.find((i) => i.url && i.url !== product.imageUrl)?.url ?? "";
  return (
    <Link href={productHref(store, product)} className={cn("group flex flex-col", feature && "h-full")}>
      <div
        className={cn(
          "relative overflow-hidden bg-secondary",
          feature ? "aspect-[4/5] lg:aspect-auto lg:min-h-[28rem] lg:flex-1" : "aspect-[3/4]",
        )}
      >
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="absolute inset-0"
          imgClassName={cn("transition duration-700 ease-out group-hover:scale-[1.04]", second && "group-hover:opacity-0")}
          sizes={feature ? "(max-width: 1024px) 100vw, 50vw" : undefined}
        />
        {second && (
          <Picture
            src={second}
            alt=""
            className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
            sizes={feature ? "(max-width: 1024px) 100vw, 50vw" : undefined}
          />
        )}
        {!product.inStock && (
          <span className="absolute right-3 top-3 bg-background px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em]">
            {content["product.outOfStock"]}
          </span>
        )}
        <span className="absolute inset-x-3 bottom-3 hidden translate-y-2 bg-background/90 py-3 text-center text-[11px] font-medium uppercase tracking-[0.25em] opacity-0 backdrop-blur transition duration-500 group-hover:translate-y-0 group-hover:opacity-100 sm:block">
          {content["product.viewLabel"]}
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h3 className={cn("min-w-0 font-serif italic leading-snug", feature ? "text-2xl sm:text-3xl" : "text-base sm:text-lg")}>
          {product.name}
        </h3>
        <span className="shrink-0 text-sm tabular-nums">{cardPrice(product, content)}</span>
      </div>
    </Link>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => {
  // The editorial layout (one big lead piece) needs enough pieces around it to fill the grid.
  const editorial = newArrivals.length >= 5;
  return (
    <section className={cn(wrap, "py-20 lg:py-28")}>
      <SectionHeading title={content["newArrivals.heading"]} aside={<ShopAllLink store={store} content={content} />} />
      {newArrivals.length === 0 ? (
        <p className="font-serif text-xl italic text-muted-foreground">{content["newArrivals.empty"]}</p>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 lg:grid-cols-4"
        >
          {newArrivals.map((p, i) => (
            <MotionLi key={p.id} variants={fadeUp} className={cn(editorial && i === 0 && "col-span-2 lg:row-span-2")}>
              <ProductCard store={store} product={p} content={content} feature={editorial && i === 0} />
            </MotionLi>
          ))}
        </MotionUl>
      )}
    </section>
  );
};

/** A sideways-scrolling rail, each piece marked with its rank in outlined numerals. */
const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="overflow-hidden bg-secondary text-secondary-foreground">
    <div className={cn(wrap, "py-20 lg:py-28")}>
      <SectionHeading
        title={content["bestSellers.heading"]}
        aside={<ShopAllLink store={store} content={content} />}
        className="border-secondary-foreground"
      />
      {bestSellers.length === 0 ? (
        <p className="font-serif text-xl italic opacity-70">{content["bestSellers.empty"]}</p>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 pb-4 pt-12 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:gap-6 sm:px-8 [&::-webkit-scrollbar]:hidden"
        >
          {bestSellers.map((p, i) => (
            <MotionLi
              key={p.id}
              variants={fadeUp}
              className="relative w-[70vw] shrink-0 snap-start sm:w-[42vw] lg:w-[calc((100%-4.5rem)/4)]"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -top-12 left-2 z-10 font-serif text-8xl italic leading-none text-transparent [-webkit-text-stroke:1.5px_var(--secondary-foreground)] lg:text-9xl"
              >
                {i + 1}
              </span>
              <ProductCard store={store} product={p} content={content} />
            </MotionLi>
          ))}
        </MotionUl>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  return (
    <section className="bg-primary text-primary-foreground">
      <div className={cn("grid", image && "lg:grid-cols-2")}>
        {image && (
          <div className="relative min-h-[55vh] lg:min-h-[80vh]">
            <Picture src={image} alt={content["promoBanner.heading"]} className="absolute inset-0" sizes="(max-width: 1024px) 100vw, 50vw" />
          </div>
        )}
        <MotionDiv
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className={cn(
            "relative flex flex-col justify-center overflow-hidden px-6 py-20 sm:px-12 lg:px-20 lg:py-28",
            !image && "min-h-[60vh] items-center text-center",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 select-none font-serif text-[16rem] leading-none text-accent opacity-60 lg:text-[22rem]"
          >
            &#10022;
          </span>
          <MotionH2
            variants={fadeUp}
            className="relative max-w-2xl font-serif text-5xl italic leading-[0.95] tracking-tight text-balance sm:text-7xl"
          >
            {content["promoBanner.heading"]}
          </MotionH2>
          {content["promoBanner.subtext"] && (
            <MotionP variants={fadeUp} className="relative mt-7 max-w-md whitespace-pre-line leading-relaxed text-primary-foreground/75">
              {content["promoBanner.subtext"]}
            </MotionP>
          )}
          <MotionDiv variants={fadeUp} className="relative mt-10">
            <Link
              href={sectionHref(store, "new-arrivals")}
              className={cn(pill, "border border-primary-foreground hover:bg-primary-foreground hover:text-primary")}
            >
              {content["promoBanner.ctaLabel"]}
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </MotionDiv>
        </MotionDiv>
      </div>
    </section>
  );
};

/** A magazine spread: oval portrait beside a column of text that opens with a drop cap. */
const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-20 lg:py-32")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn("grid items-center gap-14", image ? "lg:grid-cols-12" : "mx-auto max-w-3xl")}
      >
        {image && (
          <MotionDiv variants={fadeUp} className="mx-auto w-full max-w-md lg:col-span-5 lg:max-w-none">
            <div className="relative">
              <div aria-hidden className="absolute -inset-3 rounded-[50%] border border-foreground/25" />
              <div className="relative overflow-hidden rounded-[50%] bg-secondary">
                <Picture src={image} alt={store.name} className="aspect-[3/4]" sizes="(max-width: 1024px) 100vw, 40vw" />
              </div>
            </div>
          </MotionDiv>
        )}
        <div className={cn(image && "lg:col-span-6 lg:col-start-7")}>
          <MotionP variants={fadeUp} className={cn(eyebrow, "flex items-center gap-4 text-muted-foreground")}>
            <span aria-hidden className="h-px w-10 bg-foreground/40" />
            {store.name}
          </MotionP>
          {content["brandStory.heading"] && (
            <MotionH2
              variants={fadeUp}
              className="mt-6 font-serif text-4xl italic leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl"
            >
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          {content["brandStory.body"] && (
            <MotionP
              variants={fadeUp}
              className="mt-8 whitespace-pre-line text-base leading-relaxed text-muted-foreground first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:font-serif first-letter:text-7xl first-letter:italic first-letter:leading-[0.8] first-letter:text-primary sm:text-lg"
            >
              {content["brandStory.body"]}
            </MotionP>
          )}
        </div>
      </MotionDiv>
    </section>
  );
};

/** Pull quotes that zig-zag down the page. */
const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="border-y border-border bg-secondary/40">
    <div className={cn(wrap, "py-20 lg:py-28")}>
      <h2 className={cn(eyebrow, "mb-14 flex items-center justify-center gap-4 text-center text-muted-foreground")}>
        <span aria-hidden className="h-px w-10 bg-foreground/40" />
        {content["reviews.heading"]}
        <span aria-hidden className="h-px w-10 bg-foreground/40" />
      </h2>
      <MotionUl initial="hidden" whileInView="visible" viewport={viewport} variants={stagger} className="space-y-16 lg:space-y-20">
        {reviews.map((r, i) => (
          <MotionLi key={i} variants={fadeUp} className={cn("max-w-3xl", i % 2 === 1 ? "ml-auto text-right" : "")}>
            <span aria-hidden className="block h-12 font-serif text-8xl leading-none text-accent">
              &ldquo;
            </span>
            <blockquote className="font-serif text-2xl italic leading-snug tracking-tight text-balance sm:text-3xl lg:text-4xl">
              {r.quote}
            </blockquote>
            {r.author && (
              <p className={cn(eyebrow, "mt-6 flex items-center gap-4 text-muted-foreground", i % 2 === 1 && "justify-end")}>
                <span aria-hidden className="h-px w-8 bg-foreground/40" />
                {r.author}
              </p>
            )}
          </MotionLi>
        ))}
      </MotionUl>
    </div>
  </section>
);

// Fixed classes (Tailwind needs to see them whole): each tile gets its own tilt and drop.
const TILT = ["-rotate-3", "rotate-2 sm:translate-y-8", "-rotate-1", "rotate-3 sm:translate-y-6", "-rotate-2", "rotate-1 sm:translate-y-10"];

/** Photos scattered like prints pinned to a mood board. */
const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className="overflow-hidden py-20 lg:py-28">
    <div className={cn(wrap, "text-center")}>
      <h2 className="font-serif text-4xl italic tracking-tight sm:text-5xl lg:text-6xl">{content["instagram.heading"]}</h2>
      {instagram.handle &&
        (instagram.url ? (
          <a
            href={instagram.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(eyebrow, "mt-5 inline-flex items-center gap-2 hover:text-primary")}
          >
            @{instagram.handle}
            <ArrowUpRight className="size-4" />
          </a>
        ) : (
          <p className={cn(eyebrow, "mt-5 text-muted-foreground")}>@{instagram.handle}</p>
        ))}
    </div>
    {instagram.tiles.length > 0 && (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(wrap, "mt-14 flex flex-wrap justify-center gap-4 pb-10 sm:gap-6")}
      >
        {instagram.tiles.map((t, i) => {
          const print = (
            <div className="border border-border bg-background p-2 pb-8 shadow-md sm:p-3 sm:pb-10">
              <Picture src={t.image} alt={store.name} className="aspect-square" sizes="(max-width: 640px) 45vw, 15vw" />
            </div>
          );
          return (
            <MotionLi
              key={i}
              variants={fadeUp}
              className={cn(
                "w-[42%] transition-transform duration-500 hover:z-10 hover:rotate-0 hover:scale-105 sm:w-44 lg:w-52",
                TILT[i % TILT.length],
              )}
            >
              {instagram.url ? (
                <a href={instagram.url} target="_blank" rel="noopener noreferrer" aria-label={`@${instagram.handle}`}>
                  {print}
                </a>
              ) : (
                print
              )}
            </MotionLi>
          );
        })}
      </MotionUl>
    )}
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, pages, instagram } }) => (
  <footer className="overflow-hidden bg-foreground text-background">
    <div className={cn(wrap, "pt-20")}>
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <StoreBrand
            store={store}
            content={content}
            className="font-serif text-3xl italic tracking-tight"
            logoClassName="h-10"
          />
          <p className="mt-6 max-w-sm whitespace-pre-line text-sm leading-relaxed text-background/70">{content["footer.about"]}</p>
        </div>
        <div className="md:col-span-3 md:col-start-7">
          <h3 className={cn(eyebrow, "mb-6 text-background/50")}>{content["footer.linksHeading"]}</h3>
          <ul className="space-y-3">
            <li>
              <Link href={shopHref(store)} className="font-serif text-lg italic transition-colors hover:text-accent">
                {content["navbar.shopLabel"]}
              </Link>
            </li>
            {pages.map((pg) => (
              <li key={pg.slug}>
                <Link href={pg.href} className="font-serif text-lg italic transition-colors hover:text-accent">
                  {pg.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {instagram.handle && (
          <div className="md:col-span-3">
            <h3 className={cn(eyebrow, "mb-6 text-background/50")}>{content["instagram.heading"]}</h3>
            {instagram.url ? (
              <a
                href={instagram.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-serif text-lg italic transition-colors hover:text-accent"
              >
                @{instagram.handle}
                <ArrowUpRight className="size-4" />
              </a>
            ) : (
              <p className="font-serif text-lg italic">@{instagram.handle}</p>
            )}
          </div>
        )}
      </div>
      <div className="mt-16 flex flex-col gap-2 border-t border-background/15 py-6 text-xs text-background/50 sm:flex-row sm:justify-between">
        <p>{fillTokens(content["footer.copyright"], store)}</p>
      </div>
    </div>
    {/* The store name as a giant wordmark, bleeding off the bottom edge. */}
    <div aria-hidden className="-mb-[4vw] select-none whitespace-nowrap px-4 text-center font-serif text-[18vw] italic leading-none tracking-tighter text-background/10">
      {store.name}
    </div>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-8 lg:py-14")}>
        <Link
          href={storeHref(store)}
          className={cn(eyebrow, "inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground")}
        >
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-8 grid gap-10 lg:mt-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-t-full bg-secondary">
              <ProductImage className="aspect-[3/4]" />
            </div>
            <ProductGallery className="mt-4 gap-3" />
          </div>

          <div className="lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
            <p className={cn(eyebrow, "flex items-center gap-4 text-muted-foreground")}>
              <span aria-hidden className="h-px w-10 bg-foreground/40" />
              {store.name}
            </p>
            <h1 className="mt-5 font-serif text-4xl italic leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {product.name}
            </h1>
            <p className="mt-5 text-xl tabular-nums">
              <ProductPrice />
            </p>
            <div className="my-8 h-px bg-border" />
            <div className="space-y-7">
              <VariantPicker look="atelier" labelClassName={cn(eyebrow, "mb-3 block")} />
              <StockStatus look="dot" className="block text-sm" />
              <AddToCart look="atelier" basePath={store.basePath} />
            </div>
            {product.description && (
              <details open className="group mt-10 border-y border-border">
                <summary className={cn(eyebrow, "flex cursor-pointer list-none items-center justify-between py-5 [&::-webkit-details-marker]:hidden")}>
                  {content["product.descriptionHeading"]}
                  <Plus className="size-4 transition-transform duration-300 group-open:rotate-45" />
                </summary>
                <p className="whitespace-pre-line pb-6 leading-relaxed text-muted-foreground">{product.description}</p>
              </details>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-24 lg:mt-36">
            <SectionHeading title={content["product.relatedHeading"]} />
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 lg:grid-cols-4"
            >
              {related.map((p) => (
                <MotionLi key={p.id} variants={fadeUp}>
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
    className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 lg:grid-cols-3"
  >
    {products.map((p) => (
      <MotionLi key={p.id} variants={fadeUp}>
        <ProductCard store={data.store} product={p} content={data.content} />
      </MotionLi>
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-4xl px-5 py-16 sm:px-8 lg:py-24",
  catalogContainer: "mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:py-24",
  title: "font-serif text-5xl italic leading-none tracking-tight sm:text-6xl",
  subtitle: "mt-3 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground",
  chip: "rounded-full border border-foreground/30 px-5 py-2 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors hover:bg-foreground hover:text-background",
  panel: "mt-10 border-t border-foreground pt-10",
};

export const atelierTemplate: Template = {
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
  Instagram,
  Footer,
  ProductPage,
};
