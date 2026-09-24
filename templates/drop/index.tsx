import Link from "next/link";
import type { Variants } from "motion/react";
import { ArrowUpRight, Search } from "lucide-react";
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
  searchHref,
  sectionHref,
  shopHref,
  storeHref,
} from "../shared";
import { CartLink } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import type { SectionComponent, StoreInfo, StoreProduct, Template } from "../types";
import { CategoryShowcase } from "./category-showcase-client";
import { Spotlight } from "./spotlight-client";

/**
 * "Drop": dark by default, one neon accent, heavy poster type. Structurally the odd one out —
 * no product grids or carousels anywhere. Categories are a hover-swapped directory, new arrivals
 * a single lookbook spotlight with a thumbnail rail, best sellers a list with oversized watermark
 * numerals, the promo banner an infinite marquee behind a static CTA. Every home section carries
 * a running chapter mark (01-07) as its one consistent motif.
 */

const wrap = "mx-auto max-w-[1400px] px-5 sm:px-8";
const display = "font-black uppercase leading-[0.88] tracking-tight";
const navLink = "text-xs font-bold uppercase tracking-[0.15em] text-foreground/70 transition-colors hover:text-foreground";
const solidCta =
  "inline-flex h-14 items-center gap-3 bg-primary px-8 text-xs font-bold uppercase tracking-[0.2em] text-primary-foreground transition hover:opacity-90";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};
// A tiny threshold: a long product grid on a phone can be several screens tall, so "25% in
// view" would never be reached and the grid would stay invisible until scrolled far enough.
const viewport = { once: true, amount: 0.05 } as const;

/** The running "chapter" numeral + accent dot that opens every home section. Decorative. */
function ChapterMark({ n }: { n: number }) {
  return (
    <span aria-hidden className="mb-4 flex items-center gap-3 font-mono text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-accent" />
      {String(n).padStart(2, "0")}
    </span>
  );
}

