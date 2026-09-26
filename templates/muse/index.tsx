import type { CSSProperties } from "react";
import Link from "next/link";
import type { Variants } from "motion/react";
import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionLi, MotionP, MotionSpan, MotionUl } from "../motion";
import { CartLink } from "../nav-client";
import {
  AddToCart,
  ProductGallery,
  ProductImage,
  ProductPrice,
  ProductProvider,
  StockStatus,
  VariantPicker,
} from "../product-client";
import {
  HeroPicture,
  Picture,
  StoreBrand,
  StoreMenuButton,
  cardPrice,
  productHref,
  StoreSearchButton,
  sectionHref,
  shopHref,
  storeHref,
} from "../shared";
import { StoreFooter } from "../store-footer";
import type { SectionComponent, StoreInfo, StoreProduct, Template } from "../types";
import { BestSellerShowcase, Parallax, ScrollStatement } from "./motion-client";

/**
 * "Muse": a warm editorial boutique. Cream page, rounded cards, a high-contrast serif (.font-muse)
 * and dark pill buttons whose orange arrow circle turns as the accent sweeps across them.
 *
 * Motion is the point, layered in three kinds:
 *  - page load (CSS keyframes in globals.css, so the hero paints from server HTML): bento cards
 *    unveil bottom-up, photos settle from a zoom, headline words rise out of their line;
 *  - scroll: the statement heading lights up word by word with photo pills stretching open,
 *    photos drift in parallax, headings and cards rise in on view (motion);
 *  - hover: category and product photos zoom or swap, arrows turn, the best-seller photo follows
 *    the hovered row. Reviews run as a pausable marquee; the footer wordmark rises letter by letter.
 * Every split-up heading also carries its plain text in an sr-only span (the animated copy is
 * aria-hidden), so screen readers and text search see one normal sentence.
 */

const wrap = "mx-auto max-w-[82rem] px-4 sm:px-6";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
// No leading here: tailwind-merge drops a line-height that comes before a text size, so each
// use appends its own leading after the size.
const serifHeading = "font-muse font-normal tracking-[-0.01em]";

const ease = [0.16, 1, 0.3, 1] as const;
const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease } },
};
const wordRise: Variants = { hidden: { y: "110%" }, visible: { y: "0%", transition: { duration: 0.8, ease } } };
const viewport = { once: true, amount: 0.05 } as const;

const delay = (seconds: number) => ({ "--d": `${seconds}s` }) as CSSProperties;
const splitWords = (text: string) => text.split(/\s+/).filter(Boolean);

/** Page-load headline: words rise out of their own line (CSS, runs before hydration). */
function LoadWords({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {splitWords(text).map((word, i) => (
          <span key={i}>
            <span className="-mb-[0.14em] inline-block overflow-hidden pb-[0.14em] align-top">
              <span className="muse-word" style={delay(start + i * 0.06)}>
                {word}
              </span>
            </span>{" "}
          </span>
        ))}
      </span>
    </>
  );
}

/** The same rise, triggered when the heading scrolls into view. */
function ViewWords({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <MotionSpan aria-hidden initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.6 }} variants={stagger}>
        {splitWords(text).map((word, i) => (
          <span key={i}>
            <span className="-mb-[0.14em] inline-block overflow-hidden pb-[0.14em] align-top">
              <MotionSpan variants={wordRise} className="inline-block">
                {word}
              </MotionSpan>
            </span>{" "}
          </span>
        ))}
      </MotionSpan>
    </>
  );
}

/** Pill button: the accent sweeps across it on hover and the arrow circle turns. */
function PillLink({
  href,
  label,
  tone = "dark",
  className,
}: {
  href: string;
  label: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative isolate inline-flex h-12 items-center gap-4 overflow-hidden rounded-full py-1.5 pl-5 pr-1.5 text-sm font-medium",
        tone === "dark" ? "bg-primary text-primary-foreground" : "bg-background text-foreground",
        focus,
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 origin-right scale-x-0 rounded-full bg-accent transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.2,1)] group-hover:origin-left group-hover:scale-x-100"
      />
      <span className="whitespace-nowrap transition-colors duration-500 group-hover:text-accent-foreground">{label}</span>
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-all duration-500 group-hover:rotate-45 group-hover:bg-background group-hover:text-foreground"
      >
        <ArrowUpRight className="size-4" />
      </span>
    </Link>
  );
}

