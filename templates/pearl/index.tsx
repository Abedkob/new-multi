import Link from "next/link";
import type { Variants } from "motion/react";
import { ArrowRight, Search } from "lucide-react";
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
  StoreSearchButton,
  sectionHref,
  shopHref,
  storeHref,
} from "../shared";
import { CartLink, SearchBox } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import type { CategoryTile, SectionComponent, StoreInfo, StoreProduct, Template } from "../types";
import { CarouselClient } from "./carousel-client";

/**
 * "Pearl": a hushed multi-brand department-store look. Wide margins, hairline rules, a serif
 * wordmark set in tracked small caps, and horizontal product rails instead of grids up top. The
 * one spot of color is the theme accent, used only for rail badges. Corners stay square throughout.
 */

const wrap = "mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10";
const micro = "text-[11px] font-medium uppercase tracking-[0.2em]";
const heading = "font-serif uppercase tracking-[0.12em]";
const navLink = cn(micro, "border-b border-transparent pb-1 text-foreground transition-colors hover:border-foreground");
const outlineCta = cn(
  micro,
  "inline-flex items-center justify-center gap-3 border px-8 py-3 transition-colors",
);

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

const Announcement: SectionComponent = ({ data }) => (
  <div className={cn(micro, "border-b border-border bg-foreground px-4 py-2.5 text-center text-background")}>
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="w-full border-b border-border bg-background">
      {/* Main row: logo on the left, nav on the right — not centered. */}
      <div className={cn(wrap, "flex items-center justify-between gap-6 py-5")}>
        <div className="flex min-w-0 items-center gap-3">
          <StoreMenuButton data={data} className="-ml-2 lg:hidden" />
          <StoreBrand
            store={store}
            content={content}
            className={cn(heading, "truncate text-xl md:text-2xl")}
            logoClassName="h-8"
          />
        </div>

        <nav className="hidden items-center gap-7 lg:flex">
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

        <div className="flex shrink-0 items-center gap-5">
          <SearchBox
            slug={store.slug}
            basePath={store.basePath}
            placeholder={content["search.placeholder"]}
            buttonLabel={content["search.button"]}
            className="hidden md:flex"
            inputClassName="h-9 w-40 rounded-none border-0 border-b border-border bg-transparent px-0 text-sm focus-visible:ring-0 xl:w-48"
            buttonClassName="sr-only"
          />
          <StoreSearchButton data={data} look="pearl" className="md:hidden">
            <Search className="size-5" />
          </StoreSearchButton>
          <CartLink
            basePath={store.basePath}
            className={cn(micro, "flex items-center gap-1.5 hover:text-primary [&_svg]:size-5")}
          />
        </div>
      </div>
    </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);

  return (
    <section className="relative">
      <div className="relative flex min-h-[70vh] flex-col justify-end overflow-hidden bg-secondary sm:min-h-[85vh]">
        {hasImage && (
          <div className="absolute inset-0 z-0">
            <HeroPicture content={content} alt={store.name} className="h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/85 via-foreground/20 to-transparent" />
          </div>
        )}

        {visibility.heroText && (
          <MotionDiv
            initial="hidden"
            animate="visible"
            variants={stagger}
            className={cn(wrap, "relative z-10 w-full pb-14 pt-32 sm:pb-20")}
          >
            <div className={cn("max-w-xl", hasImage ? "text-background" : "text-foreground")}>
              <MotionH1
                variants={fadeUp}
                className={cn(heading, "text-4xl leading-[1.05] sm:text-6xl lg:text-7xl")}
              >
                {content["hero.headline"]}
              </MotionH1>
              {content["hero.subtext"] && (
                <MotionP variants={fadeUp} className="mt-5 max-w-md text-sm leading-relaxed opacity-90 sm:text-base">
                  {content["hero.subtext"]}
                </MotionP>
              )}
              {content["hero.ctaLabel"] && (
                <MotionDiv variants={fadeUp} className="mt-9">
                  <Link
                    href={sectionHref(store, "new-arrivals")}
                    className={cn(
                      "group inline-flex items-center gap-3 border-b pb-1 text-xs font-medium uppercase tracking-[0.2em] transition-opacity hover:opacity-70",
                      hasImage ? "border-background text-background" : "border-foreground text-foreground",
                    )}
                  >
                    {content["hero.ctaLabel"]}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </MotionDiv>
              )}
            </div>
          </MotionDiv>
        )}
      </div>
    </section>
  );
};