const Announcement: SectionComponent = ({ data }) => (
  <div className="border-b border-border bg-primary px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-primary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="w-full border-b border-border bg-background">
      <div className={cn(wrap, "flex items-center justify-between gap-6 py-5")}>
        <div className="flex min-w-0 items-center gap-3">
          <StoreMenuButton data={data} className="-ml-2 lg:hidden" />
          <StoreBrand store={store} content={content} className={cn(display, "truncate text-xl sm:text-2xl")} logoClassName="h-8" />
        </div>

        <nav className="hidden items-center gap-8 lg:flex">
          <Link href={shopHref(store)} className={navLink}>
            {content["navbar.shopLabel"]}
          </Link>
          {categoryTiles.slice(0, 5).map((c) => (
            <Link key={c.id} href={c.href} className={navLink}>
              {c.label}
            </Link>
          ))}
          {pages.map((pg) => (
            <Link key={pg.slug} href={pg.href} className={navLink}>
              {pg.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-4">
          <Link href={searchHref(store)} aria-label={content["search.button"]} className="text-foreground/70 transition-colors hover:text-foreground">
            <Search className="size-5" />
          </Link>
          <CartLink
            basePath={store.basePath}
            className="flex h-9 min-w-9 items-center justify-center gap-1 bg-accent px-2.5 text-xs font-bold text-accent-foreground [&_svg]:size-4"
          />
        </div>
      </div>
    </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);
  return (
    <section className="relative flex min-h-[92vh] flex-col justify-end overflow-hidden bg-secondary">
      {hasImage && (
        <div className="absolute inset-0 z-0">
          <HeroPicture content={content} alt={store.name} className="h-full w-full" />
        </div>
      )}
      {/* A solid gradient into the theme background at the foot of the hero, so the headline
          reads at full contrast whether or not there's a photo behind it. */}
      <div className="absolute inset-x-0 bottom-0 z-0 h-2/3 bg-gradient-to-t from-background via-background/40 to-transparent" />

      {visibility.heroText && (
        <MotionDiv initial="hidden" animate="visible" variants={stagger} className={cn(wrap, "relative z-10 w-full pb-14 pt-40 sm:pb-20")}>
          <ChapterMark n={1} />
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <MotionH1 variants={fadeUp} className={cn(display, "max-w-4xl text-[clamp(2.75rem,9vw,8rem)]")}>
              {content["hero.headline"]}
            </MotionH1>
            <MotionDiv variants={fadeUp} className="max-w-sm lg:pb-3">
              {content["hero.subtext"] && (
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">{content["hero.subtext"]}</p>
              )}
              {content["hero.ctaLabel"] && (
                <Link href={sectionHref(store, "new-arrivals")} className={cn(solidCta, "mt-6")}>
                  {content["hero.ctaLabel"]}
                  <ArrowUpRight className="size-4" />
                </Link>
              )}
            </MotionDiv>
          </div>
        </MotionDiv>
      )}
    </section>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-24 sm:py-32")}>
    <ChapterMark n={2} />
    <h2 className={cn(display, "mb-14 text-4xl sm:text-6xl")}>{content["featuredCategories.heading"]}</h2>
    <CategoryShowcase categories={categoryTiles} />
  </section>
);

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className="border-t border-border bg-secondary/40">
    <div className={cn(wrap, "py-24 sm:py-32")}>
      <ChapterMark n={3} />
      <h2 className={cn(display, "mb-14 text-4xl sm:text-6xl")}>{content["newArrivals.heading"]}</h2>
      {newArrivals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{content["newArrivals.empty"]}</p>
      ) : (
        <Spotlight store={store} products={newArrivals} content={content} badgeLabel={content["newArrivals.heading"]} />
      )}
    </div>
  </section>
);

function BestRow({ store, product, content, index }: { store: StoreInfo; product: StoreProduct; content: ContentMap; index: number }) {
  const href = productHref(store, product);
  return (
    <li className="relative overflow-hidden border-b border-border">
      <span
        aria-hidden
        className={cn(display, "pointer-events-none absolute -left-1 top-1/2 -translate-y-1/2 text-[22vw] text-foreground/[0.04] sm:text-[9rem]")}
      >
        {String(index).padStart(2, "0")}
      </span>
      <Link href={href} className="group relative flex items-center gap-5 py-6 sm:gap-8 sm:py-8">
        <span className="relative size-20 shrink-0 overflow-hidden bg-secondary sm:size-24">
          <Picture src={product.imageUrl} alt="" className="size-full" imgClassName="object-contain p-2 transition-transform duration-500 group-hover:scale-105" />
        </span>
        <span className="min-w-0 flex-1 truncate text-2xl font-black uppercase leading-tight tracking-tight transition-opacity group-hover:opacity-70 sm:text-4xl">
          {product.name}
        </span>
        <span className="shrink-0 text-lg font-bold sm:text-2xl">{cardPrice(product, content)}</span>
      </Link>
    </li>
  );
}

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className={cn(wrap, "py-24 sm:py-32")}>
    <ChapterMark n={4} />
    <h2 className={cn(display, "mb-14 text-4xl sm:text-6xl")}>{content["bestSellers.heading"]}</h2>
    {bestSellers.length === 0 ? (
      <p className="text-sm text-muted-foreground">{content["bestSellers.empty"]}</p>
    ) : (
      <ul className="border-t border-border">
        {bestSellers.map((p, i) => (
          <BestRow key={p.id} store={store} product={p} content={content} index={i + 1} />
        ))}
      </ul>
    )}
  </section>
);

/** An infinite two-copy ticker; the two copies are identical, so sliding by exactly one width loops seamlessly. */
function Marquee({ text }: { text: string }) {
  const items = Array.from({ length: 8 }, (_, i) => (
    <span key={i} className="whitespace-nowrap">
      {text} <span className="text-background/25">/</span>
    </span>
  ));
  return (
    <div aria-hidden className="overflow-hidden py-10 sm:py-16">
      <div className={cn(display, "flex w-max animate-marquee items-center gap-10 text-6xl sm:text-8xl")}>
        <span className="flex shrink-0 items-center gap-10">{items}</span>
        <span className="marquee-clone flex shrink-0 items-center gap-10">{items}</span>
      </div>
    </div>
  );
}

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <section className="relative overflow-hidden border-y border-border bg-foreground text-background">
    <div className="relative flex min-h-[46vh] flex-col items-center justify-center sm:min-h-[54vh]">
      <div className="absolute inset-0 flex items-center opacity-40">
        <Marquee text={content["promoBanner.heading"]} />
      </div>
      <div className={cn(wrap, "relative z-10 flex flex-col items-center gap-6 text-center")}>
        <h2 className="sr-only">{content["promoBanner.heading"]}</h2>
        {content["promoBanner.subtext"] && (
          <p className="max-w-lg whitespace-pre-line text-sm text-background/85 sm:text-base">{content["promoBanner.subtext"]}</p>
        )}
        {content["promoBanner.ctaLabel"] && (
          <Link
            href={sectionHref(store, "new-arrivals")}
            className="inline-flex h-14 items-center gap-3 bg-background px-10 text-xs font-bold uppercase tracking-[0.2em] text-foreground transition hover:opacity-90"
          >
            {content["promoBanner.ctaLabel"]}
          </Link>
        )}
      </div>
    </div>
  </section>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-24 sm:py-32")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn("grid gap-14", image ? "lg:grid-cols-2 lg:items-center lg:gap-20" : "mx-auto max-w-3xl text-center")}
      >
        {image && (
          <MotionDiv variants={fadeUp} className="order-first aspect-[4/5] overflow-hidden bg-secondary lg:order-last">
            <Picture src={image} alt={store.name} className="h-full w-full" imgClassName="object-cover" />
          </MotionDiv>
        )}
        <div>
          <ChapterMark n={6} />
          {content["brandStory.heading"] && (
            <MotionH2 variants={fadeUp} className={cn(display, "text-4xl sm:text-6xl")}>
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          {content["brandStory.body"] && (
            <MotionP variants={fadeUp} className="mt-6 whitespace-pre-line text-sm leading-relaxed text-muted-foreground sm:text-base">
              {content["brandStory.body"]}
            </MotionP>
          )}
        </div>
      </MotionDiv>
    </section>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="border-t border-border">
    <div className={cn(wrap, "py-24 sm:py-32")}>
      <ChapterMark n={7} />
      <h2 className={cn(display, "mb-14 text-4xl sm:text-6xl")}>{content["reviews.heading"]}</h2>
      <MotionDiv initial="hidden" whileInView="visible" viewport={viewport} variants={stagger} className="grid gap-16 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r, i) => (
          <MotionDiv key={i} variants={fadeUp} className="flex flex-col gap-5">
            <span aria-hidden className={cn(display, "text-6xl text-accent")}>
              &rdquo;
            </span>
            <blockquote className="text-lg leading-relaxed">{r.quote}</blockquote>
            {r.author && <p className="mt-auto font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{r.author}</p>}
          </MotionDiv>
        ))}
      </MotionDiv>
    </div>
  </section>
);