/** A section's heading row: serif title rising in on the left, an optional pill link on the right. */
function SectionHead({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5 sm:mb-10">
      <h2 className={cn(serifHeading, "max-w-3xl text-4xl sm:text-6xl leading-[1.02]")}>
        <ViewWords text={title} />
      </h2>
      {link && <PillLink href={link.href} label={link.label} />}
    </div>
  );
}

const ArrowDisc = ({ className }: { className?: string }) => (
  <span
    aria-hidden
    className={cn(
      "grid size-10 place-items-center rounded-full bg-accent text-accent-foreground transition-transform duration-500 group-hover:rotate-45",
      className,
    )}
  >
    <ArrowUpRight className="size-4" />
  </span>
);

/** The announcement as an endless ticker. Two identical copies slide by one copy's width. */
const Announcement: SectionComponent = ({ data }) => {
  const text = data.content["announcement.text"];
  const run = (hidden: boolean) =>
    Array.from({ length: 6 }, (_, i) => (
      <span key={i} aria-hidden={hidden || i > 0} className="flex shrink-0 items-center gap-6 pr-6">
        {text}
        <span className="size-1.5 rounded-full bg-current opacity-70" />
      </span>
    ));
  return (
    <div className="overflow-hidden bg-accent py-2 text-xs font-medium text-accent-foreground sm:text-sm">
      <div className="flex w-max animate-marquee [animation-duration:38s]">
        <div className="flex shrink-0">{run(false)}</div>
        <div className="marquee-clone flex shrink-0">{run(true)}</div>
      </div>
    </div>
  );
};

