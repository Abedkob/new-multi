import Link from "next/link";
import { ArrowDown, ArrowUpRight, Search } from "lucide-react";
import type { ContentMap } from "@/lib/content";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  productHref,
  searchHref,
  sectionHref,
  shopHref,
  storeHref,
} from "../shared";
import { StoreFooter } from "../store-footer";
import type { SectionComponent, StoreInfo, StoreProduct, Template } from "../types";
import { CategoryFilm } from "./category-film-client";
import { HeroStage } from "./hero-stage-client";
import { ProductStage } from "./product-stage-client";

/**
 * Kinetic is built for image-led stores. Its visual signature is concentrated in the hero,
 * category film and product stage; utility pages stay direct and conversion-first.
 */

const wrap = "mx-auto max-w-[96rem] px-5 sm:px-8 lg:px-12";
const display = "max-w-full font-black leading-[0.88] tracking-[-0.06em] text-balance [overflow-wrap:anywhere]";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const button = cn(
  "inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground transition-transform hover:scale-[1.025]",
  focus,
);

function Heading({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-10 grid items-end gap-6 sm:mb-14 sm:grid-cols-[minmax(0,1fr)_auto]">
      <h2 className={cn(display, "max-w-5xl text-[clamp(2.75rem,5.6vw,6rem)]")}>{title}</h2>
      {aside}
    </div>
  );
}

