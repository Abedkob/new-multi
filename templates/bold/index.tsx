import Link from "next/link";
import type { Variants } from "motion/react";
import { buttonVariants } from "@/components/ui/button";
import type { ContentMap } from "@/lib/content";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionUl } from "../motion";
import { Picture, StoreBrand, cardPrice, productHref, sectionHref } from "../shared";
import { CartLink, SearchBox } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import type {
  SectionComponent,
  StoreInfo,
  StoreProduct,
  Template,
} from "../types";

/**
 * "Bold": Neo-brutalist theme featuring full-bleed color blocks, huge uppercase type,
 * hard 2px/4px borders, hard offset shadows, and high-impact imagery.
 * All color references strictly leverage design system theme tokens.
 */

const display = "font-black uppercase leading-[0.88] tracking-tighter";
const wrap = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8";

const bigCta = cn(
  buttonVariants({ size: "lg" }),
  "h-14 rounded-none border-2 border-foreground px-8 text-base font-black uppercase tracking-widest transition-all hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[4px_4px_0_0_var(--color-foreground)] active:translate-x-0 active:translate-y-0 active:shadow-none",
);

/**
 * "Bold"'s animation language: punchy spring physics with a little overshoot, not an eased
 * fade — matches the neo-brutalist hard-shadow, high-impact look. Hero/brand-story images
 * slide in from the side opposite their text for a "snap into place" feel.
 */
const slideUp: Variants = {
  hidden: { opacity: 0, y: 48 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 20 } },
};
const slideInRight: Variants = {
  hidden: { opacity: 0, x: 60 },
  visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 220, damping: 22, delay: 0.15 } },
};
const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -60 },
  visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 220, damping: 22, delay: 0.15 } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.02 } },
};
const viewport = { once: true, amount: 0.2 } as const;

const Announcement: SectionComponent = ({ data }) => {
  const text = data.content["announcement.text"];
  if (!text) return null;

  return (
    <div className="relative overflow-hidden border-b-2 border-foreground bg-accent py-2.5 text-accent-foreground">
      <div className="flex whitespace-nowrap font-mono text-xs font-black uppercase tracking-[0.2em]">
        <div className="animate-marquee flex shrink-0 items-center gap-8 pr-8">
          <span>{text}</span>
          <span>&#9733;</span>
          <span>{text}</span>
          <span>&#9733;</span>
          <span>{text}</span>
          <span>&#9733;</span>
          <span>{text}</span>
          <span>&#9733;</span>
        </div>
        <div className="animate-marquee flex shrink-0 items-center gap-8 pr-8" aria-hidden>
          <span>{text}</span>
          <span>&#9733;</span>
          <span>{text}</span>
          <span>&#9733;</span>
          <span>{text}</span>
          <span>&#9733;</span>
          <span>{text}</span>
          <span>&#9733;</span>
        </div>
      </div>
    </div>
  );
};

