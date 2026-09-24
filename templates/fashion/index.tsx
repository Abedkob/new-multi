import Link from "next/link";
import type { Variants } from "motion/react";
import { buttonVariants } from "@/components/ui/button";
import type { ContentMap } from "@/lib/content";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionSection, MotionUl } from "../motion";
import { Picture, StoreBrand, StoreMenuButton, cardPrice, productHref, sectionHref, shopHref, storeHref } from "../shared";
import { CartLink, SearchBox } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import type {
  SectionComponent,
  StoreInfo,
  StoreProduct,
  Template,
} from "../types";
import { CarouselClient } from "./carousel-client";

const wrap = "mx-auto max-w-7xl px-6";
const solidCta = cn(
  buttonVariants({ variant: "default", size: "lg" }),
  "h-12 rounded-xl px-8 text-sm font-medium",
);

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};
// A tiny threshold: a long product grid on a phone can be several screens tall, so "25% in
// view" would never be reached and the grid would stay invisible until scrolled far enough.
const viewport = { once: true, amount: 0.05 } as const;

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-primary px-6 py-2.5 text-center text-xs font-medium tracking-wide text-primary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
  <header className="w-full border-b border-border bg-background">
    <div className={cn(wrap, "flex items-center justify-between py-5")}>
      <div className="flex-1 md:hidden">
        <StoreMenuButton data={data} className="-ml-2" />
      </div>
      <nav className="hidden flex-1 items-center gap-8 md:flex">
        <StoreMenuButton data={data} className="-ml-2" />
        <Link href={shopHref(store)} className="text-sm font-medium hover:text-primary">
          {content["navbar.shopLabel"]}
        </Link>
        {categoryTiles.slice(0, 2).map((c) => (
          <Link key={c.id} href={c.href} className="text-sm font-medium hover:text-primary">
            {c.label}
          </Link>
        ))}
        {pages.map((pg) => (
          <Link key={pg.slug} href={pg.href} className="text-sm font-medium hover:text-primary">
            {pg.label}
          </Link>
        ))}
      </nav>
      
      <div className="min-w-0 flex-1 text-center md:flex-none">
        <StoreBrand
          store={store}
          content={content}
          className="block truncate font-serif text-lg tracking-tight md:text-2xl"
          logoClassName="mx-auto h-7 md:h-8"
        />
      </div>

      <div className="flex flex-1 items-center justify-end gap-6">
        <SearchBox
          slug={store.slug}
          basePath={store.basePath}
          placeholder={content["search.placeholder"]}
          buttonLabel={content["search.button"]}
          className="hidden md:flex"
          inputClassName="h-9 w-48 rounded-full bg-secondary border-none px-4 text-sm"
          buttonClassName="sr-only"
        />
        <CartLink
          basePath={store.basePath}
          className="text-sm font-medium hover:text-primary"
        />
      </div>
    </div>
  </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);

  return (
    <section className="px-3 pt-3 sm:px-6 sm:pt-6">
      <div className="relative flex flex-col justify-end min-h-[75vh] md:min-h-[85vh] overflow-hidden rounded-2xl sm:rounded-[2.5rem] bg-secondary/30 transition-all duration-300">
        {/* Background Image & Overlay */}
        {hasImage && (
          <div className="absolute inset-0 z-0">
            {content["hero.imageMobile"] && (
              <Picture
                src={content["hero.imageMobile"]}
                alt={store.name}
                className={cn("h-full w-full object-cover", content["hero.image"] ? "block sm:hidden" : "block")}
                imgClassName="h-full w-full object-cover object-center transform scale-105 transition-transform duration-1000 ease-out"
                sizes="100vw"
              />
            )}
            {content["hero.image"] && (
              <Picture
                src={content["hero.image"]}
                alt={store.name}
                className={cn("h-full w-full object-cover", content["hero.imageMobile"] ? "hidden sm:block" : "block")}
                imgClassName="h-full w-full object-cover object-center transform scale-105 transition-transform duration-1000 ease-out"
                sizes="100vw"
              />
            )}
            {/* Dynamic Multi-stop Gradient Overlay for Superior Text Contrast */}
            {/* Scrim in the theme text colour, so the text on it (theme background colour) stays
                readable with any palette: a light theme gets the classic dark scrim + white text. */}
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/85 via-foreground/35 to-transparent" />
          </div>
        )}

        {/* Content Container */}
        <div className="relative z-10 w-full mx-auto max-w-7xl px-5 pb-12 pt-32 sm:px-8 sm:pb-16 md:pb-24">
          {visibility.heroText && (
            <MotionDiv
              initial="hidden"
              animate="visible"
              variants={stagger}
              className={cn("max-w-2xl", hasImage ? "text-background" : "text-foreground")}
            >
              {/* Headline */}
              <MotionH1
                variants={fadeUp}
                className="text-3xl font-semibold tracking-tight drop-shadow-sm sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.1]"
              >
                {content["hero.headline"]}
              </MotionH1>

              {/* Subtext */}
              {content["hero.subtext"] && (
                <MotionP
                  variants={fadeUp}
                  className="mt-4 sm:mt-6 text-base sm:text-lg lg:text-xl opacity-85 max-w-xl leading-relaxed font-normal"
                >
                  {content["hero.subtext"]}
                </MotionP>
              )}

              {/* Call To Action */}
              {content["hero.ctaLabel"] && (
                <MotionDiv
                  variants={fadeUp}
                  className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-4"
                >
                  <Link
                    href={sectionHref(store, "new-arrivals")}
                    className={cn(
                      solidCta,
                      "w-full sm:w-auto inline-flex items-center justify-center text-center px-8 py-4 rounded-full font-medium text-base",
                      hasImage
                        ? "bg-background text-foreground hover:bg-background/90"
                        : "bg-primary text-primary-foreground hover:bg-primary/90",
                      "active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    )}
                  >
                    <span>{content["hero.ctaLabel"]}</span>
                    {/* Optional Arrow Icon for better visual affordance */}
                    <svg
                      className="ml-2 -mr-1 h-5 w-5 transition-transform group-hover:translate-x-1"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14 5l7 7m0 0l-7 7m7-7H3"
                      />
                    </svg>
                  </Link>
                </MotionDiv>
              )}
            </MotionDiv>
          )}
        </div>
      </div>
    </section>
  );
};

export default Hero;
const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-24")}>
    <h2 className="mb-12 text-center text-3xl font-semibold tracking-tight">{content["featuredCategories.heading"]}</h2>
    <CarouselClient>
      {categoryTiles.map((c, i) => (
        <MotionLi key={c.id} variants={fadeUp} className="w-[70vw] shrink-0 snap-start sm:w-[40vw] lg:w-[22vw]">
          <Link href={c.href} className="group block">
            <div className={cn("overflow-hidden bg-secondary", i % 2 === 0 ? "rounded-t-[10rem] rounded-b-3xl aspect-[3/4]" : "rounded-3xl aspect-[4/5]")}>
              <Picture
                src={c.image}
                alt={c.label}
                className="h-full w-full"
                imgClassName="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
            </div>
            <p className="mt-6 text-center text-lg font-medium transition-colors group-hover:text-primary">
              {c.label}
            </p>
          </Link>
        </MotionLi>
      ))}
    </CarouselClient>
  </section>
);

