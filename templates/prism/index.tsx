import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CartLink } from "../nav-client";
import { AddToCart, ProductPrice, ProductProvider, StockStatus, VariantPicker } from "../product-client";
import { HeroPicture, Picture, StoreBrand, StoreMenuButton, cardPrice, productHref, sectionHref, shopHref, storeHref } from "../shared";
import { StoreFAQ } from "../store-faq";
import { StoreFooter } from "../store-footer";
import type { SectionComponent, StorefrontData, StoreProduct, Template } from "../types";
import { Depth, PrismMotion } from "./motion-client";
import { PrismSearch } from "./search-client";
import { PrismGallery, PurchaseControls } from "./product-client";
import styles from "./prism.module.css";

const section = cn(styles.scope, styles.wrap, styles.section);
const button = styles.button;

function ProductCard({ data, product }: { data: StorefrontData; product: StoreProduct }) {
  const alternate = product.images.find((image) => image.url !== product.imageUrl);
  return (
    <Link href={productHref(data.store, product)} className={styles.card}>
      <Depth className={styles.cardVisual}>
        <Picture src={product.imageUrl} alt={product.name} className={styles.cardImage} imgClassName="object-contain p-5 sm:p-8" />
        {alternate && <Picture src={alternate.url} alt="" className={cn(styles.cardAlternate, "bg-secondary")} imgClassName="object-contain p-5 sm:p-8" />}
        {!product.inStock && <span className="absolute bottom-3 left-3 rounded-full bg-background px-3 py-2 text-xs text-foreground">{data.content["product.outOfStock"]}</span>}
      </Depth>
      <div className={styles.cardInfo}>
        <h3>{product.name}</h3>
        <p className="text-sm tabular-nums">{cardPrice(product, data.content)}</p>
      </div>
    </Link>
  );
}

const Announcement: SectionComponent = ({ data }) => <div className="bg-accent px-5 py-2 text-center text-sm text-accent-foreground">{data.content["announcement.text"]}</div>;

const Navbar: SectionComponent = ({ data }) => (
  <header className={cn(styles.scope, "border-b border-border/40 bg-background/95 text-foreground backdrop-blur-xl")}>
    <div className={cn(styles.wrap, "flex min-h-20 items-center justify-between gap-4")}>
      <div className="flex min-w-0 items-center gap-3">
        <StoreMenuButton data={data} />
        <StoreBrand store={data.store} content={data.content} className="truncate text-2xl font-semibold tracking-tight" logoClassName="h-9" />
      </div>
      <nav aria-label="Main navigation" className="hidden items-center gap-8 lg:flex">
        <Link href={shopHref(data.store)} className="py-3 text-sm">{data.content["navbar.shopLabel"]}</Link>
        {data.categoryTiles.slice(0, 3).map((category) => <Link key={category.id} href={category.href} className="py-3 text-sm">{category.label}</Link>)}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <PrismSearch data={data} />
        <CartLink basePath={data.store.basePath} className="flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm text-primary-foreground" />
      </div>
    </div>
  </header>
);

const Hero: SectionComponent = ({ data: { store, content, visibility, categoryTiles } }) => (
  <PrismMotion kind="hero" revision={`${content["hero.headline"]}:${visibility.heroText}`} className={styles.scope}>
    <section className={styles.hero} data-prism-hero>
      <div className={styles.heroFrame} data-frame>
        <Depth className={styles.heroVisual} heroVisual><HeroPicture content={content} alt="" loading="eager" className="absolute inset-0" /></Depth>
        <div className={styles.heroShade} />
        <div className={styles.shutters} aria-hidden>{Array.from({ length: 5 }, (_, i) => <span data-shutter key={i} />)}</div>
      </div>
      <div className={cn(styles.heroContent, styles.wrap)}>
        {visibility.heroText && <>
          <h1 className={styles.heroTitle} data-hero-title aria-label={content["hero.headline"]}>
            {content["hero.headline"].split(/\s+/).map((word, i) => <span key={i} aria-hidden><span className={styles.wordMask}><span className={styles.word} data-word>{word}</span></span>{" "}</span>)}
          </h1>
          <div className={styles.heroDetails} data-hero-details>
            {content["hero.subtext"] && <p>{content["hero.subtext"]}</p>}
            {content["hero.ctaLabel"] && <Link href={shopHref(store)} className={cn(button, styles.heroAction)}>{content["hero.ctaLabel"]}<ArrowUpRight aria-hidden className="size-5" /></Link>}
          </div>
        </>}
        <Link href={sectionHref(store, categoryTiles.length ? "featured-categories" : "new-arrivals")} className="mt-10 inline-flex min-h-11 w-fit items-center gap-3 text-sm">
          <ArrowDown className="size-4" aria-hidden />{content[categoryTiles.length ? "featuredCategories.heading" : "newArrivals.heading"]}
        </Link>
      </div>
    </section>
  </PrismMotion>
);