function ProductCard({
  store,
  product,
  content,
  large = false,
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  large?: boolean;
}) {
  const href = productHref(store, product);
  const second = product.images.find((image) => image.url !== product.imageUrl)?.url;

  return (
    <Link href={href} className={cn("group block", focus)}>
      <div className={cn("relative overflow-hidden bg-secondary", large ? "aspect-[4/5]" : "aspect-[3/4]")}>
        {product.imageUrl && (
          // Blurred, scaled-up copy of the same photo fills the tile behind it, so a product
          // shot's own studio background (often white or gray) never clashes with the card.
          <Picture
            src={product.imageUrl}
            alt=""
            className="absolute inset-0"
            imgClassName="scale-125 object-cover opacity-60 blur-2xl saturate-150"
            sizes={large ? "(max-width: 1024px) 100vw, 50vw" : undefined}
            quality={20}
          />
        )}
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="absolute inset-0"
          imgClassName="object-contain p-5 transition duration-700 group-hover:scale-[1.035] group-hover:opacity-0 sm:p-8"
          sizes={large ? "(max-width: 1024px) 100vw, 50vw" : undefined}
        />
        {second && (
          <Picture
            src={second}
            alt=""
            className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
            imgClassName="object-contain p-5 sm:p-8"
            sizes={large ? "(max-width: 1024px) 100vw, 50vw" : undefined}
          />
        )}
        {!product.inStock && (
          <span className="absolute left-3 top-3 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-foreground">
            {content["product.outOfStock"]}
          </span>
        )}
        {product.isOnSale && (
          <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-foreground px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-background">
            {content["product.saleBadge"]}
          </span>
        )}
        <span className="absolute bottom-4 right-4 grid size-11 translate-y-2 place-items-center rounded-full bg-accent text-accent-foreground opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <ArrowUpRight className="size-4" aria-hidden />
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <h3 className={cn("min-w-0 font-semibold leading-tight tracking-tight", large ? "text-2xl sm:text-3xl" : "text-base sm:text-lg")}>
          {product.name}
        </h3>
        <p className={cn("flex items-baseline gap-2 font-medium tabular-nums sm:shrink-0 sm:flex-col sm:items-end sm:gap-0.5", large ? "text-lg" : "text-sm")}>
          <span className="text-foreground">
            {product.hasPriceRange ? `${content["product.fromLabel"]} ` : ""}
            {formatPrice(product.priceCents)}
          </span>
          {product.isOnSale && (
            <span className="text-xs text-muted-foreground line-through decoration-1">
              {formatPrice(product.regularPriceCents)}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-accent px-4 py-2 text-center text-xs font-semibold text-accent-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-xl">
      <div className={cn(wrap, "flex min-h-18 items-center justify-between gap-6")}>
        <div className="flex min-w-0 items-center gap-3">
          <StoreMenuButton data={data} className="-ml-2 lg:hidden" />
          <StoreBrand
            store={store}
            content={content}
            className="truncate text-xl font-black tracking-[-0.04em] sm:text-2xl"
            logoClassName="h-8"
          />
        </div>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Main navigation">
          <Link href={shopHref(store)} className="text-sm font-medium transition-opacity hover:opacity-55">
            {content["navbar.shopLabel"]}
          </Link>
          {categoryTiles.slice(0, 4).map((category) => (
            <Link key={category.id} href={category.href} className="text-sm font-medium transition-opacity hover:opacity-55">
              {category.label}
            </Link>
          ))}
          {pages.slice(0, 2).map((page) => (
            <Link key={page.slug} href={page.href} className="text-sm font-medium transition-opacity hover:opacity-55">
              {page.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={searchHref(store)}
            aria-label={content["search.button"]}
            className={cn("grid size-10 place-items-center rounded-full border border-border transition-colors hover:bg-secondary", focus)}
          >
            <Search className="size-4" aria-hidden />
          </Link>
          <CartLink
            basePath={store.basePath}
            className={cn("flex min-h-10 items-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground [&_svg]:size-4", focus)}
          />
        </div>
      </div>
    </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const words = content["hero.headline"].trim().split(/\s+/).filter(Boolean);
  const splitAt = Math.ceil(words.length / 2);
  const headlineLines = words.length <= 1 ? [words] : [words.slice(0, splitAt), words.slice(splitAt)];
  const longestWord = Math.max(0, ...words.map((word) => word.length));
  const headlineSize =
    longestWord > 12 || content["hero.headline"].length > 34
      ? "text-[clamp(2.5rem,8vw,7.5rem)]"
      : longestWord > 8 || content["hero.headline"].length > 24
        ? "text-[clamp(3rem,9vw,8.5rem)]"
        : "text-[clamp(3.5rem,10.2vw,9.75rem)]";
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);

  return (
    <HeroStage>
      <section className="relative isolate min-h-[min(52rem,calc(100svh-4.5rem))] overflow-hidden bg-primary text-primary-foreground lg:min-h-[calc(100svh-4.5rem)]">
        {hasImage && (
          <div data-kinetic-media className="absolute inset-0 -z-20 will-change-transform">
            <HeroPicture content={content} alt={store.name} className="h-full w-full" />
          </div>
        )}
        <div data-kinetic-shade className="absolute inset-0 -z-10 bg-gradient-to-r from-primary/70 via-primary/5 to-primary/25" />
        <div data-kinetic-shade className="absolute inset-0 -z-10 bg-gradient-to-t from-primary via-primary/5 to-primary/30" />

        <div className={cn(wrap, "flex min-h-[min(52rem,calc(100svh-4.5rem))] flex-col py-8 sm:py-10 lg:min-h-[calc(100svh-4.5rem)] lg:py-12")}>
          {visibility.heroText && (
            <div className="flex flex-1 flex-col justify-end pb-10 pt-16 sm:pb-12 sm:pt-20 lg:pb-10 lg:pt-16">
              <h1
                aria-label={content["hero.headline"]}
                className={cn(display, "w-full leading-[0.78]", headlineSize)}
              >
                {headlineLines.map((line, lineIndex) => (
                  <span
                    key={`${line.join("-")}-${lineIndex}`}
                    aria-hidden
                    className={cn(
                      "block w-full overflow-hidden pb-[0.12em] [&>span:not(:last-child)]:mr-[0.18em]",
                      lineIndex === 1 && "text-right sm:pl-[8vw]",
                    )}
                  >
                    {line.map((word, wordIndex) => (
                      <span
                        key={`${word}-${wordIndex}`}
                        data-kinetic-word
                        className="inline-block max-w-full pb-[0.08em] will-change-transform"
                      >
                        {word}
                      </span>
                    ))}
                  </span>
                ))}
              </h1>
            </div>
          )}

          <div className="grid gap-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:gap-12">
            {visibility.heroText && content["hero.subtext"] && (
              <p data-kinetic-detail className="max-w-[34rem] whitespace-pre-line text-base leading-relaxed text-primary-foreground/80 sm:text-lg lg:max-w-md">
                {content["hero.subtext"]}
              </p>
            )}

            {visibility.heroText && content["hero.ctaLabel"] && (
              <Link
                data-kinetic-detail
                data-kinetic-cta
                href={sectionHref(store, "new-arrivals")}
                className={cn(
                  "group inline-flex min-h-14 w-full items-center justify-between gap-6 rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground transition-transform hover:-translate-y-1 sm:col-start-2 sm:size-32 sm:flex-col sm:items-center sm:justify-center sm:gap-3 sm:p-5 sm:text-center lg:size-36 lg:p-6",
                  focus,
                )}
              >
                <span className="max-w-24 leading-tight [overflow-wrap:anywhere]">{content["hero.ctaLabel"]}</span>
                <ArrowDown className="size-5 shrink-0 transition-transform group-hover:translate-y-1" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </section>
    </HeroStage>
  );
};

const FeaturedCategories: SectionComponent = ({ data }) => (
  <CategoryFilm heading={data.content["featuredCategories.heading"]} categories={data.categoryTiles} />
);

const NewArrivals: SectionComponent = ({ data }) => (
  <section className={cn(wrap, "py-20 sm:py-28 lg:py-32")}>
    <Heading
      title={data.content["newArrivals.heading"]}
      aside={
        <Link href={shopHref(data.store)} className="hidden text-sm font-semibold underline underline-offset-4 sm:block">
          {data.content["navbar.shopLabel"]}
        </Link>
      }
    />
    {data.newArrivals.length === 0 ? (
      <p className="text-muted-foreground">{data.content["newArrivals.empty"]}</p>
    ) : (
      <ProductStage store={data.store} products={data.newArrivals} content={data.content} />
    )}
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="bg-secondary/50">
    <div className={cn(wrap, "py-20 sm:py-28 lg:py-36")}>
      <Heading title={content["bestSellers.heading"]} />
      {bestSellers.length === 0 ? (
        <p className="text-muted-foreground">{content["bestSellers.empty"]}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-7 lg:grid-cols-4 lg:gap-y-20">
          {bestSellers.map((product, index) => (
            <li key={product.id} className={cn(index % 2 === 1 && "lg:translate-y-16")}>
              <ProductCard store={store} product={product} content={content} />
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  return (
    <section className="relative isolate flex min-h-[72vh] items-end overflow-hidden bg-primary text-primary-foreground">
      {image && (
        <Picture
          src={image}
          alt={content["promoBanner.heading"]}
          className="absolute inset-0 -z-20"
          sizes="100vw"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-primary via-primary/35 to-transparent" />
      <div className={cn(wrap, "w-full py-14 sm:py-20")}>
        <h2 className={cn(display, "max-w-6xl text-[clamp(3.5rem,10vw,10rem)]")}>{content["promoBanner.heading"]}</h2>
        <div className="mt-8 flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
          {content["promoBanner.subtext"] && (
            <p className="max-w-xl whitespace-pre-line leading-relaxed text-primary-foreground/75">
              {content["promoBanner.subtext"]}
            </p>
          )}
          {content["promoBanner.ctaLabel"] && (
            <Link href={sectionHref(store, "new-arrivals")} className={button}>
              {content["promoBanner.ctaLabel"]}
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
};

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-20 sm:py-28 lg:py-36")}>
      <div className={cn("grid gap-12", image && "lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-20")}>
        <div className={cn(image && "lg:order-2")}>
          {content["brandStory.heading"] && (
            <h2 className={cn(display, "text-[clamp(3rem,7vw,7rem)]")}>{content["brandStory.heading"]}</h2>
          )}
          {content["brandStory.body"] && (
            <p className="mt-8 max-w-2xl whitespace-pre-line text-base leading-relaxed text-muted-foreground sm:text-lg">
              {content["brandStory.body"]}
            </p>
          )}
          <Link href={shopHref(store)} className="mt-10 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">
            {content["navbar.shopLabel"]}
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
        {image && (
          <div className="relative overflow-hidden bg-secondary lg:order-1">
            <Picture src={image} alt={store.name} className="aspect-[4/5]" sizes="(max-width: 1024px) 100vw, 44vw" />
          </div>
        )}
      </div>
    </section>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="overflow-hidden border-y border-border">
    <div className={cn(wrap, "py-20 sm:py-28")}>
      <Heading title={content["reviews.heading"]} />
      <ul className="grid gap-8 lg:grid-cols-3">
        {reviews.map((review, index) => (
          <li key={index} className="flex min-h-72 flex-col justify-between border-l border-border pl-6 sm:pl-8">
            <blockquote className="text-2xl font-semibold leading-snug tracking-[-0.025em] sm:text-3xl">
              &ldquo;{review.quote}&rdquo;
            </blockquote>
            {review.author && <p className="mt-8 text-sm text-muted-foreground">{review.author}</p>}
          </li>
        ))}
      </ul>
    </div>
  </section>
);

const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="kinetic" />;

const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <ul className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-7 lg:grid-cols-3 lg:gap-y-20">
    {products.map((product, index) => (
      <li key={product.id} className={cn(index % 5 === 0 && "lg:col-span-2")}>
        <ProductCard
          store={data.store}
          product={product}
          content={data.content}
          large={index % 5 === 0}
        />
      </li>
    ))}
  </ul>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-8 sm:py-12 lg:py-16")}>
        <Link href={storeHref(store)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)] lg:gap-16">
          <div>
            <div className="overflow-hidden bg-secondary">
              <ProductImage className="aspect-[4/5] sm:aspect-square" />
            </div>
            <ProductGallery className="mt-4 grid grid-cols-4 gap-3 [&_button]:rounded-none" />
          </div>

          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-sm text-muted-foreground">{store.name}</p>
            <h1 className={cn(display, "mt-4 text-[clamp(3rem,6vw,6.5rem)]")}>{product.name}</h1>
            <p className="mt-6 text-2xl font-semibold tabular-nums"><ProductPrice /></p>
            <div className="my-8 h-px bg-border" />
            <div className="grid gap-7">
              <VariantPicker look="kinetic" labelClassName="mb-3 block text-sm font-semibold" />
              <StockStatus look="dot" />
              <AddToCart look="kinetic" basePath={store.basePath} />
            </div>
            {product.description && (
              <div className="mt-10 border-t border-border pt-7">
                <h2 className="text-sm font-semibold">{content["product.descriptionHeading"]}</h2>
                <p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">{product.description}</p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-24 sm:mt-32">
            <Heading title={content["product.relatedHeading"]} />
            <ul className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-7 lg:grid-cols-4">
              {related.map((item) => (
                <li key={item.id}>
                  <ProductCard store={store} product={item} content={content} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ProductProvider>
  );
};

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:py-24",
  catalogContainer: cn(wrap, "py-14 sm:py-20"),
  title: cn(display, "text-[clamp(3rem,7vw,7rem)]"),
  subtitle: "text-sm text-muted-foreground",
  chip: "rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground hover:bg-secondary",
  panel: "mt-8 border-y border-border py-6",
};

export const kineticTemplate: Template = {
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
  ProductGrid,
  ProductPage,
  filterLayout: "top",
  pageStyle,
};
