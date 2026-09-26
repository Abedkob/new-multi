import Link from "next/link";
import type { ReactNode } from "react";
import type { Variants } from "motion/react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Search } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionLi, MotionP, MotionUl } from "../motion";
import { StoreFooter } from "../store-footer";
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
import { CartLink, SearchBox } from "../nav-client";
import { AddToCart, ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker } from "../product-client";
import type { SectionComponent, StoreInfo, StoreProduct, Template } from "../types";

/**
 * "Atlas": a Swiss-style index. Everything sits on a visible hairline grid (cells share 1px
 * borders, no gaps, no rounded corners), labels and numbers are set in monospace, and headings
 * are tight, heavy uppercase. Layouts lean on asymmetry: a split hero, a bento category mosaic,
 * a ranked best-seller ledger and a gapless photo strip. Colors come only from theme tokens.
 */

const wrap = "mx-auto max-w-[1400px] px-4 sm:px-6";
const mono = "font-mono text-[11px] uppercase tracking-[0.14em]";
const display = "font-semibold uppercase leading-[0.9] tracking-tighter text-balance";
const squareCta =
  "group inline-flex h-12 items-center gap-4 border border-foreground bg-foreground pl-5 pr-2 text-background transition-colors hover:bg-background hover:text-foreground";
const ctaArrow = "grid size-8 place-items-center bg-background text-foreground transition-colors group-hover:bg-foreground group-hover:text-background";

/**
 * "Atlas"'s animation language: a hard-edged wipe (content is uncovered top to bottom by a
 * clip-path) instead of a fade or blur — like a sheet being printed line by line.
 */