const FeaturedCategories: SectionComponent = ({ data }) => (
  <PrismMotion kind="collections" revision={data.categoryTiles.map((c) => c.id).join(",")} className={cn(styles.scope, styles.collections)}>
    <section>
      <div className={cn(styles.wrap, styles.collectionHeading)}><h2 className={styles.title}>{data.content["featuredCategories.heading"]}</h2></div>
      <ul className={cn(styles.wrap, styles.collectionList)}>
        {data.categoryTiles.map((category, index) => <li key={category.id} className={styles.collection} data-collection>
          <Link href={category.href} className={styles.collectionLink}>
            <Depth className={styles.collectionVisual} collectionVisual><Picture src={category.image} alt="" className="absolute inset-0" sizes="100vw" /></Depth>
            <div className={styles.collectionShade} />
            <div className={styles.collectionLabel} data-prism-collection-label>
              <div className={styles.collectionMeta}><span>{String(index + 1).padStart(2, "0")}</span><span>{data.categoryTiles.length.toString().padStart(2, "0")}</span></div>
              <h3>{category.label}</h3><span className={styles.collectionArrow}><ArrowUpRight aria-hidden /></span>
            </div>
          </Link>
        </li>)}
      </ul>
    </section>
  </PrismMotion>
);

function Products({ data, best = false }: { data: StorefrontData; best?: boolean }) {
  const products = best ? data.bestSellers : data.newArrivals;
  return <PrismMotion kind="reveal" revision={products.map((p) => p.id).join(",")}>
    <section className={section}>
      <div className="flex flex-wrap items-end justify-between gap-6" data-reveal>
        <h2 className={styles.title}>{data.content[best ? "bestSellers.heading" : "newArrivals.heading"]}</h2>
        <Link href={shopHref(data.store)} className="inline-flex min-h-11 items-center gap-3 text-sm">{data.content["navbar.shopLabel"]}<ArrowUpRight className="size-5" aria-hidden /></Link>
      </div>
      {products.length ? <ul className={cn(styles.grid, best && styles.bestGrid)}>{products.map((product) => <li key={product.id} data-reveal><ProductCard data={data} product={product} /></li>)}</ul> : <p className="mt-10 text-muted-foreground">{data.content[best ? "bestSellers.empty" : "newArrivals.empty"]}</p>}
    </section>
  </PrismMotion>;
}
const NewArrivals: SectionComponent = ({ data }) => <Products data={data} />;
const BestSellers: SectionComponent = ({ data }) => <Products data={data} best />;

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <PrismMotion kind="campaign" className={styles.scope}>
    <section className={styles.campaign}>
      <div className={styles.campaignVisual} data-campaign-image><Picture src={content["promoBanner.image"]} alt="" className="absolute inset-0" sizes="100vw" /><div className={styles.heroShade} /></div>
      <div className={cn(styles.wrap, styles.campaignCopy)}>
        <h2 className={styles.title}>{content["promoBanner.heading"]}</h2>
        {content["promoBanner.subtext"] && <p className="mx-auto mt-7 max-w-xl whitespace-pre-line text-lg leading-relaxed">{content["promoBanner.subtext"]}</p>}
        {content["promoBanner.ctaLabel"] && <Link href={sectionHref(store, "new-arrivals")} className={cn(button, "mt-9")}>{content["promoBanner.ctaLabel"]}<ArrowUpRight className="size-5" aria-hidden /></Link>}
      </div>
    </section>
  </PrismMotion>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => (
  <PrismMotion kind="reveal">
    <section className={cn(section, content["brandStory.image"] && styles.story)}>
      {content["brandStory.image"] && <Depth className={styles.storyImage} reveal><Picture src={content["brandStory.image"]} alt={store.name} className="h-full" sizes="(max-width: 1024px) 100vw, 50vw" /></Depth>}
      <div data-reveal><h2 className={styles.title}>{content["brandStory.heading"]}</h2><p className="mt-8 max-w-xl whitespace-pre-line text-lg leading-relaxed text-muted-foreground">{content["brandStory.body"]}</p><Link href={shopHref(store)} className={cn(button, "mt-9")}>{content["navbar.shopLabel"]}<ArrowUpRight className="size-5" aria-hidden /></Link></div>
    </section>
  </PrismMotion>
);
const Reviews: SectionComponent = ({ data }) => (
  <PrismMotion kind="reveal" className={styles.scope}>
    <section className="bg-secondary"><div className={section}>
      <h2 className={styles.title}>{data.content["reviews.heading"]}</h2>
      <div className={styles.reviews}>{data.reviews.map((review, i) => <figure key={i} className={styles.review} data-reveal><blockquote>{review.quote}</blockquote>{review.author && <figcaption className="mt-6 text-sm text-muted-foreground">{review.author}</figcaption>}</figure>)}</div>
    </div></section>
  </PrismMotion>
);
const FAQ: SectionComponent = ({ data }) => <PrismMotion kind="reveal" className={styles.scope}><StoreFAQ data={data} look="kinetic" /></PrismMotion>;
const Footer: SectionComponent = ({ data }) => <StoreFooter data={data} look="kinetic" />;
const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <PrismMotion kind="reveal" className={styles.scope}>
    <ul className={styles.grid}>{products.map((product) => <li key={product.id} data-reveal><ProductCard data={data} product={product} /></li>)}</ul>
  </PrismMotion>
);
const CatalogHeader: NonNullable<Template["CatalogHeader"]> = ({ data, title, basePath }) => {
  const category = data.categoryTiles.find((tile) => tile.href === basePath);
  if (!category?.image) return <h1 className={styles.title}>{title}</h1>;
  return <PrismMotion kind="campaign"><div className={styles.catalogHero}>
    <div className="absolute inset-0" data-campaign-image><Picture src={category.image} alt="" className="absolute inset-0" sizes="100vw" /><div className={styles.heroShade} /></div>
    <h1 className={cn(styles.title, "relative p-6 sm:p-10")}>{title}</h1>
  </div></PrismMotion>;
};
const ProductPage: Template["ProductPage"] = ({ data, product, related }) => (
  <ProductProvider product={product} content={data.content}>
    <div className={section}>
      <Link href={storeHref(data.store)} className="mb-8 inline-flex min-h-11 items-center text-sm text-muted-foreground">&larr; {data.content["product.back"]}</Link>
      <div className={styles.product}>
        <PrismGallery />
        <div className={styles.purchase}>
          <h1 className={styles.title}>{product.name}</h1><div className="mt-6 text-2xl"><ProductPrice /></div>
          <PurchaseControls><VariantPicker look="kinetic" labelClassName="mb-3 block text-sm font-semibold" /><StockStatus look="dot" /><AddToCart look="kinetic" basePath={data.store.basePath} /></PurchaseControls>
          {product.description && <div className="mt-10 border-t border-border pt-8"><h2 className="font-semibold">{data.content["product.descriptionHeading"]}</h2><p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">{product.description}</p></div>}
        </div>
      </div>
      {related.length > 0 && <section className="mt-24"><h2 className={styles.title}>{data.content["product.relatedHeading"]}</h2><ProductGrid data={data} products={related} /></section>}
    </div>
  </ProductProvider>
);

export const prismTemplate: Template = {
  Announcement, Navbar, Hero, FeaturedCategories, NewArrivals, BestSellers, PromoBanner, BrandStory, Reviews, FAQ, Footer, ProductGrid, ProductPage, CatalogHeader,
  pageStyle: {
    container: cn(styles.scope, styles.wrap, "max-w-5xl py-16 sm:py-24"),
    catalogContainer: cn(styles.scope, styles.wrap, "py-16 sm:py-24"),
    title: cn(styles.scope, styles.title),
    subtitle: "max-w-2xl text-base leading-relaxed text-muted-foreground",
    chip: "rounded-full bg-secondary px-4 py-3 text-sm",
    panel: "mt-8 rounded-2xl border border-border bg-background p-6 sm:p-8",
  },
};
