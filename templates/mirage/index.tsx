import Link from "next/link";
import { ArrowDown, ArrowUpRight, Search } from "lucide-react";
import type { ContentMap } from "@/lib/content";
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
  cardPrice,
  productHref,
  searchHref,
  sectionHref,
  shopHref,
  storeHref,
} from "../shared";
import { StoreFooter } from "../store-footer";
import type { SectionComponent, StoreInfo, StoreProduct, Template } from "../types";
import { MirageCollectionMotion, MirageHeroMotion, MirageReveal } from "./motion-client";

const wrap = "mx-auto w-full max-w-[100rem] px-5 sm:px-8 lg:px-12";
const display = "max-w-full font-semibold leading-[0.88] tracking-[-0.065em] text-balance [overflow-wrap:anywhere]";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className={cn(display, "text-[clamp(3rem,7vw,7.5rem)]")}>{children}</h2>;
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
  return (
    <Link href={href} className={cn("group block", focus)}>
      <div className={cn("relative overflow-hidden bg-secondary", large ? "aspect-[5/6]" : "aspect-[4/5]")}>
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className="absolute inset-0"
          imgClassName="object-contain p-6 transition-transform duration-700 ease-out group-hover:scale-[1.045] sm:p-9"
          sizes={large ? "(max-width: 1024px) 100vw, 58vw" : "(max-width: 768px) 50vw, 30vw"}
        />
        {product.isOnSale && (
          <span className="absolute left-4 top-4 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground">
            {content["product.saleBadge"]}
          </span>
        )}
        {!product.inStock && (
          <span className="absolute bottom-4 left-4 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
            {content["product.outOfStock"]}
          </span>
        )}
        <span className="absolute bottom-4 right-4 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 group-hover:rotate-45">
          <ArrowUpRight className="size-4" aria-hidden />
        </span>
      </div>
      <div className="mt-4 flex items-start justify-between gap-5">
        <h3 className={cn("min-w-0 font-medium leading-tight", large ? "text-2xl sm:text-4xl" : "text-base sm:text-xl")}>
          {product.name}
        </h3>
        <p className="shrink-0 text-sm font-medium tabular-nums sm:text-base">{cardPrice(product, content)}</p>
      </div>
    </Link>
  );
}

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-accent px-4 py-2.5 text-center text-xs font-semibold text-accent-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
    <header className="bg-background/90 backdrop-blur-xl">
      <div className={cn(wrap, "flex min-h-20 items-center justify-between gap-5")}>
        <div className="flex min-w-0 items-center gap-3">
          <StoreMenuButton data={data} className="-ml-2 lg:hidden" />
          <StoreBrand store={store} content={content} className="truncate text-xl font-semibold tracking-[-0.045em] sm:text-2xl" logoClassName="h-9" />
        </div>
        <nav aria-label="Main navigation" className="hidden items-center gap-8 lg:flex">
          <Link href={shopHref(store)} className="text-sm transition-opacity hover:opacity-55">{content["navbar.shopLabel"]}</Link>
          {categoryTiles.slice(0, 4).map((category) => (
            <Link key={category.id} href={category.href} className="text-sm transition-opacity hover:opacity-55">{category.label}</Link>
          ))}
          {pages.map((page) => (
            <Link key={page.slug} href={page.href} className="text-sm transition-opacity hover:opacity-55">{page.label}</Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={searchHref(store)} aria-label={content["search.button"]} className={cn("grid size-11 place-items-center rounded-full bg-secondary transition-transform hover:scale-105", focus)}>
            <Search className="size-4" aria-hidden />
          </Link>
          <CartLink basePath={store.basePath} className={cn("flex min-h-11 items-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground [&_svg]:size-4", focus)} />
        </div>
      </div>
    </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const words = content["hero.headline"].trim().split(/\s+/).filter(Boolean);
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);
  return (
    <MirageHeroMotion>
      <section className="relative isolate min-h-[calc(100svh-5rem)] overflow-hidden bg-primary text-primary-foreground">
        <div className={cn(wrap, "relative flex min-h-[calc(100svh-5rem)] flex-col justify-between py-8 sm:py-10")}>
          <div data-mirage-detail className="flex items-center justify-between gap-5 text-sm text-primary-foreground/70">
            <span className="truncate">{store.name}</span>
            <ArrowDown className="size-5" aria-hidden />
          </div>

          <div
            data-mirage-aperture
            className="absolute inset-x-[7%] inset-y-[10%] -z-10 overflow-hidden bg-secondary [clip-path:ellipse(42%_48%_at_50%_50%)] sm:inset-x-[20%] sm:inset-y-[7%] lg:inset-x-[27%]"
          >
            {hasImage && <HeroPicture content={content} alt={store.name} className="h-full w-full" />}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/45 via-transparent to-primary/10" />
          </div>

          {visibility.heroText && (
            <div className="relative z-10 my-auto py-20">
              <h1 aria-label={content["hero.headline"]} className={cn(display, "text-[clamp(3.5rem,11vw,11rem)] leading-[0.78]")}>
                {words.map((word, index) => (
                  <span key={`${word}-${index}`} aria-hidden className={cn("block overflow-hidden pb-[0.12em]", index % 2 === 1 && "text-right")}>
                    <span data-mirage-word className="inline-block max-w-full pb-[0.06em] will-change-transform">{word}</span>
                  </span>
                ))}
              </h1>
            </div>
          )}

          {visibility.heroText && (
            <div className="relative z-20 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              {content["hero.subtext"] && (
                <p data-mirage-detail className="max-w-md whitespace-pre-line text-base leading-relaxed text-primary-foreground/75 sm:text-lg">{content["hero.subtext"]}</p>
              )}
              {content["hero.ctaLabel"] && (
                <Link data-mirage-detail href={sectionHref(store, "new-arrivals")} className={cn("inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-accent px-7 text-sm font-semibold text-accent-foreground transition-transform hover:scale-105", focus)}>
                  {content["hero.ctaLabel"]}
                  <ArrowDown className="size-4" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </MirageHeroMotion>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <MirageCollectionMotion count={categoryTiles.length}>
    <section className="bg-secondary lg:h-screen lg:min-h-[44rem]">
      <div className={cn(wrap, "relative py-20 sm:py-28 lg:h-full lg:py-12")}>
        <SectionHeading>{content["featuredCategories.heading"]}</SectionHeading>
        <div className="mt-12 grid gap-6 lg:absolute lg:inset-x-12 lg:bottom-12 lg:top-[13rem] lg:mt-0">
          {categoryTiles.map((category) => (
            <Link
              key={category.id}
              data-mirage-collection
              href={category.href}
              className={cn("group relative grid min-h-[32rem] overflow-hidden bg-primary text-primary-foreground lg:absolute lg:inset-0 lg:grid-cols-[1.3fr_0.7fr]")}
            >
              <Picture src={category.image} alt={category.label} className="absolute inset-0 lg:relative" imgClassName="transition-transform duration-1000 group-hover:scale-105" sizes="(max-width: 1024px) 100vw, 65vw" />
              <span className="absolute inset-0 bg-gradient-to-t from-primary via-primary/10 to-transparent lg:hidden" />
              <span className="relative mt-auto flex items-end justify-between gap-6 p-6 sm:p-9 lg:mt-0 lg:flex-col lg:items-start lg:bg-primary lg:p-10">
                <span className={cn(display, "max-w-full text-[clamp(2.75rem,5vw,6rem)]")}>{category.label}</span>
                <ArrowUpRight className="size-7 shrink-0 transition-transform group-hover:rotate-45" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  </MirageCollectionMotion>
);

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-24 sm:py-32 lg:py-40")}>
    <SectionHeading>{content["newArrivals.heading"]}</SectionHeading>
    {newArrivals.length === 0 ? (
      <p className="mt-10 text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <ul className="mt-14 grid grid-cols-2 gap-x-4 gap-y-16 sm:gap-x-8 lg:grid-cols-12 lg:gap-y-28">
        {newArrivals.map((product, index) => {
          const large = index % 3 === 0;
          return (
            <li key={product.id} className={cn("col-span-1", large ? "lg:col-span-7" : "lg:col-span-5", index % 3 === 2 && "lg:col-start-7")}>
              <MirageReveal className={cn(!large && index % 2 === 1 && "lg:pt-24")}>
                <ProductCard store={store} product={product} content={content} large={large} />
              </MirageReveal>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="overflow-hidden bg-primary text-primary-foreground">
    <div className={cn(wrap, "py-24 sm:py-32")}>
      <SectionHeading>{content["bestSellers.heading"]}</SectionHeading>
      {bestSellers.length === 0 ? (
        <p className="mt-10 text-primary-foreground/65">{content["bestSellers.empty"]}</p>
      ) : (
        <ul className="mt-14 grid gap-5 lg:grid-cols-2">
          {bestSellers.map((product) => (
            <li key={product.id}>
              <Link href={productHref(store, product)} className="group grid min-h-72 grid-cols-[0.8fr_1.2fr] overflow-hidden rounded-[2rem] bg-background text-foreground sm:min-h-96">
                <Picture src={product.imageUrl} alt={product.name} className="h-full bg-secondary" imgClassName="object-contain p-4 transition-transform duration-700 group-hover:scale-105 sm:p-8" sizes="(max-width: 1024px) 40vw, 24vw" />
                <span className="flex min-w-0 flex-col justify-between p-5 sm:p-9">
                  <span className={cn(display, "text-[clamp(1.8rem,4vw,4.5rem)]")}>{product.name}</span>
                  <span className="flex items-center justify-between gap-3 text-sm font-semibold tabular-nums">
                    {cardPrice(product, content)}
                    <ArrowUpRight className="size-5 transition-transform group-hover:rotate-45" aria-hidden />
                  </span>
                </span>
              </Link>
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
    <section className="relative isolate flex min-h-[76vh] items-center overflow-hidden bg-accent text-accent-foreground">
      {image && <Picture src={image} alt={content["promoBanner.heading"]} className="absolute inset-0 -z-20" sizes="100vw" />}
      <div className="absolute inset-0 -z-10 bg-primary/45" />
      <div className={cn(wrap, "py-20 text-center")}>
        <h2 className={cn(display, "mx-auto max-w-7xl text-[clamp(3.75rem,12vw,12rem)]")}>{content["promoBanner.heading"]}</h2>
        {content["promoBanner.subtext"] && <p className="mx-auto mt-8 max-w-xl whitespace-pre-line text-base leading-relaxed sm:text-lg">{content["promoBanner.subtext"]}</p>}
        {content["promoBanner.ctaLabel"] && (
          <Link href={sectionHref(store, "new-arrivals")} className={cn("mt-9 inline-flex min-h-14 items-center gap-3 rounded-full bg-background px-8 text-sm font-semibold text-foreground", focus)}>
            {content["promoBanner.ctaLabel"]}<ArrowUpRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
    </section>
  );
};

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-24 sm:py-32 lg:py-40")}>
      <div className={cn("grid gap-12", image && "lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-24")}>
        {image && <MirageReveal><Picture src={image} alt={store.name} className="aspect-[4/5] overflow-hidden rounded-[50%_50%_2rem_2rem] bg-secondary" sizes="(max-width: 1024px) 100vw, 52vw" /></MirageReveal>}
        <MirageReveal>
          {content["brandStory.heading"] && <SectionHeading>{content["brandStory.heading"]}</SectionHeading>}
          {content["brandStory.body"] && <p className="mt-8 max-w-xl whitespace-pre-line text-base leading-relaxed text-muted-foreground sm:text-lg">{content["brandStory.body"]}</p>}
          <Link href={shopHref(store)} className={cn("mt-10 inline-flex min-h-12 items-center gap-3 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground", focus)}>{content["navbar.shopLabel"]}<ArrowUpRight className="size-4" aria-hidden /></Link>
        </MirageReveal>
      </div>
    </section>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="bg-secondary">
    <div className={cn(wrap, "py-24 sm:py-32")}>
      <SectionHeading>{content["reviews.heading"]}</SectionHeading>
      <div className="mt-14 grid gap-6 lg:grid-cols-3">
        {reviews.map((review, index) => (
          <MirageReveal key={index} className="flex min-h-80 flex-col justify-between rounded-[2rem] bg-background p-7 sm:p-9">
            <blockquote className="text-2xl font-medium leading-snug tracking-[-0.035em] sm:text-3xl">&ldquo;{review.quote}&rdquo;</blockquote>
            {review.author && <p className="mt-10 text-sm text-muted-foreground">{review.author}</p>}
          </MirageReveal>
        ))}
      </div>
    </div>
  </section>
);

const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="mirage" />;

const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <ul className="grid grid-cols-2 gap-x-4 gap-y-14 sm:gap-x-8 lg:grid-cols-3 lg:gap-y-24">
    {products.map((product, index) => (
      <li key={product.id} className={cn(index % 4 === 0 && "lg:col-span-2")}>
        <ProductCard store={data.store} product={product} content={data.content} large={index % 4 === 0} />
      </li>
    ))}
  </ul>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-10 sm:py-16")}>
        <Link href={storeHref(store)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">&larr; {content["product.back"]}</Link>
        <div className="mt-8 grid gap-12 lg:grid-cols-[1.25fr_0.75fr] lg:gap-20">
          <div>
            <div className="overflow-hidden rounded-[2rem] bg-secondary"><ProductImage className="aspect-[4/5] sm:aspect-square" /></div>
            <ProductGallery className="mt-4 grid grid-cols-4 gap-3 [&_button]:rounded-2xl" />
          </div>
          <div className="lg:sticky lg:top-32 lg:self-start">
            <h1 className={cn(display, "text-[clamp(3rem,6vw,6.5rem)]")}>{product.name}</h1>
            <p className="mt-6 text-2xl font-semibold"><ProductPrice /></p>
            <div className="mt-9 grid gap-7">
              <VariantPicker look="kinetic" labelClassName="mb-3 block text-sm font-semibold" />
              <StockStatus look="dot" />
              <AddToCart look="kinetic" basePath={store.basePath} />
            </div>
            {product.description && <div className="mt-10"><h2 className="text-sm font-semibold">{content["product.descriptionHeading"]}</h2><p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">{product.description}</p></div>}
          </div>
        </div>
        {related.length > 0 && (
          <section className="mt-28 sm:mt-36">
            <SectionHeading>{content["product.relatedHeading"]}</SectionHeading>
            <ul className="mt-12 grid grid-cols-2 gap-4 sm:gap-8 lg:grid-cols-4">{related.map((item) => <li key={item.id}><ProductCard store={store} product={item} content={content} /></li>)}</ul>
          </section>
        )}
      </div>
    </ProductProvider>
  );
};

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:py-24",
  catalogContainer: cn(wrap, "py-16 sm:py-24"),
  title: cn(display, "text-[clamp(3rem,7vw,7rem)]"),
  subtitle: "text-base text-muted-foreground",
  chip: "rounded-full bg-secondary px-4 py-2 text-sm font-medium transition-transform hover:scale-105",
  panel: "mt-8 rounded-[2rem] bg-secondary p-6 sm:p-8",
};

export const mirageTemplate: Template = {
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
  pageStyle,
};