const ease = [0.65, 0, 0.35, 1] as const;
const wipe: Variants = {
  hidden: { clipPath: "inset(0 0 100% 0)", opacity: 0 },
  visible: { clipPath: "inset(0 0 0% 0)", opacity: 1, transition: { duration: 0.7, ease } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};
// A tiny threshold: a long product grid on a phone can be several screens tall.
const viewport = { once: true, amount: 0.05 } as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** A heading row ruled top and bottom: the title, a mono item count, and an optional link. */
function SectionHead({ title, count, aside }: { title: string; count?: number; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 border-y border-foreground py-4">
      <h2 className={cn(display, "flex items-start gap-3 text-3xl sm:text-4xl lg:text-5xl")}>
        {title}
        {count !== undefined && count > 0 && (
          <sup className={cn(mono, "mt-1 font-normal tracking-normal text-muted-foreground")}>({pad(count)})</sup>
        )}
      </h2>
      {aside}
    </div>
  );
}

function ShopAll({ store, content }: { store: StoreInfo; content: ContentMap }) {
  return (
    <Link href={shopHref(store)} className={cn(mono, "group hidden shrink-0 items-center gap-2 pb-1 hover:text-primary sm:inline-flex")}>
      {content["navbar.shopLabel"]}
      <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * Cells of a gapless grid: the list draws the top/left rules, every cell its own right/bottom,
 * so a half-empty last row never shows a gray block.
 */
const cellGrid = "grid border-l border-t border-border";
const cell = "border-b border-r border-border bg-background";

const Announcement: SectionComponent = ({ data: { store, content } }) => (
  <div className={cn(mono, "bg-foreground text-background")}>
    <div className={cn(wrap, "flex h-9 items-center justify-center gap-6 md:justify-between")}>
      <span className="hidden truncate opacity-60 md:block">{store.name}</span>
      <p className="truncate text-center">{content["announcement.text"]}</p>
      <Link href={shopHref(store)} className="hidden items-center gap-1.5 opacity-60 transition-opacity hover:opacity-100 md:inline-flex">
        {content["navbar.shopLabel"]} <ArrowRight className="size-3" />
      </Link>
    </div>
  </div>
);

const navLink = cn(mono, "flex h-full items-center border-b-2 border-transparent transition-colors hover:border-foreground");

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="border-b border-foreground bg-background">
      <div className={cn(wrap, "flex h-16 items-stretch")}>
        <div className="flex items-center border-r border-border pr-3 md:hidden">
          <StoreMenuButton data={data} className="-ml-2" />
        </div>
        <div className="flex min-w-0 items-center px-4 md:border-r md:border-border md:pl-0 md:pr-8">
          <StoreBrand
            store={store}
            content={content}
            className="min-w-0 truncate text-xl font-bold uppercase tracking-tighter"
            logoClassName="h-8"
          />
        </div>
        <nav className="hidden min-w-0 flex-1 items-stretch gap-7 overflow-hidden px-8 lg:flex">
          <Link href={shopHref(store)} className={navLink}>
            {content["navbar.shopLabel"]}
          </Link>
          {categoryTiles.slice(0, 5).map((c) => (
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
        <div className="ml-auto flex items-stretch">
          <div className="hidden items-center border-l border-border px-4 md:flex">
            <SearchBox
              slug={store.slug}
              basePath={store.basePath}
              placeholder={content["search.placeholder"]}
              buttonLabel={content["search.button"]}
              inputClassName="h-9 w-40 rounded-none border-0 bg-transparent px-0 font-mono text-xs uppercase tracking-wider shadow-none placeholder:text-muted-foreground focus-visible:ring-0 xl:w-56"
              buttonClassName="sr-only"
            />
          </div>
          <StoreSearchButton data={data} look="atlas" className="flex items-center border-l border-border px-4 md:hidden">
            <Search className="size-5" />
          </StoreSearchButton>
          <div className="flex items-center border-l border-border pl-4 sm:px-5">
            <CartLink basePath={store.basePath} className="font-mono text-xs transition-colors hover:text-primary [&_svg]:size-5" />
          </div>
        </div>
      </div>
    </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);
  const showText = visibility.heroText;
  return (
    <section className="border-b border-foreground">
      <div className={cn(wrap, "grid", hasImage && showText && "lg:grid-cols-12")}>
        {showText && (
          <MotionDiv
            initial="hidden"
            animate="visible"
            variants={stagger}
            className={cn(
              "flex flex-col justify-between gap-12 py-10 sm:py-14",
              hasImage ? "order-2 lg:order-1 lg:col-span-5 lg:border-r lg:border-border lg:py-16 lg:pr-10" : "py-20 lg:py-28",
            )}
          >
            <MotionP variants={wipe} className={cn(mono, "flex items-center gap-3 text-muted-foreground")}>
              <span aria-hidden className="size-2 bg-primary" />
              {store.name}
            </MotionP>
            <div>
              <MotionH1
                variants={wipe}
                className={cn(display, "text-5xl sm:text-6xl xl:text-7xl", !hasImage && "max-w-5xl lg:text-8xl")}
              >
                {content["hero.headline"]}
              </MotionH1>
              {content["hero.subtext"] && (
                <MotionP variants={wipe} className="mt-6 max-w-md whitespace-pre-line text-base leading-relaxed text-muted-foreground">
                  {content["hero.subtext"]}
                </MotionP>
              )}
            </div>
            {content["hero.ctaLabel"] && (
              <MotionDiv variants={wipe} className="flex flex-wrap items-center gap-6">
                <Link href={sectionHref(store, "new-arrivals")} className={squareCta}>
                  <span className={mono}>{content["hero.ctaLabel"]}</span>
                  <span className={ctaArrow}>
                    <ArrowRight className="size-4" />
                  </span>
                </Link>
                <Link href={shopHref(store)} className={cn(mono, "underline-offset-4 hover:underline")}>
                  {content["navbar.shopLabel"]}
                </Link>
              </MotionDiv>
            )}
          </MotionDiv>
        )}

        {hasImage && (
          <MotionDiv
            initial={{ clipPath: "inset(0 0 0 100%)" }}
            animate={{ clipPath: "inset(0 0 0 0%)" }}
            transition={{ duration: 1.1, ease }}
            className={cn(
              "relative -mx-4 min-h-[60vw] sm:-mx-6 lg:mx-0 lg:min-h-[640px]",
              showText ? "order-1 lg:order-2 lg:col-span-7 lg:-mr-6" : "min-h-[70vh]",
            )}
          >
            <HeroPicture content={content} alt={store.name} className="absolute inset-0" />
            <span className={cn(mono, "absolute bottom-0 left-0 bg-background px-3 py-2")}>
              {store.name} / {pad(1)}
            </span>
          </MotionDiv>
        )}
      </div>
    </section>
  );
};

/** A bento mosaic: the first category takes a 2×2 block, the rest fill single cells. */
const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-16 lg:py-24")}>
    <SectionHead title={content["featuredCategories.heading"]} count={categoryTiles.length} />
    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className={cn(cellGrid, "mt-8 grid-cols-2 md:grid-cols-4 [grid-auto-flow:dense]")}
    >
      {categoryTiles.map((c, i) => {
        const lead = i === 0 && categoryTiles.length > 2;
        return (
          <MotionLi key={c.id} variants={wipe} className={cn(cell, lead && "col-span-2 row-span-2")}>
            <Link href={c.href} className="group relative flex h-full flex-col">
              <div className={cn("relative flex-1 overflow-hidden bg-secondary", lead ? "min-h-[20rem] md:min-h-0" : "aspect-square")}>
                <Picture
                  src={c.image}
                  alt={c.label}
                  className="absolute inset-0"
                  imgClassName="transition-transform duration-700 group-hover:scale-105"
                  sizes={lead ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 768px) 50vw, 25vw"}
                />
                <span className={cn(mono, "absolute left-0 top-0 bg-background px-2 py-1")}>{pad(i + 1)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-3 transition-colors group-hover:bg-foreground group-hover:text-background sm:px-4">
                <span className={cn("truncate font-semibold uppercase tracking-tight", lead ? "text-xl sm:text-2xl" : "text-sm sm:text-base")}>
                  {c.label}
                </span>
                <ArrowUpRight className="size-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
            </Link>
          </MotionLi>
        );
      })}
    </MotionUl>
  </section>
);

/** A grid cell: index + status on a mono top line, photo, then name and price on a ruled footer. */
function ProductCard({
  store,
  product,
  content,
  index,
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  index: number;
}) {
  const second = product.images.find((im) => im.url && im.url !== product.imageUrl)?.url ?? "";
  return (
    <Link href={productHref(store, product)} className="group flex h-full flex-col">
      <div className={cn(mono, "flex items-center justify-between px-3 py-2 text-muted-foreground")}>
        <span>{pad(index)}</span>
        {!product.inStock ? (
          <span className="text-foreground line-through decoration-primary">{content["product.outOfStock"]}</span>
        ) : product.isBestSeller ? (
          <span aria-hidden className="size-1.5 bg-primary" />
        ) : null}
      </div>
      <div className="relative mx-3 aspect-[4/5] overflow-hidden bg-secondary">
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="absolute inset-0"
          imgClassName={cn("object-contain transition duration-500", second && "group-hover:opacity-0")}
        />
        {second && (
          <Picture
            src={second}
            alt=""
            className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            imgClassName="object-contain"
          />
        )}
      </div>
      <div className="mt-3 flex flex-1 items-start justify-between gap-3 border-t border-border px-3 py-3 transition-colors group-hover:bg-secondary">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</h3>
        <span className="shrink-0 font-mono text-sm tabular-nums">{cardPrice(product, content)}</span>
      </div>
    </Link>
  );
}

function ProductCells({
  store,
  content,
  products,
  className,
}: {
  store: StoreInfo;
  content: ContentMap;
  products: StoreProduct[];
  className: string;
}) {
  return (
    <MotionUl initial="hidden" whileInView="visible" viewport={viewport} variants={stagger} className={cn(cellGrid, className)}>
      {products.map((p, i) => (
        <MotionLi key={p.id} variants={wipe} className={cell}>
          <ProductCard store={store} product={p} content={content} index={i + 1} />
        </MotionLi>
      ))}
    </MotionUl>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-16 lg:py-24")}>
    <SectionHead title={content["newArrivals.heading"]} count={newArrivals.length} aside={<ShopAll store={store} content={content} />} />
    {newArrivals.length === 0 ? (
      <p className={cn(mono, "py-10 text-muted-foreground")}>{content["newArrivals.empty"]}</p>
    ) : (
      <ProductCells store={store} content={content} products={newArrivals} className="mt-8 grid-cols-2 md:grid-cols-3 xl:grid-cols-4" />
    )}
  </section>
);

/** A ranked ledger: a sticky title column beside numbered rows (rank, thumb, name, price). */
const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="border-y border-foreground bg-secondary text-secondary-foreground">
    <div className={cn(wrap, "grid gap-10 py-16 lg:grid-cols-12 lg:py-24")}>
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-28">
          <h2 className={cn(display, "text-4xl sm:text-5xl lg:text-6xl")}>{content["bestSellers.heading"]}</h2>
          <p className={cn(mono, "mt-6 opacity-60")}>
            {pad(bestSellers.length)} / {content["navbar.shopLabel"]}
          </p>
          <Link href={shopHref(store)} className={cn(squareCta, "mt-8")}>
            <span className={mono}>{content["navbar.shopLabel"]}</span>
            <span className={ctaArrow}>
              <ArrowRight className="size-4" />
            </span>
          </Link>
        </div>
      </div>
      <div className="lg:col-span-8">
        {bestSellers.length === 0 ? (
          <p className={cn(mono, "opacity-70")}>{content["bestSellers.empty"]}</p>
        ) : (
          <MotionUl initial="hidden" whileInView="visible" viewport={viewport} variants={stagger} className="border-t border-current/20">
            {bestSellers.map((p, i) => (
              <MotionLi key={p.id} variants={wipe} className="border-b border-current/20">
                <Link
                  href={productHref(store, p)}
                  className="group grid grid-cols-[2.5rem_4rem_minmax(0,1fr)_auto] items-center gap-4 py-4 transition-colors hover:bg-background hover:text-foreground sm:grid-cols-[3.5rem_5rem_minmax(0,1fr)_auto_auto] sm:gap-6 sm:px-3"
                >
                  <span className="font-mono text-2xl font-light tabular-nums opacity-50 sm:text-3xl">{pad(i + 1)}</span>
                  <div className="relative aspect-square overflow-hidden bg-background">
                    <Picture src={p.imageUrl} alt={p.name} className="absolute inset-0" imgClassName="object-contain" sizes="80px" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold uppercase tracking-tight sm:text-lg">{p.name}</h3>
                    {!p.inStock && <p className={cn(mono, "mt-1 opacity-60")}>{content["product.outOfStock"]}</p>}
                  </div>
                  <span className="font-mono text-sm tabular-nums">{cardPrice(p, content)}</span>
                  <ArrowUpRight className="hidden size-5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:block" />
                </Link>
              </MotionLi>
            ))}
          </MotionUl>
        )}
      </div>
    </div>
  </section>
);

/** Full-bleed photo with the offer set on a square card pinned to its corner. */
const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  const card = (
    <MotionDiv
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className={cn(
        image
          ? "relative w-full max-w-xl border border-foreground bg-background p-6 text-foreground sm:p-10"
          : "grid w-full gap-8 lg:grid-cols-12 lg:items-end",
      )}
    >
      <MotionDiv variants={wipe} className={cn(!image && "lg:col-span-8")}>
        <h2 className={cn(display, image ? "text-4xl sm:text-5xl" : "text-5xl sm:text-7xl lg:text-8xl")}>
          {content["promoBanner.heading"]}
        </h2>
      </MotionDiv>
      <MotionDiv variants={wipe} className={cn(image ? "mt-6" : "lg:col-span-4")}>
        {content["promoBanner.subtext"] && (
          <p className={cn("whitespace-pre-line leading-relaxed", image ? "text-muted-foreground" : "opacity-75")}>
            {content["promoBanner.subtext"]}
          </p>
        )}
        {content["promoBanner.ctaLabel"] && (
          <Link
            href={sectionHref(store, "new-arrivals")}
            className={cn(
              "group mt-8 inline-flex h-12 items-center gap-4 border pl-5 pr-2 transition-colors",
              image
                ? "border-foreground bg-foreground text-background hover:bg-background hover:text-foreground"
                : "border-primary-foreground hover:bg-primary-foreground hover:text-primary",
            )}
          >
            <span className={mono}>{content["promoBanner.ctaLabel"]}</span>
            <ArrowRight className="mr-2 size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        )}
      </MotionDiv>
    </MotionDiv>
  );

  if (!image) {
    return (
      <section className="bg-primary text-primary-foreground">
        <div className={cn(wrap, "py-20 lg:py-28")}>{card}</div>
      </section>
    );
  }
  return (
    <section className="relative flex min-h-[80vh] items-end overflow-hidden">
      <Picture src={image} alt={content["promoBanner.heading"]} className="absolute inset-0" sizes="100vw" />
      <div className={cn(wrap, "relative w-full py-6 sm:py-10")}>{card}</div>
    </section>
  );
};

/** Sticky heading on the left; photo and a two-column body on the right, split by a rule. */
const BrandStory: SectionComponent = ({ data: { store, content, pages } }) => {
  const image = content["brandStory.image"];
  const about = pages.find((pg) => pg.slug === "about");
  return (
    <section className={cn(wrap, "py-16 lg:py-24")}>
      <div className="grid gap-10 border-t border-foreground pt-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <p className={cn(mono, "mb-6 flex items-center gap-3 text-muted-foreground")}>
              <span aria-hidden className="size-2 bg-primary" />
              {store.name}
            </p>
            {content["brandStory.heading"] && (
              <h2 className={cn(display, "text-4xl sm:text-5xl lg:text-6xl")}>{content["brandStory.heading"]}</h2>
            )}
            {about && (
              <Link href={about.href} className={cn(mono, "group mt-8 inline-flex items-center gap-2 border-b border-foreground pb-1 hover:text-primary")}>
                {about.label}
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
        </div>
        <MotionDiv
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="lg:col-span-7 lg:border-l lg:border-border lg:pl-10"
        >
          {image && (
            <MotionDiv variants={wipe} className="relative aspect-[16/10] overflow-hidden bg-secondary">
              <Picture src={image} alt={store.name} className="absolute inset-0" sizes="(max-width: 1024px) 100vw, 55vw" />
            </MotionDiv>
          )}
          {content["brandStory.body"] && (
            <MotionP
              variants={wipe}
              className={cn(
                "whitespace-pre-line text-base leading-relaxed text-muted-foreground md:columns-2 md:gap-10",
                image && "mt-8",
              )}
            >
              {content["brandStory.body"]}
            </MotionP>
          )}
        </MotionDiv>
      </div>
    </section>
  );
};

/** A grid of quote cells; the first review is set large across a double cell. */
const Reviews: SectionComponent = ({ data: { content, reviews } }) => {
  const shown = reviews.slice(0, 5);
  return (
    <section className={cn(wrap, "py-16 lg:py-24")}>
      <SectionHead title={content["reviews.heading"]} count={reviews.length} />
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(cellGrid, "mt-8 md:grid-cols-2 lg:grid-cols-4")}
      >
        {shown.map((r, i) => {
          const lead = i === 0 && shown.length > 1;
          return (
            <MotionLi
              key={i}
              variants={wipe}
              className={cn(cell, "flex flex-col justify-between gap-10 p-6 sm:p-8", lead && "bg-foreground text-background md:col-span-2 lg:row-span-2")}
            >
              <div>
                <span className={cn(mono, lead ? "opacity-60" : "text-muted-foreground")}>
                  {pad(i + 1)} / {pad(shown.length)}
                </span>
                <blockquote
                  className={cn(
                    "mt-5 leading-snug",
                    lead ? "text-2xl font-semibold uppercase tracking-tight sm:text-3xl lg:text-4xl" : "text-base",
                  )}
                >
                  &ldquo;{r.quote}&rdquo;
                </blockquote>
              </div>
              {r.author && (
                <p className={cn(mono, "flex items-center gap-3")}>
                  <span aria-hidden className={cn("h-px w-8", lead ? "bg-background" : "bg-foreground")} />
                  {r.author}
                </p>
              )}
            </MotionLi>
          );
        })}
      </MotionUl>
    </section>
  );
};

const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="atlas" />;

/** A spec sheet: the photo in a ruled frame on the left, ruled rows of details on the right. */
const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  const row = "border-b border-border py-6";
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-6 lg:py-10")}>
        <div className={cn(mono, "flex items-center justify-between gap-4 border-b border-foreground pb-3")}>
          <Link href={storeHref(store)} className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-3.5" /> {content["product.back"]}
          </Link>
          <Link href={shopHref(store)} className="text-muted-foreground transition-colors hover:text-foreground">
            {content["navbar.shopLabel"]}
          </Link>
        </div>

        <div className="grid lg:grid-cols-12">
          <div className="py-6 lg:col-span-7 lg:border-r lg:border-border lg:pr-8 lg:py-8">
            <div className="border border-border bg-secondary">
              <ProductImage className="aspect-square sm:aspect-[5/4]" />
            </div>
            <ProductGallery className="mt-3 gap-3 [&_button]:rounded-none" />
          </div>

          <div className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start lg:pl-8">
            <div className={cn(row, "lg:pt-8")}>
              <h1 className={cn(display, "text-4xl sm:text-5xl")}>{product.name}</h1>
              <p className="mt-5 font-mono text-2xl tabular-nums">
                <ProductPrice />
              </p>
            </div>
            <div className={row}>
              <VariantPicker look="atlas" labelClassName={cn(mono, "mb-2 block font-normal")} />
              <StockStatus look="dot" className={cn(mono, "block [&_span]:text-[11px]", "mt-5")} />
            </div>
            <div className={row}>
              <AddToCart look="atlas" basePath={store.basePath} />
            </div>
            {product.description && (
              <dl className={cn(row, "grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]")}>
                <dt className={cn(mono, "text-muted-foreground")}>{content["product.descriptionHeading"]}</dt>
                <dd className="whitespace-pre-line text-sm leading-relaxed">{product.description}</dd>
              </dl>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-16 lg:mt-24">
            <SectionHead title={content["product.relatedHeading"]} count={related.length} />
            <ProductCells store={store} content={content} products={related} className="mt-8 grid-cols-2 lg:grid-cols-4" />
          </section>
        )}
      </div>
    </ProductProvider>
  );
};

// The catalog puts its filters above the grid for this template, so the grid spans the full width.
const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <ProductCells store={data.store} content={data.content} products={products} className="grid-cols-2 md:grid-cols-3 xl:grid-cols-4" />
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:py-20",
  catalogContainer: "mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:py-20",
  title: "text-4xl font-semibold uppercase leading-[0.9] tracking-tighter sm:text-6xl",
  subtitle: "mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground",
  chip: "rounded-none border border-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors hover:bg-foreground hover:text-background",
  panel: "mt-10 border border-foreground p-6",
};

export const atlasTemplate: Template = {
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