/** One category "lead" tile spanning the full row height, beside a stack of up to two more. */
function CategoryGroup({ group }: { group: CategoryTile[] }) {
  const [lead, ...rest] = group;
  if (!lead) return null;
  return (
    <div className="grid gap-10 sm:grid-cols-2 sm:grid-rows-2 sm:gap-14">
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={fadeUp}
        className="flex flex-col sm:col-start-1 sm:row-span-2 sm:row-start-1"
      >
        <Link href={lead.href} className="group flex flex-1 flex-col">
          <h3 className={cn(heading, "mb-5 text-center text-lg sm:text-xl")}>{lead.label}</h3>
          <div className="min-h-[18rem] flex-1 overflow-hidden bg-secondary">
            <Picture
              src={lead.image}
              alt={lead.label}
              className="h-full w-full"
              imgClassName="object-cover transition-transform duration-700 group-hover:scale-105"
            />
          </div>
        </Link>
      </MotionDiv>
      {rest.map((t, i) => (
        <MotionDiv
          key={t.id}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={fadeUp}
          className={cn("sm:col-start-2", i === 0 ? "sm:row-start-1" : "sm:row-start-2")}
        >
          <Link href={t.href} className="group block">
            <h3 className={cn(heading, "mb-5 text-center text-lg sm:text-xl")}>{t.label}</h3>
            <div className="aspect-[16/10] overflow-hidden bg-secondary">
              <Picture
                src={t.image}
                alt={t.label}
                className="h-full w-full"
                imgClassName="object-cover transition-transform duration-700 group-hover:scale-105"
              />
            </div>
          </Link>
        </MotionDiv>
      ))}
    </div>
  );
}

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => {
  const groups: CategoryTile[][] = [];
  for (let i = 0; i < categoryTiles.length; i += 3) groups.push(categoryTiles.slice(i, i + 3));
  return (
    <section className={cn(wrap, "py-20 sm:py-28")}>
      <h2 className={cn(heading, "mb-14 text-center text-2xl sm:text-3xl")}>{content["featuredCategories.heading"]}</h2>
      <div className="grid gap-14 sm:gap-24">
        {groups.map((group, gi) => (
          <CategoryGroup key={gi} group={group} />
        ))}
      </div>
    </section>
  );
};

function ProductCard({
  store,
  product,
  content,
  badge,
  className,
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  badge?: string;
  className?: string;
}) {
  const href = productHref(store, product);
  return (
    <MotionLi variants={fadeUp} className={cn("h-full", className)}>
      <Link href={href} className="group block h-full">
        <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
          {badge && (
            <span className={cn(micro, "absolute left-3 top-3 z-10 bg-accent px-2.5 py-1 text-[10px] text-accent-foreground")}>
              {badge}
            </span>
          )}
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full"
            imgClassName="object-contain p-4 transition-transform duration-700 group-hover:scale-105 sm:p-6"
          />
        </div>
        <div className="mt-4">
          <p className="truncate text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{store.name}</p>
          <h3 className="mt-1 line-clamp-1 text-sm font-medium text-foreground">{product.name}</h3>
          <p className="mt-1.5 text-sm font-semibold text-foreground">{cardPrice(product, content)}</p>
        </div>
      </Link>
    </MotionLi>
  );
}