const navLink = cn(
  "relative py-1 text-sm transition-colors hover:text-foreground after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-500 hover:after:origin-left hover:after:scale-x-100",
  focus,
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="border-b border-foreground/10 bg-background/85 backdrop-blur-md">
      <div className={cn(wrap, "grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:h-[4.5rem] lg:grid-cols-[1fr_auto_1fr]")}>
        <div className="flex min-w-0 items-center gap-1">
          <StoreMenuButton data={data} className="-ml-2 lg:hidden" buttonClassName="rounded-full" />
          <StoreBrand store={store} content={content} className={cn("min-w-0 truncate font-muse text-2xl sm:text-3xl", focus)} logoClassName="h-8" />
        </div>
        <nav className="hidden items-center gap-8 text-muted-foreground lg:flex">
          <Link href={shopHref(store)} className={navLink}>
            {content["navbar.shopLabel"]}
          </Link>
          {categoryTiles.slice(0, 4).map((c) => (
            <Link key={c.id} href={c.href} className={navLink}>
              {c.label}
            </Link>
          ))}
          {pages.slice(0, 2).map((p) => (
            <Link key={p.slug} href={p.href} className={navLink}>
              {p.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-1 lg:col-start-3">
          <StoreSearchButton data={data} look="muse" className={cn("grid size-10 place-items-center rounded-full transition-colors hover:bg-secondary", focus)}>
            <Search className="size-[1.15rem]" />
          </StoreSearchButton>
          <CartLink
            basePath={store.basePath}
            className={cn("flex h-10 items-center rounded-full px-3 text-sm transition-colors hover:bg-secondary [&_svg]:size-[1.15rem]", focus)}
          />
        </div>
      </div>
    </header>
  );
};

/** One hero block's photo: the "(Mobile)" upload on phones, the desktop one from sm up; either
 * one alone is used everywhere (same rule as shared HeroPicture, for the slide 2/3 keys). */
function SlotPicture({
  desktop,
  mobile,
  alt,
  className,
  imgClassName,
  sizes,
}: {
  desktop: string;
  mobile: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  sizes?: string;
}) {
  return (
    <>
      {mobile && (
        <Picture src={mobile} alt={alt} sizes={sizes} imgClassName={imgClassName} className={cn(className, desktop && "sm:hidden")} />
      )}
      {desktop && (
        <Picture src={desktop} alt={alt} sizes={sizes} imgClassName={imgClassName} className={cn(className, mobile && "hidden sm:block")} />
      )}
    </>
  );
}

/**
 * Bento hero, one image per block (the same hero slide keys Tonkic's slider uses):
 *  - the tall photo card: hero.image / hero.imageMobile;
 *  - the top-right card: slide 2 (hero.item2.*: image, headline, subtext as the small line,
 *    button text). Left blank, it spotlights the first category (else the newest product);
 *  - the dark card: the main headline, subtext and button, beside slide 3's image (hero.item3.*).
 * The Hero switch (heroText) hides all hero text, the slide 2 text included: a block with an
 * image stays as a photo, a block with nothing to show goes and its neighbour takes the space.
 */
const Hero: SectionComponent = ({ data: { store, content, visibility, categoryTiles, newArrivals } }) => {
  const hasText = visibility.heroText;
  const hasHeroImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);
  const newest = newArrivals[0];
  const firstCategory = categoryTiles[0];

  const slide2 = {
    image: content["hero.item2.image"],
    imageMobile: content["hero.item2.imageMobile"],
    headline: content["hero.item2.headline"],
    subtext: content["hero.item2.subtext"],
    ctaLabel: content["hero.item2.ctaLabel"],
  };
  const slide2Used = Boolean(slide2.image || slide2.imageMobile || slide2.headline);
  const spot = slide2Used
    ? {
        kicker: hasText ? slide2.subtext : "",
        title: hasText ? slide2.headline : "",
        cta: hasText ? slide2.ctaLabel : "",
        image: slide2.image,
        imageMobile: slide2.imageMobile,
        href: shopHref(store),
      }
    : firstCategory
      ? { kicker: content["navbar.categoriesLabel"], title: firstCategory.label, cta: "", image: firstCategory.image, imageMobile: "", href: firstCategory.href }
      : newest
        ? { kicker: content["newArrivals.heading"], title: newest.name, cta: "", image: newest.imageUrl, imageMobile: "", href: productHref(store, newest) }
        : null;
  const showSpot = Boolean(spot && (spot.title || spot.image || spot.imageMobile));
  const spotHasText = Boolean(spot?.title || spot?.kicker);

  const slide3Image = content["hero.item3.image"];
  const slide3Mobile = content["hero.item3.imageMobile"];
  const hasSlide3Image = Boolean(slide3Image || slide3Mobile);
  const showDark = hasText || hasSlide3Image;
  const hasRight = showSpot || showDark;

  return (
    <section className={cn(wrap, "pb-16 pt-3 sm:pb-24 sm:pt-5")}>
      <div className={cn("grid gap-3", hasRight && "lg:h-[min(84vh,48rem)] lg:grid-cols-[1.08fr_1fr]")}>
        <div className="muse-unveil relative aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-secondary sm:aspect-[16/11] lg:aspect-auto lg:h-full">
          <Parallax strength={8}>
            <div className="muse-zoom absolute inset-0">
              {hasHeroImage ? (
                <HeroPicture content={content} alt={store.name} className="absolute inset-0" />
              ) : (
                newest && <Picture src={newest.imageUrl} alt={store.name} className="absolute inset-0" sizes="(max-width: 1024px) 100vw, 55vw" />
              )}
            </div>
          </Parallax>
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-primary/35 to-transparent" />
          <PillLink
            href={sectionHref(store, "new-arrivals")}
            label={content["navbar.shopLabel"]}
            className="muse-fade absolute bottom-4 left-4 sm:bottom-6 sm:left-6"
          />
        </div>

        {hasRight && (
          <div className={cn("grid min-h-0 gap-3", showSpot && showDark && "lg:grid-rows-[1fr_1.12fr]")}>
            {spot && showSpot && (
              <Link
                href={spot.href}
                style={delay(0.12)}
                className={cn(
                  "muse-unveil group relative grid min-h-[15rem] overflow-hidden rounded-[1.75rem] bg-secondary text-secondary-foreground",
                  spotHasText && "grid-cols-[1fr_1.1fr]",
                  focus,
                )}
              >
                {spotHasText && (
                  <div className="flex min-w-0 flex-col justify-between gap-6 p-5 sm:p-7">
                    <div>
                      {spot.kicker && <p className="line-clamp-2 text-xs opacity-70">{spot.kicker}</p>}
                      {spot.title && (
                        <p className="mt-2 font-muse text-[clamp(1.6rem,7vw,3rem)] uppercase leading-[0.95] [overflow-wrap:break-word] lg:text-5xl">{spot.title}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-3 text-sm">
                      <span
                        aria-hidden
                        className="grid size-10 shrink-0 place-items-center rounded-full border border-current/30 transition-all duration-500 group-hover:rotate-45 group-hover:border-accent group-hover:bg-accent group-hover:text-accent-foreground"
                      >
                        <ArrowUpRight className="size-4" />
                      </span>
                      {spot.cta}
                    </span>
                  </div>
                )}
                <div className={cn("relative overflow-hidden rounded-[1.25rem]", spotHasText ? "my-2 mr-2" : "m-2")}>
                  <SlotPicture
                    desktop={spot.image}
                    mobile={spot.imageMobile}
                    alt={spot.title || store.name}
                    className="absolute inset-0"
                    imgClassName="transition-transform duration-[1.2s] ease-out group-hover:scale-110"
                    sizes="(max-width: 1024px) 50vw, 25vw"
                  />
                </div>
              </Link>
            )}
            {showDark && (
              <div
                style={delay(0.24)}
                className={cn(
                  "muse-unveil grid min-h-[15rem] overflow-hidden rounded-[1.75rem] bg-primary text-primary-foreground",
                  hasText && hasSlide3Image && "sm:grid-cols-[1.25fr_1fr]",
                )}
              >
                {hasText && (
                  <div className="flex min-w-0 flex-col justify-between gap-10 p-6 sm:p-9">
                    <h1
                      className={cn(
                        serifHeading,
                        hasSlide3Image ? "text-[clamp(2.2rem,3.4vw,3.4rem)]" : "text-[clamp(2.4rem,4.3vw,4rem)]",
                        "[overflow-wrap:anywhere] leading-[1.02]",
                      )}
                    >
                      <LoadWords text={content["hero.headline"]} start={0.55} />
                    </h1>
                    <div className="muse-fade" style={delay(0.9)}>
                      {content["hero.subtext"] && (
                        <p className="max-w-md whitespace-pre-line text-sm leading-relaxed text-primary-foreground/70">
                          {content["hero.subtext"]}
                        </p>
                      )}
                      {content["hero.ctaLabel"] && (
                        <PillLink href={shopHref(store)} label={content["hero.ctaLabel"]} tone="light" className="mt-7" />
                      )}
                    </div>
                  </div>
                )}
                {hasSlide3Image && (
                  <div
                    className={cn(
                      "relative min-h-[13rem] overflow-hidden rounded-[1.25rem]",
                      hasText ? "order-first m-2 mb-0 sm:order-none sm:mb-2 sm:ml-0" : "m-2",
                    )}
                  >
                    <SlotPicture
                      desktop={slide3Image}
                      mobile={slide3Mobile}
                      alt={store.name}
                      className="absolute inset-0"
                      imgClassName="muse-zoom"
                      sizes="(max-width: 640px) 100vw, 25vw"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

/** The statement: scroll-lit serif heading with photo pills, the story, then a drifting photo. */
const BrandStory: SectionComponent = ({ data: { store, content, newArrivals } }) => {
  const heading = content["brandStory.heading"];
  const body = content["brandStory.body"];
  const image = content["brandStory.image"];
  const pills = newArrivals.map((p) => p.imageUrl).filter(Boolean).slice(0, 2);
  return (
    <section className={cn(wrap, "py-12 sm:py-20")}>
      {heading && (
        <ScrollStatement text={heading} pills={pills} className={cn(serifHeading, "max-w-5xl text-[clamp(2.1rem,4.8vw,4.25rem)] leading-[1.12]")} />
      )}
      {body && (
        <MotionP
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={rise}
          className="mt-10 max-w-xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground sm:ml-[30%] sm:text-base"
        >
          {body}
        </MotionP>
      )}
      {image && (
        <MotionDiv
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={rise}
          className="relative mt-12 aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-secondary sm:ml-[30%] sm:aspect-[16/9]"
        >
          <Parallax>
            <Picture src={image} alt={store.name} className="absolute inset-0" sizes="(max-width: 640px) 100vw, 70vw" />
          </Parallax>
        </MotionDiv>
      )}
    </section>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { store, content, categoryTiles } }) => (
  <section className={cn(wrap, "py-12 sm:py-20")}>
    <SectionHead title={content["featuredCategories.heading"]} link={{ href: shopHref(store), label: content["navbar.shopLabel"] }} />
    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {categoryTiles.map((c) => (
        <MotionLi key={c.id} variants={rise} className="min-w-0">
          <Link href={c.href} className={cn("group relative block aspect-[3/4] overflow-hidden rounded-[1.5rem] bg-secondary", focus)}>
            <Picture
              src={c.image}
              alt={c.label}
              className="absolute inset-0"
              imgClassName="transition-transform duration-[1.2s] ease-out group-hover:scale-110"
              sizes="(max-width: 1024px) 50vw, 25vw"
            />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary/80 via-primary/25 to-transparent" />
            <ArrowDisc className="absolute right-3 top-3" />
            <div className="absolute inset-x-4 bottom-4 text-primary-foreground sm:inset-x-5 sm:bottom-5">
              <p className="font-muse text-2xl leading-none [overflow-wrap:anywhere] sm:text-3xl">{c.label}</p>
              <p className="mt-2 text-xs opacity-80 transition-all duration-500 sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-80">
                {content["featuredCategories.tileCta"]}
              </p>
            </div>
          </Link>
        </MotionLi>
      ))}
      <MotionLi variants={rise} className="min-w-0">
        <Link
          href={shopHref(store)}
          className={cn(
            "group flex aspect-[3/4] flex-col justify-between rounded-[1.5rem] bg-primary p-5 text-primary-foreground sm:p-6",
            focus,
          )}
        >
          <p className="font-muse text-3xl leading-none sm:text-4xl">{content["newArrivals.heading"]}</p>
          <span className="flex items-center justify-between gap-3 text-sm">
            {content["featuredCategories.tileCta"]}
            <ArrowDisc />
          </span>
        </Link>
      </MotionLi>
    </MotionUl>
  </section>
);

/** Product card: rounded photo that zooms (or swaps to the second photo) with an arrow popping in. */
function ProductCard({ store, product, content }: { store: StoreInfo; product: StoreProduct; content: ContentMap }) {
  const second = product.images.find((i) => i.url && i.url !== product.imageUrl)?.url;
  return (
    <Link href={productHref(store, product)} className={cn("group block", focus)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[1.5rem] bg-secondary">
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="absolute inset-0"
          imgClassName={cn("transition duration-[1.1s] ease-out group-hover:scale-105", second && "group-hover:opacity-0")}
        />
        {second && (
          <Picture
            src={second}
            alt=""
            className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
            imgClassName="scale-105"
          />
        )}
        <span
          aria-hidden
          className="absolute bottom-3 right-3 grid size-11 scale-0 place-items-center rounded-full bg-accent text-accent-foreground transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-45 group-hover:scale-100"
        >
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 px-1 font-muse text-xl leading-tight sm:text-2xl">{product.name}</h3>
      <p className="mt-1 px-1 text-sm">{cardPrice(product, content)}</p>
    </Link>
  );
}

function CardGrid({ store, products, content }: { store: StoreInfo; products: StoreProduct[]; content: ContentMap }) {
  return (
    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 lg:grid-cols-4"
    >
      {products.map((p) => (
        <MotionLi key={p.id} variants={rise} className="min-w-0">
          <ProductCard store={store} product={p} content={content} />
        </MotionLi>
      ))}
    </MotionUl>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-12 sm:py-20")}>
    <SectionHead title={content["newArrivals.heading"]} link={{ href: shopHref(store), label: content["navbar.shopLabel"] }} />
    {newArrivals.length === 0 ? (
      <p className="text-sm text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <CardGrid store={store} products={newArrivals} content={content} />
    )}
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const heading = content["promoBanner.heading"];
  const image = content["promoBanner.image"];
  return (
    <section className={cn(wrap, "py-12 sm:py-20")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={rise}
        className={cn("grid overflow-hidden rounded-[2rem] bg-primary text-primary-foreground", image && "md:grid-cols-2")}
      >
        <div className={cn("flex flex-col justify-center gap-6 p-7 sm:p-12", !image && "items-center text-center")}>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary-foreground/25 px-3 py-1 text-xs">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            {store.name}
          </span>
          {heading && (
            <h2 className={cn(serifHeading, "max-w-xl text-[clamp(2.2rem,4.2vw,3.75rem)] leading-[1.02]")}>
              <ViewWords text={heading} />
            </h2>
          )}
          {content["promoBanner.subtext"] && (
            <p className="max-w-md whitespace-pre-line text-sm leading-relaxed text-primary-foreground/70">
              {content["promoBanner.subtext"]}
            </p>
          )}
          {content["promoBanner.ctaLabel"] && <PillLink href={shopHref(store)} label={content["promoBanner.ctaLabel"]} tone="light" />}
        </div>
        {image && (
          <div className="relative m-2 min-h-[20rem] overflow-hidden rounded-[1.5rem] sm:m-3">
            <Parallax>
              <Picture src={image} alt={heading || store.name} className="absolute inset-0" sizes="(max-width: 768px) 100vw, 50vw" />
            </Parallax>
          </div>
        )}
      </MotionDiv>
    </section>
  );
};

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className={cn(wrap, "py-12 sm:py-20")}>
    {bestSellers.length === 0 ? (
      <div className="rounded-[2rem] bg-primary p-8 text-primary-foreground sm:p-12">
        <h2 className={cn(serifHeading, "text-4xl sm:text-6xl leading-[1.02]")}>{content["bestSellers.heading"]}</h2>
        <p className="mt-4 text-sm text-primary-foreground/70">{content["bestSellers.empty"]}</p>
      </div>
    ) : (
      <MotionDiv initial="hidden" whileInView="visible" viewport={viewport} variants={rise}>
        <BestSellerShowcase store={store} content={content} products={bestSellers} heading={content["bestSellers.heading"]} />
      </MotionDiv>
    )}
  </section>
);

/** Reviews on an endless, hover-pausable belt. Short lists repeat so the belt is always full;
 * only the first pass is exposed to screen readers. */
const Reviews: SectionComponent = ({ data: { content, reviews } }) => {
  const passes = Math.max(1, Math.ceil(6 / reviews.length));
  const belt = (hidden: boolean) =>
    Array.from({ length: passes }, (_, pass) =>
      reviews.map((r, i) => (
        <li
          key={`${pass}-${i}`}
          aria-hidden={hidden || pass > 0}
          className="mr-3 flex w-[19rem] shrink-0 flex-col justify-between gap-10 rounded-[1.5rem] bg-secondary p-6 text-secondary-foreground sm:w-[24rem] sm:p-8"
        >
          <blockquote className="font-muse text-2xl leading-snug">&ldquo;{r.quote}&rdquo;</blockquote>
          {r.author && (
            <p className="flex items-center gap-3 text-sm">
              <span aria-hidden className="grid size-9 place-items-center rounded-full bg-accent font-muse text-lg text-accent-foreground">
                {r.author.trim().charAt(0).toUpperCase()}
              </span>
              {r.author}
            </p>
          )}
        </li>
      )),
    );
  return (
    <section className="py-12 sm:py-20">
      <div className={wrap}>
        <SectionHead title={content["reviews.heading"]} />
      </div>
      <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max animate-marquee [animation-duration:55s] hover:[animation-play-state:paused]">
          <ul className="flex shrink-0">{belt(false)}</ul>
          <ul aria-hidden className="marquee-clone flex shrink-0">
            {belt(true)}
          </ul>
        </div>
      </div>
    </section>
  );
};

/** The footer plus a giant serif wordmark whose letters rise in one after another. */
const Footer: SectionComponent = ({ data }) => {
  const name = data.content["navbar.logoText"] || data.store.name;
  const letters = Array.from(name);
  return (
    <>
      <StoreFooter data={data} look="muse" />
      <MotionDiv
        aria-hidden
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.045 } } }}
        className="-mt-4 overflow-hidden whitespace-nowrap bg-background px-4 pb-2 text-center font-muse leading-[0.8] text-secondary"
        style={{ fontSize: `min(24vw, ${Math.round(175 / Math.max(letters.length, 4))}vw)` }}
      >
        {letters.map((ch, i) => (
          <MotionSpan key={i} variants={{ hidden: { y: "100%" }, visible: { y: "0%", transition: { duration: 1, ease } } }} className="inline-block">
            {ch === " " ? " " : ch}
          </MotionSpan>
        ))}
      </MotionDiv>
    </>
  );
};

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-6 sm:py-10")}>
        <Link
          href={storeHref(store)}
          className={cn("group inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground", focus)}
        >
          <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-1" />
          {content["product.back"]}
        </Link>

        <div className="mt-6 grid gap-3 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div className="muse-unveil grid gap-3">
            <div className="overflow-hidden rounded-[1.75rem] bg-secondary">
              <ProductImage className="aspect-square lg:aspect-[4/5]" />
            </div>
            <ProductGallery className="grid grid-cols-4 gap-3 [&_button]:rounded-2xl" />
          </div>

          <div style={delay(0.12)} className="muse-unveil rounded-[1.75rem] bg-secondary/60 p-6 sm:p-10 lg:sticky lg:top-24">
            <h1 className={cn(serifHeading, "text-4xl [overflow-wrap:anywhere] sm:text-6xl leading-[1.02]")}>
              <LoadWords text={product.name} start={0.45} />
            </h1>
            <p className="mt-5 text-xl">
              <ProductPrice />
            </p>
            <div className="mt-8">
              <VariantPicker look="muse" labelClassName="mb-2 block text-xs uppercase tracking-[0.16em] text-muted-foreground" />
            </div>
            <StockStatus look="dot" className="mt-6 block" />
            <div className="mt-8">
              <AddToCart look="muse" basePath={store.basePath} />
            </div>
            {product.description && (
              <div className="mt-10 border-t border-foreground/10 pt-8">
                <h2 className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{content["product.descriptionHeading"]}</h2>
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{product.description}</p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-20 sm:mt-28">
            <SectionHead title={content["product.relatedHeading"]} />
            <CardGrid store={store} products={related} content={content} />
          </section>
        )}
      </div>
    </ProductProvider>
  );
};

const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <CardGrid store={data.store} products={products} content={data.content} />
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16",
  catalogContainer: cn(wrap, "py-12 sm:py-16"),
  title: cn(serifHeading, "text-5xl sm:text-6xl leading-[1.02]"),
  subtitle: "text-sm text-muted-foreground",
  chip: "rounded-full border border-foreground/15 px-4 py-2 text-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground",
  panel: "mt-8 rounded-[1.5rem] bg-secondary/60 p-6 sm:p-8",
};

export const museTemplate: Template = {
  ProductGrid,
  filterLayout: "sidebar",
  pageStyle,
  homeSectionOrder: ["hero", "brandStory", "featuredCategories", "newArrivals", "promoBanner", "bestSellers", "reviews"],
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