const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="drop" />;

function ProductCard({ store, product, content }: { store: StoreInfo; product: StoreProduct; content: ContentMap }) {
  const href = productHref(store, product);
  return (
    <MotionLi variants={fadeUp} className="h-full">
      <Link href={href} className="group block h-full">
        <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full"
            imgClassName="object-contain p-6 transition-transform duration-500 group-hover:scale-105"
          />
        </div>
        <div className="mt-4">
          <h3 className="line-clamp-1 text-lg font-black uppercase tracking-tight text-foreground">{product.name}</h3>
          <p className="mt-1 text-sm font-bold text-muted-foreground">{cardPrice(product, content)}</p>
        </div>
      </Link>
    </MotionLi>
  );
}

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-12 sm:py-16")}>
        <Link href={storeHref(store)} className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground">
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="grid gap-4">
            <div className="overflow-hidden bg-secondary">
              <ProductImage className="aspect-square" />
            </div>
            <ProductGallery className="grid grid-cols-4 gap-4 [&_button]:rounded-none" />
          </div>
          <div className="lg:pt-4">
            <h1 className={cn(display, "text-4xl sm:text-5xl")}>{product.name}</h1>
            <p className="mt-4 text-2xl font-bold">
              <ProductPrice />
            </p>
            <div className="mt-8">
              <VariantPicker look="drop" labelClassName="mb-3 block text-xs font-bold uppercase tracking-[0.15em]" />
            </div>
            <StockStatus look="dot" className="mt-6 block" />
            <div className="mt-8">
              <AddToCart look="drop" basePath={store.basePath} />
            </div>
            {product.description && (
              <div className="mt-12 border-t border-border pt-8">
                <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">{content["product.descriptionHeading"]}</h2>
                <p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">{product.description}</p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-28">
            <h2 className={cn(display, "mb-12 text-3xl sm:text-4xl")}>{content["product.relatedHeading"]}</h2>
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4"
            >
              {related.map((p) => (
                <ProductCard key={p.id} store={store} product={p} content={content} />
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
    className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-3xl px-5 py-16 sm:px-8",
  catalogContainer: cn(wrap, "py-16"),
  title: cn(display, "text-4xl sm:text-5xl"),
  subtitle: "text-sm text-muted-foreground",
  chip: "border border-border px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors hover:bg-secondary",
  panel: "mt-8 border border-border p-8 bg-card",
};

export const dropTemplate: Template = {
  ProductGrid,
  filterLayout: "top",
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