const railCard = "w-[68vw] shrink-0 snap-start sm:w-[38vw] lg:w-[23vw]";

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-20")}>
    <h2 className={cn(heading, "mb-10 text-center text-2xl sm:text-3xl")}>{content["newArrivals.heading"]}</h2>
    {newArrivals.length === 0 ? (
      <p className="text-center text-sm text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <>
        <CarouselClient>
          {newArrivals.map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} badge="New" className={railCard} />
          ))}
        </CarouselClient>
        <div className="mt-10 text-center">
          <Link href={shopHref(store)} className={cn(outlineCta, "border-foreground text-foreground hover:bg-foreground hover:text-background")}>
            {content["navbar.shopLabel"]}
          </Link>
        </div>
      </>
    )}
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="border-y border-border bg-secondary/40">
    <div className={cn(wrap, "py-20")}>
      <h2 className={cn(heading, "mb-10 text-center text-2xl sm:text-3xl")}>{content["bestSellers.heading"]}</h2>
      {bestSellers.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{content["bestSellers.empty"]}</p>
      ) : (
        <CarouselClient>
          {bestSellers.map((p, i) => (
            <ProductCard key={p.id} store={store} product={p} content={content} badge={`#${i + 1}`} className={railCard} />
          ))}
        </CarouselClient>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  return (
    <section className="relative isolate overflow-hidden bg-foreground text-background">
      {image && (
        <>
          <Picture src={image} alt={content["promoBanner.heading"]} className="absolute inset-0 -z-10" sizes="100vw" />
          <div className="absolute inset-0 -z-10 bg-foreground/55" />
        </>
      )}
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(wrap, "flex min-h-[50vh] flex-col items-center justify-center py-24 text-center")}
      >
        <MotionH2 variants={fadeUp} className={cn(heading, "text-3xl sm:text-5xl")}>
          {content["promoBanner.heading"]}
        </MotionH2>
        {content["promoBanner.subtext"] && (
          <MotionP variants={fadeUp} className="mt-5 max-w-lg whitespace-pre-line text-sm text-background/80 sm:text-base">
            {content["promoBanner.subtext"]}
          </MotionP>
        )}
        {content["promoBanner.ctaLabel"] && (
          <MotionDiv variants={fadeUp} className="mt-9">
            <Link
              href={sectionHref(store, "new-arrivals")}
              className={cn(outlineCta, "border-background text-background hover:bg-background hover:text-foreground")}
            >
              {content["promoBanner.ctaLabel"]}
            </Link>
          </MotionDiv>
        )}
      </MotionDiv>
    </section>
  );
};

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-20 sm:py-28")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn("grid items-center gap-14", image ? "md:grid-cols-2" : "mx-auto max-w-2xl text-center")}
      >
        {image && (
          <MotionDiv variants={fadeUp} className="overflow-hidden bg-secondary">
            <Picture src={image} alt={store.name} className="aspect-[4/5]" imgClassName="object-cover" />
          </MotionDiv>
        )}
        <div>
          {content["brandStory.heading"] && (
            <MotionH2 variants={fadeUp} className={cn(heading, "text-2xl sm:text-4xl")}>
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
    <div className={cn(wrap, "py-20 sm:py-28")}>
      <h2 className={cn(heading, "mb-14 text-center text-2xl sm:text-3xl")}>{content["reviews.heading"]}</h2>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-12 md:grid-cols-3"
      >
        {reviews.map((r, i) => (
          <MotionDiv key={i} variants={fadeUp} className="border-t border-foreground pt-6 text-center">
            <blockquote className="text-sm leading-relaxed text-foreground sm:text-base">&ldquo;{r.quote}&rdquo;</blockquote>
            {r.author && <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{r.author}</p>}
          </MotionDiv>
        ))}
      </MotionDiv>
    </div>
  </section>
);

const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="pearl" />;

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-12")}>
        <Link href={storeHref(store)} className={cn(micro, "text-muted-foreground transition-colors hover:text-primary")}>
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <div className="grid gap-4">
            <div className="overflow-hidden bg-secondary">
              <ProductImage className="aspect-[3/4] object-cover" />
            </div>
            <ProductGallery className="grid grid-cols-4 gap-4 [&_button]:rounded-none" />
          </div>
          <div className="lg:pt-10">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{store.name}</p>
            <h1 className={cn(heading, "mt-2 text-3xl sm:text-4xl")}>{product.name}</h1>
            <p className="mt-4 text-2xl font-medium">
              <ProductPrice />
            </p>
            <div className="mt-8">
              <VariantPicker look="pearl" labelClassName={cn(micro, "mb-3 block")} />
            </div>
            <StockStatus look="dot" className="mt-6 block" />
            <div className="mt-8">
              <AddToCart look="pearl" basePath={store.basePath} />
            </div>
            {product.description && (
              <div className="mt-12 border-t border-border pt-8">
                <h2 className={cn(micro, "text-muted-foreground")}>{content["product.descriptionHeading"]}</h2>
                <p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">{product.description}</p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-32">
            <h2 className={cn(heading, "mb-12 text-center text-2xl sm:text-3xl")}>{content["product.relatedHeading"]}</h2>
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4"
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
    className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-3xl px-4 py-20 sm:px-6",
  catalogContainer: cn(wrap, "py-20"),
  title: cn(heading, "text-3xl sm:text-4xl"),
  subtitle: "text-sm text-muted-foreground",
  chip: cn(micro, "border border-border px-5 py-2 transition-colors hover:bg-secondary"),
  panel: "mt-8 border border-border p-8 bg-card",
};

export const pearlTemplate: Template = {
  ProductGrid,
  filterLayout: "sidebar",
  pageStyle,
  // New arrivals right after the hero (before the category mosaic), matching the reference
  // department-store layout this template is built from.
  homeSectionOrder: ["hero", "newArrivals", "featuredCategories", "bestSellers", "promoBanner", "brandStory", "reviews"],
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