function ProductCard({ store, product, content }: { store: StoreInfo; product: StoreProduct; content: ContentMap }) {
  const href = productHref(store, product);
  return (
    <MotionLi variants={fadeUp} className="h-full">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-sm transition-shadow hover:shadow-lg">
        <Link href={href} className="group block">
          <div className="relative aspect-[4/5] overflow-hidden bg-secondary/30">
            <Picture
              src={product.imageUrl}
              alt={product.name}
              className="absolute inset-0"
              imgClassName="object-contain p-6 sm:p-8 transition-transform duration-700 group-hover:scale-105"
            />
          </div>
        </Link>
        <div className="flex flex-1 flex-col p-5">
          <Link href={href}>
            <h3 className="line-clamp-1 text-base font-semibold text-foreground transition-colors hover:text-primary">
              {product.name}
            </h3>
          </Link>
          {/* min-h reserves 2 lines even when empty, so a short description doesn't shrink this
              card relative to its row-mates — every card in a row ends up the same height. */}
          <p className="mt-1.5 line-clamp-2 min-h-10 text-sm text-muted-foreground">{product.description}</p>
          <div className="mt-auto flex items-center justify-between gap-3 pt-4">
            <span className="text-lg font-bold text-foreground">{cardPrice(product, content)}</span>
            <Link href={href} className={cn(buttonVariants({ size: "sm" }), "rounded-full px-5")}>
              {content["product.viewLabel"]}
            </Link>
          </div>
        </div>
      </div>
    </MotionLi>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-20")}>
    <h2 className="mb-12 text-center text-3xl font-semibold tracking-tight">{content["newArrivals.heading"]}</h2>
    {newArrivals.length === 0 ? (
      <p className="text-center text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-8 sm:gap-y-12 lg:grid-cols-4"
      >
        {newArrivals.map((p) => (
          <ProductCard key={p.id} store={store} product={p} content={content} />
        ))}
      </MotionUl>
    )}
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="bg-secondary/20">
    <div className={cn(wrap, "py-24")}>
      <h2 className="mb-12 text-center text-3xl font-semibold tracking-tight">{content["bestSellers.heading"]}</h2>
      {bestSellers.length === 0 ? (
        <p className="text-center text-muted-foreground">{content["bestSellers.empty"]}</p>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12 lg:grid-cols-4"
        >
          {bestSellers.map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} />
          ))}
        </MotionUl>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  return (
    <section className="px-4 py-12 sm:px-6">
      <div className="relative isolate overflow-hidden rounded-[2.5rem] bg-primary text-primary-foreground">
        {image && (
          <>
            <Picture src={image} alt={content["promoBanner.heading"]} className="absolute inset-0 -z-10" sizes="100vw" />
            <div className="absolute inset-0 -z-10 bg-primary/60" />
          </>
        )}
        <MotionDiv
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="mx-auto max-w-3xl px-6 py-20 text-center"
        >
          <MotionH2 variants={fadeUp} className="text-4xl font-medium tracking-tight sm:text-5xl">
            {content["promoBanner.heading"]}
          </MotionH2>
          {content["promoBanner.subtext"] && (
            <MotionP variants={fadeUp} className="mt-6 whitespace-pre-line text-lg text-primary-foreground/80">
              {content["promoBanner.subtext"]}
            </MotionP>
          )}
          <MotionDiv variants={fadeUp} className="mt-10">
            <Link
              href={sectionHref(store, "new-arrivals")}
              className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-xl px-8 text-sm font-medium bg-primary-foreground text-primary hover:bg-primary-foreground/90")}
            >
              {content["promoBanner.ctaLabel"]}
            </Link>
          </MotionDiv>
        </MotionDiv>
      </div>
    </section>
  );
};

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-24")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(
          "grid items-center gap-16",
          image ? "md:grid-cols-2" : "mx-auto max-w-3xl text-center",
        )}
      >
        <div>
          {content["brandStory.heading"] && (
            <MotionH2 variants={fadeUp} className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          {content["brandStory.body"] && (
            <MotionP variants={fadeUp} className="mt-6 whitespace-pre-line text-lg leading-relaxed text-muted-foreground">
              {content["brandStory.body"]}
            </MotionP>
          )}
        </div>
        {image && (
          <MotionDiv variants={fadeUp} className="order-first md:order-last">
            <div className="overflow-hidden rounded-[2.5rem]">
              <Picture src={image} alt={store.name} className="aspect-square" imgClassName="object-cover" />
            </div>
          </MotionDiv>
        )}
      </MotionDiv>
    </section>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="bg-secondary/30">
    <div className={cn(wrap, "py-24")}>
      <h2 className="mb-16 text-center text-3xl font-semibold tracking-tight">{content["reviews.heading"]}</h2>
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-8 md:grid-cols-3"
      >
        {reviews.map((r, i) => (
          <MotionLi key={i} variants={fadeUp} className="rounded-3xl bg-background p-8 shadow-sm">
            <blockquote className="text-lg leading-relaxed text-foreground">
              &ldquo;{r.quote}&rdquo;
            </blockquote>
            {r.author && <p className="mt-6 font-medium text-muted-foreground">{r.author}</p>}
          </MotionLi>
        ))}
      </MotionUl>
    </div>
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, pages } }) => (
  <footer className="bg-foreground text-background/70">
    <div className={cn(wrap, "py-20")}>
      <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <StoreBrand
            store={store}
            content={content}
            className="text-3xl font-serif text-background tracking-tight"
            logoClassName="h-10"
          />
          <p className="mt-6 max-w-sm whitespace-pre-line text-sm leading-relaxed">
            {content["footer.about"]}
          </p>
        </div>
        {pages.length > 0 && (
          <div>
            <h3 className="mb-6 text-sm font-semibold uppercase tracking-wider text-background">
              {content["footer.linksHeading"]}
            </h3>
            <ul className="space-y-4">
              {pages.map((pg) => (
                <li key={pg.slug}>
                  <Link href={pg.href} className="text-sm hover:text-background transition-colors">
                    {pg.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="mt-20 flex flex-col items-center justify-between border-t border-background/15 pt-8 sm:flex-row">
        <p className="text-sm">{fillTokens(content["footer.copyright"], store)}</p>
      </div>
      <div className="mt-10 overflow-hidden opacity-5 pointer-events-none select-none">
         <span className="text-[15rem] font-serif font-bold tracking-tighter leading-none whitespace-nowrap -ml-4">{store.name}</span>
      </div>
    </div>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-12")}>
        <Link
          href={storeHref(store)}
          className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <div className="grid gap-4">
            <div className="overflow-hidden rounded-3xl bg-secondary/30">
              <ProductImage className="aspect-[3/4] object-cover" />
            </div>
            <ProductGallery className="grid grid-cols-4 gap-4" />
          </div>
          <div className="lg:pt-10">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{product.name}</h1>
            <p className="mt-4 text-2xl font-medium">
              <ProductPrice />
            </p>
            <div className="mt-8">
              <VariantPicker
                look="minimal"
                labelClassName="text-sm font-medium mb-3 block"
              />
            </div>
            <StockStatus look="dot" className="mt-6 block" />
            <div className="mt-8">
              <AddToCart look="solid" basePath={store.basePath} />
            </div>
            {product.description && (
              <div className="mt-12">
                <h2 className="text-lg font-semibold">{content["product.descriptionHeading"]}</h2>
                <p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">
                  {product.description}
                </p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-32">
            <h2 className="mb-12 text-center text-3xl font-semibold tracking-tight">{content["product.relatedHeading"]}</h2>
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4"
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
    className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-4xl px-6 py-20",
  catalogContainer: "mx-auto max-w-7xl px-6 py-20",
  title: "text-4xl font-semibold tracking-tight",
  subtitle: "text-base text-muted-foreground",
  chip: "rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-secondary transition-colors",
  panel: "mt-8 border border-border rounded-3xl p-8 bg-card shadow-sm",
};

export const fashionTemplate: Template = {
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