const Navbar: SectionComponent = ({ data: { store, content, categoryTiles, pages } }) => (
  <header className="sticky top-0 z-50 border-b-4 border-foreground bg-primary text-primary-foreground shadow-[0_4px_0_0_rgba(0,0,0,0.1)]">
    <div className={cn(wrap, "flex items-center justify-between gap-x-6 gap-y-4 py-4")}>
      <StoreBrand
        store={store}
        content={content}
        className={cn(display, "text-2xl sm:text-4xl transition-transform hover:scale-105")}
        logoClassName="h-10 sm:h-14"
      />

      <nav className="flex items-center gap-x-6 gap-y-2 text-xs sm:text-sm font-black uppercase tracking-widest">
        <Link
          href={`/store/${store.slug}/shop`}
          className="border-b-2 border-secondary pb-0.5 hover:border-accent transition-colors"
        >
          {content["navbar.shopLabel"]}
        </Link>
        {categoryTiles.slice(0, 3).map((c) => (
          <Link 
            key={c.id} 
            href={c.href} 
            className="hidden hover:text-accent md:inline transition-colors"
          >
            {c.label}
          </Link>
        ))}
        {pages.map((pg) => (
          <Link 
            key={pg.slug} 
            href={pg.href} 
            className="hidden hover:text-accent lg:inline transition-colors"
          >
            {pg.label}
          </Link>
        ))}
        
        <div className="flex items-center gap-3">
          <SearchBox
            slug={store.slug}
            placeholder={content["search.placeholder"]}
            buttonLabel={content["search.button"]}
            className="hidden sm:flex"
            inputClassName="h-10 w-36 md:w-48 rounded-none border-2 border-foreground text-xs font-medium tracking-normal text-foreground bg-background px-3 shadow-[2px_2px_0_0_var(--color-foreground)] focus-visible:outline-none focus-visible:ring-0"
            buttonClassName="sr-only"
          />
          <CartLink 
            slug={store.slug} 
            className="border-2 border-foreground bg-secondary px-4 py-2 font-black text-secondary-foreground shadow-[2px_2px_0_0_var(--color-foreground)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_var(--color-foreground)]" 
          />
        </div>
      </nav>
    </div>
  </header>
);

const Hero: SectionComponent = ({ data: { store, content, newArrivals, visibility } }) => {
  const image =
    content["hero.image"] || newArrivals.find((p) => p.imageUrl)?.imageUrl || "";

  return (
    <section className="border-b-4 border-foreground bg-secondary text-secondary-foreground">
      <div className="grid min-h-[80vh] lg:grid-cols-12">
        {visibility.heroText && (
          <MotionDiv
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="flex flex-col justify-center border-b-4 border-foreground p-8 sm:p-12 lg:col-span-7 lg:border-b-0 lg:border-r-4"
          >
            <MotionDiv
              variants={slideUp}
              className="inline-block self-start border-2 border-foreground bg-accent px-3 py-1 text-xs font-black uppercase tracking-widest text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)] mb-6"
            >
              Featured Collection
            </MotionDiv>
            <MotionH1 variants={slideUp} className={cn(display, "text-5xl sm:text-7xl xl:text-8xl")}>
              {content["hero.headline"]}
            </MotionH1>
            <MotionP variants={slideUp} className="mt-6 max-w-xl text-lg sm:text-xl font-medium leading-relaxed opacity-95">
              {content["hero.subtext"]}
            </MotionP>
            <MotionDiv variants={slideUp} className="mt-10">
              <Link href={sectionHref(store, "new-arrivals")} className={bigCta}>
                {content["hero.ctaLabel"]} &rarr;
              </Link>
            </MotionDiv>
          </MotionDiv>
        )}

        <MotionDiv
          initial="hidden"
          animate="visible"
          variants={slideInRight}
          className={cn("relative min-h-[400px] lg:min-h-full", visibility.heroText ? "lg:col-span-5" : "lg:col-span-12")}
        >
          <Picture
            src={image}
            alt={store.name}
            className="h-full w-full object-cover bg-muted"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        </MotionDiv>
      </div>
    </section>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-20")}>
    <div className="flex items-center gap-4 mb-12">
      <span className="border-2 border-foreground bg-accent px-3 py-1 font-mono text-sm font-black text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)]">
        01
      </span>
      <h2 className={cn(display, "text-4xl sm:text-6xl")}>
        {content["featuredCategories.heading"]}
      </h2>
    </div>

    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
    >
      {categoryTiles.map((c) => (
        <MotionLi key={c.id} variants={slideUp} className="flex">
          <Link
            href={c.href}
            className="group flex w-full flex-col border-4 border-foreground bg-background transition-all duration-200 hover:-translate-x-1.5 hover:-translate-y-1.5 hover:shadow-[8px_8px_0_0_var(--color-foreground)]"
          >
            <div className="relative aspect-[4/5] border-b-4 border-foreground overflow-hidden bg-muted">
              <Picture
                src={c.image}
                alt={c.label}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
            </div>
            <div className="flex items-center justify-between bg-primary p-5 text-primary-foreground">
              <span className={cn(display, "text-2xl sm:text-3xl")}>
                {c.label}
              </span>
              <span className="text-2xl font-black transition-transform duration-200 group-hover:translate-x-1">
                &rarr;
              </span>
            </div>
          </Link>
        </MotionLi>
      ))}
    </MotionUl>
  </section>
);

function ProductCard({
  store,
  product,
  content,
  rank,
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  rank?: number;
}) {
  const viewLabel = content["product.viewLabel"];
  return (
    <MotionLi variants={slideUp} className="flex">
      <Link
        href={productHref(store, product)}
        className="group relative flex w-full flex-col border-4 border-foreground bg-background text-foreground transition-all duration-200 hover:-translate-x-1.5 hover:-translate-y-1.5 hover:shadow-[8px_8px_0_0_var(--color-foreground)]"
      >
        {rank !== undefined && (
          <span
            className={cn(
              display,
              "absolute left-0 top-0 z-10 border-b-4 border-r-4 border-foreground bg-accent px-3 py-1.5 text-2xl text-accent-foreground",
            )}
          >
            #{String(rank).padStart(2, "0")}
          </span>
        )}
        <div className="relative aspect-[3/4] border-b-4 border-foreground overflow-hidden bg-muted">
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        </div>
        <div className="flex flex-1 flex-col justify-between p-5">
          <div>
            <h3 className={cn(display, "text-2xl sm:text-3xl")}>{product.name}</h3>
            <p className="mt-2 text-xs font-black uppercase tracking-widest text-muted-foreground group-hover:text-foreground">
              {viewLabel} &rarr;
            </p>
          </div>
          <div className="mt-6 self-start border-2 border-foreground bg-accent px-3 py-1 text-lg font-black text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)]">
            {cardPrice(product, content)}
          </div>
        </div>
      </Link>
    </MotionLi>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className="border-t-4 border-b-4 border-foreground">
    <div
      aria-hidden
      className="overflow-hidden whitespace-nowrap bg-accent py-3 text-accent-foreground border-b-4 border-foreground"
    >
      <div className="animate-marquee flex font-mono text-2xl font-black uppercase tracking-widest">
        {Array.from({ length: 8 }, () => content["newArrivals.heading"]).join("  •  ")}
      </div>
    </div>
    
    <div className={cn(wrap, "py-20")}>
      <div className="flex items-center gap-4 mb-12">
        <span className="border-2 border-foreground bg-accent px-3 py-1 font-mono text-sm font-black text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)]">
          02
        </span>
        <h2 className={cn(display, "text-4xl sm:text-6xl")}>
          {content["newArrivals.heading"]}
        </h2>
      </div>

      {newArrivals.length === 0 ? (
        <div className="border-4 border-foreground bg-muted p-12 text-center shadow-[4px_4px_0_0_var(--color-foreground)]">
          <p className="text-xl font-black uppercase tracking-wider">{content["newArrivals.empty"]}</p>
        </div>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {newArrivals.map((p) => (
            <ProductCard
              key={p.id}
              store={store}
              product={p}
              content={content}
            />
          ))}
        </MotionUl>
      )}
    </div>
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="border-b-4 border-foreground bg-secondary text-secondary-foreground py-20">
    <div className={wrap}>
      <div className="flex items-center gap-4 mb-12">
        <span className="border-2 border-foreground bg-accent px-3 py-1 font-mono text-sm font-black text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)]">
          03
        </span>
        <h2 className={cn(display, "text-4xl sm:text-6xl")}>
          {content["bestSellers.heading"]}
        </h2>
      </div>

      {bestSellers.length === 0 ? (
        <div className="border-4 border-foreground bg-background p-12 text-center text-foreground shadow-[4px_4px_0_0_var(--color-foreground)]">
          <p className="text-xl font-black uppercase tracking-wider">{content["bestSellers.empty"]}</p>
        </div>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {bestSellers.map((p, i) => (
            <ProductCard
              key={p.id}
              store={store}
              product={p}
              content={content}
              rank={i + 1}
            />
          ))}
        </MotionUl>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <section className="border-b-4 border-foreground bg-accent text-accent-foreground py-20">
    <MotionDiv
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className={cn(wrap, "flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between")}
    >
      <div className="max-w-3xl">
        <MotionH2 variants={slideUp} className={cn(display, "text-5xl sm:text-7xl")}>
          {content["promoBanner.heading"]}
        </MotionH2>
        {content["promoBanner.subtext"] && (
          <MotionP variants={slideUp} className="mt-5 max-w-xl text-xl font-medium leading-relaxed opacity-90">
            {content["promoBanner.subtext"]}
          </MotionP>
        )}
      </div>
      <MotionDiv variants={slideUp}>
        <Link
          href={sectionHref(store, "new-arrivals")}
          className={cn(bigCta, "shrink-0 bg-background text-foreground hover:bg-secondary hover:text-secondary-foreground")}
        >
          {content["promoBanner.ctaLabel"]} &rarr;
        </Link>
      </MotionDiv>
    </MotionDiv>
  </section>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className="border-b-4 border-foreground">
      <div className={cn("grid", image && "md:grid-cols-2")}>
        {image && (
          <MotionDiv
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={slideInLeft}
            className="border-b-4 border-foreground md:border-b-0 md:border-r-4"
          >
            <Picture
              src={image}
              alt={store.name}
              className="h-full w-full min-h-[350px] object-cover"
            />
          </MotionDiv>
        )}
        <MotionDiv
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="flex flex-col justify-center gap-6 bg-primary px-8 py-20 text-primary-foreground sm:px-12"
        >
          {content["brandStory.heading"] && (
            <MotionH2 variants={slideUp} className={cn(display, "text-4xl sm:text-6xl")}>
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          {content["brandStory.body"] && (
            <MotionP variants={slideUp} className="max-w-xl text-lg leading-relaxed opacity-90 whitespace-pre-line">
              {content["brandStory.body"]}
            </MotionP>
          )}
        </MotionDiv>
      </div>
    </section>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className={cn(wrap, "py-20")}>
    <div className="flex items-center gap-4 mb-12">
      <span className="border-2 border-foreground bg-accent px-3 py-1 font-mono text-sm font-black text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)]">
        04
      </span>
      <h2 className={cn(display, "text-4xl sm:text-6xl")}>{content["reviews.heading"]}</h2>
    </div>

    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid gap-8 md:grid-cols-3"
    >
      {reviews.map((r, i) => (
        <MotionLi
          key={i}
          variants={slideUp}
          className="flex flex-col justify-between border-4 border-foreground bg-background p-8 shadow-[6px_6px_0_0_var(--color-foreground)] transition-transform hover:-translate-y-1"
        >
          <div>
            <span aria-hidden className={cn(display, "block text-8xl leading-none text-accent")}>
              &ldquo;
            </span>
            <blockquote className="-mt-6 text-lg font-bold leading-snug">{r.quote}</blockquote>
          </div>
          {r.author && (
            <p className="mt-8 border-t-2 border-foreground pt-4 text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">
              &mdash; {r.author}
            </p>
          )}
        </MotionLi>
      ))}
    </MotionUl>
  </section>
);

const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className="border-t-4 border-foreground pt-16">
    <div className={cn(wrap, "mb-8 flex flex-wrap items-end justify-between gap-4")}>
      <h2 className={cn(display, "text-4xl sm:text-6xl")}>{content["instagram.heading"]}</h2>
      {instagram.url && (
        <a
          href={instagram.url}
          target="_blank"
          rel="noopener noreferrer"
          className="border-2 border-foreground bg-accent px-5 py-2.5 text-lg font-black text-accent-foreground shadow-[3px_3px_0_0_var(--color-foreground)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-foreground)]"
        >
          @{instagram.handle}
        </a>
      )}
    </div>
    {instagram.tiles.length > 0 && (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid grid-cols-2 border-t-4 border-foreground sm:grid-cols-3 lg:grid-cols-6"
      >
        {instagram.tiles.map((t, i) => (
          <MotionLi key={i} variants={slideUp} className="border-b-4 border-r-4 border-foreground last:border-r-0">
            <Picture src={t.image} alt={store.name} className="aspect-square w-full object-cover" />
          </MotionLi>
        ))}
      </MotionUl>
    )}
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, pages } }) => (
  <footer className="border-t-4 border-foreground bg-primary text-primary-foreground">
    <div className={cn(wrap, "py-16")}>
      <p className={cn(display, "text-5xl sm:text-7xl")}>{store.name}</p>
      <p className="mt-6 max-w-xl text-lg opacity-85 whitespace-pre-line leading-relaxed">
        {content["footer.about"]}
      </p>

      {pages.length > 0 && (
        <nav className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm font-black uppercase tracking-widest">
          {pages.map((pg) => (
            <Link 
              key={pg.slug} 
              href={pg.href} 
              className="border-b-2 border-secondary pb-0.5 hover:border-accent transition-colors"
            >
              {pg.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-12 border-t-2 border-primary-foreground/30 pt-8 text-xs font-bold uppercase tracking-[0.25em] opacity-85">
        {fillTokens(content["footer.copyright"], store)}
      </div>
    </div>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className="grid border-b-4 border-foreground lg:grid-cols-12">
        <div className="flex flex-col border-b-4 border-foreground lg:col-span-7 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r-4">
          <ProductImage className="aspect-[4/5] w-full flex-1 object-cover" imgClassName="h-full" />
          <ProductGallery className="p-4" />
        </div>

        <div className="flex flex-col justify-center gap-8 bg-secondary p-8 sm:p-12 lg:col-span-5 text-secondary-foreground">
          <Link
            href={`/store/${store.slug}`}
            className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; {content["product.back"]}
          </Link>

          <h1 className={cn(display, "text-4xl sm:text-6xl")}>{product.name}</h1>

          <div className="flex flex-wrap items-center gap-4">
            <span className="border-2 border-foreground bg-accent px-4 py-2 text-3xl font-black text-accent-foreground shadow-[3px_3px_0_0_var(--color-foreground)]">
              <ProductPrice />
            </span>
            <StockStatus look="boldBadge" />
          </div>

          <div className="border-t-2 border-foreground/20 pt-6">
            <VariantPicker look="bold" labelClassName="text-sm font-black uppercase tracking-[0.2em]" />
          </div>

          <AddToCart look="bold" slug={store.slug} />

          {product.description && (
            <div className="border-t-2 border-foreground/20 pt-6">
              <h2 className="text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">
                {content["product.descriptionHeading"]}
              </h2>
              <p className="mt-3 text-base leading-relaxed whitespace-pre-line opacity-90">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className={cn(wrap, "py-20")}>
          <h2 className={cn(display, "mb-10 text-4xl sm:text-6xl")}>
            {content["product.relatedHeading"]}
          </h2>
          <MotionUl
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={stagger}
            className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4"
          >
            {related.map((p) => (
              <ProductCard key={p.id} store={store} product={p} content={content} />
            ))}
          </MotionUl>
        </section>
      )}
    </ProductProvider>
  );
};

const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <MotionUl
    initial="hidden"
    whileInView="visible"
    viewport={viewport}
    variants={stagger}
    className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16",
  title: "text-5xl sm:text-7xl font-black uppercase leading-[0.88] tracking-tighter",
  subtitle: "text-xs font-black uppercase tracking-widest text-muted-foreground",
  chip: "rounded-none border-2 border-foreground px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all hover:bg-accent hover:text-accent-foreground shadow-[2px_2px_0_0_var(--color-foreground)]",
  panel: "border-4 border-foreground p-8 bg-background shadow-[6px_6px_0_0_var(--color-foreground)]",
};

export const boldTemplate: Template = {
  ProductGrid,
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