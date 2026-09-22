import Link from "next/link";
import type { Variants } from "motion/react";
import { buttonVariants } from "@/components/ui/button";
import type { ContentMap } from "@/lib/content";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionSection, MotionUl } from "../motion";
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
 * "Minimal": whitespace, a quiet type scale, no borders or boxes, soft portrait imagery.
 * Every color comes from the theme tokens (bg-*, text-*, border-*), never a literal.
 */

const eyebrow = "text-xs uppercase tracking-[0.22em] text-muted-foreground";
const wrap = "mx-auto max-w-6xl px-6";
const outlineCta = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-10 rounded-full px-8 text-sm",
);

/**
 * "Minimal"'s animation language: a quiet fade with a slow upward drift, nothing snappy.
 * Grids stagger gently so items settle in one after another rather than all at once.
 */
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const viewport = { once: true, amount: 0.25 } as const;

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-secondary px-6 py-2.5 text-center text-xs tracking-wide text-secondary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data: { store, content, categoryTiles, pages } }) => (
  <header className="border-b border-border">
    <div className={cn(wrap, "grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-6")}>
      <nav className="hidden flex-wrap gap-x-6 gap-y-1 sm:flex">
        <Link href={`/store/${store.slug}/shop`} className={cn(eyebrow, "hover:text-foreground")}>
          {content["navbar.shopLabel"]}
        </Link>
        {categoryTiles.slice(0, 2).map((c) => (
          <Link key={c.id} href={c.href} className={cn(eyebrow, "hover:text-foreground")}>
            {c.label}
          </Link>
        ))}
        {pages.map((pg) => (
          <Link key={pg.slug} href={pg.href} className={cn(eyebrow, "hover:text-foreground")}>
            {pg.label}
          </Link>
        ))}
      </nav>
      <StoreBrand
        store={store}
        content={content}
        className="col-start-2 text-sm font-medium uppercase tracking-[0.3em]"
        logoClassName="h-6"
      />
      <div className="col-start-3 flex items-center justify-end gap-4">
        <SearchBox
          slug={store.slug}
          placeholder={content["search.placeholder"]}
          buttonLabel={content["search.button"]}
          className="hidden md:flex"
          inputClassName="h-8 w-40 rounded-full text-xs"
          buttonClassName="sr-only"
        />
        <CartLink
          slug={store.slug}
          className={cn(eyebrow, "hover:text-foreground")}
        />
      </div>
    </div>
  </header>
);

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => (
  <>
    {visibility.heroText && (
      <MotionSection
        initial="hidden"
        animate="visible"
        variants={stagger}
        className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-36"
      >
        <MotionH1 variants={fadeUp} className="text-4xl font-light tracking-tight sm:text-6xl">
          {content["hero.headline"]}
        </MotionH1>
        <MotionP
          variants={fadeUp}
          className="mx-auto mt-6 max-w-xl whitespace-pre-line text-lg leading-relaxed text-muted-foreground"
        >
          {content["hero.subtext"]}
        </MotionP>
        <MotionDiv variants={fadeUp}>
          <Link href={sectionHref(store, "new-arrivals")} className={cn(outlineCta, "mt-10")}>
            {content["hero.ctaLabel"]}
          </Link>
        </MotionDiv>
      </MotionSection>
    )}
    {content["hero.image"] && (
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={fadeUp}
        className={wrap}
      >
        <Picture src={content["hero.image"]} alt={store.name} className="aspect-[21/9]" sizes="100vw" />
      </MotionDiv>
    )}
  </>
);

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "pt-28")}>
    <h2 className={cn(eyebrow, "mb-10 text-center")}>{content["featuredCategories.heading"]}</h2>
    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid gap-6 sm:grid-cols-3"
    >
      {categoryTiles.map((c) => (
        <MotionLi key={c.id} variants={fadeUp}>
          <Link href={c.href} className="group block">
            <Picture
              src={c.image}
              alt={c.label}
              className="aspect-[3/4]"
              imgClassName="transition duration-500 group-hover:scale-[1.03]"
            />
            <p className="mt-4 text-center text-sm tracking-wide group-hover:text-accent">
              {c.label}
            </p>
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
  ratio = "aspect-[4/5]",
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  ratio?: string;
}) {
  return (
    <MotionLi variants={fadeUp}>
      <Link href={productHref(store, product)} className="group block">
        <Picture
          src={product.imageUrl}
          alt={product.name}
          className={ratio}
          imgClassName="transition duration-500 group-hover:scale-[1.03]"
        />
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <h3 className="text-sm group-hover:text-accent">{product.name}</h3>
          <span className="text-sm text-muted-foreground">
            {cardPrice(product, content)}
          </span>
        </div>
      </Link>
    </MotionLi>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-28")}>
    <h2 className={cn(eyebrow, "mb-10 text-center")}>{content["newArrivals.heading"]}</h2>
    {newArrivals.length === 0 ? (
      <p className="text-center text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3"
      >
        {newArrivals.map((p) => (
          <ProductCard key={p.id} store={store} product={p} content={content} />
        ))}
      </MotionUl>
    )}
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="border-t border-border">
    <div className={cn(wrap, "py-28")}>
      <h2 className={cn(eyebrow, "mb-10 text-center")}>{content["bestSellers.heading"]}</h2>
      {bestSellers.length === 0 ? (
        <p className="text-center text-muted-foreground">{content["bestSellers.empty"]}</p>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4"
        >
          {bestSellers.map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} ratio="aspect-square" />
          ))}
        </MotionUl>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <section className="bg-secondary text-secondary-foreground">
    <MotionDiv
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="mx-auto max-w-2xl px-6 py-24 text-center"
    >
      <MotionH2 variants={fadeUp} className="text-3xl font-light tracking-tight sm:text-4xl">
        {content["promoBanner.heading"]}
      </MotionH2>
      {content["promoBanner.subtext"] && (
        <MotionP variants={fadeUp} className="mt-4 whitespace-pre-line leading-relaxed opacity-80">
          {content["promoBanner.subtext"]}
        </MotionP>
      )}
      <MotionDiv variants={fadeUp}>
        <Link
          href={sectionHref(store, "new-arrivals")}
          className={cn(outlineCta, "mt-8 border-current bg-transparent")}
        >
          {content["promoBanner.ctaLabel"]}
        </Link>
      </MotionDiv>
    </MotionDiv>
  </section>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-28")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(
          "grid items-center gap-14",
          image ? "md:grid-cols-2" : "mx-auto max-w-2xl text-center",
        )}
      >
        {image && (
          <MotionDiv variants={fadeUp}>
            <Picture src={image} alt={store.name} className="aspect-[4/5]" />
          </MotionDiv>
        )}
        <div>
          {content["brandStory.heading"] && (
            <MotionH2 variants={fadeUp} className="text-3xl font-light tracking-tight sm:text-4xl">
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          {content["brandStory.body"] && (
            <MotionP variants={fadeUp} className="mt-6 whitespace-pre-line leading-loose text-muted-foreground">
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
    <div className={cn(wrap, "py-28")}>
      <h2 className={cn(eyebrow, "mb-12 text-center")}>{content["reviews.heading"]}</h2>
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-12 md:grid-cols-3"
      >
        {reviews.map((r, i) => (
          <MotionLi key={i} variants={fadeUp}>
            <blockquote className="text-lg font-light leading-relaxed">
              &ldquo;{r.quote}&rdquo;
            </blockquote>
            {r.author && <p className={cn(eyebrow, "mt-5")}>{r.author}</p>}
          </MotionLi>
        ))}
      </MotionUl>
    </div>
  </section>
);

const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className={cn(wrap, "py-28")}>
    <div className="mb-10 text-center">
      <h2 className={eyebrow}>{content["instagram.heading"]}</h2>
      {instagram.url && (
        <a
          href={instagram.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm hover:text-accent"
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
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
      >
        {instagram.tiles.map((t, i) => (
          <MotionLi key={i} variants={fadeUp}>
            <Picture src={t.image} alt={store.name} className="aspect-square" />
          </MotionLi>
        ))}
      </MotionUl>
    )}
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, pages } }) => (
  <footer className="border-t border-border">
    <div className={cn(wrap, "py-14 text-center")}>
      <p className="mx-auto max-w-md whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
        {content["footer.about"]}
      </p>
      {pages.length > 0 && (
        <nav className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          {pages.map((pg) => (
            <Link key={pg.slug} href={pg.href} className={cn(eyebrow, "hover:text-foreground")}>
              {pg.label}
            </Link>
          ))}
        </nav>
      )}
      <p className={cn(eyebrow, "mt-8")}>{fillTokens(content["footer.copyright"], store)}</p>
    </div>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-12")}>
        <Link
          href={`/store/${store.slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; {content["product.back"]}
        </Link>

        <div className="mt-10 grid gap-12 lg:grid-cols-12">
          <div className="grid gap-3 lg:col-span-7">
            <ProductImage className="aspect-[4/5]" />
            <ProductGallery />
          </div>
          <div className="lg:col-span-5 lg:pt-8">
            <h1 className="text-3xl font-light tracking-tight sm:text-4xl">{product.name}</h1>
            <p className="mt-3 text-xl text-muted-foreground">
              <ProductPrice />
            </p>
            <div className="mt-8">
              <VariantPicker
                look="minimal"
                labelClassName="text-xs font-normal uppercase tracking-[0.2em] text-muted-foreground"
              />
            </div>
            <StockStatus look="dot" className="mt-6 block" />
            <div className="mt-6">
              <AddToCart look="minimal" slug={store.slug} />
            </div>
            {product.description && (
              <div className="mt-10 border-t border-border pt-8">
                <h2 className={eyebrow}>{content["product.descriptionHeading"]}</h2>
                <p className="mt-4 whitespace-pre-line leading-relaxed text-muted-foreground">
                  {product.description}
                </p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-28">
            <h2 className={cn(eyebrow, "mb-10 text-center")}>{content["product.relatedHeading"]}</h2>
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-4"
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
    className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-6xl px-6 py-16",
  title: "text-3xl font-light tracking-tight sm:text-4xl",
  subtitle: "text-sm text-muted-foreground",
  chip: "rounded-full border border-border px-4 py-1.5 text-xs tracking-wide hover:bg-muted",
  panel: "border-t border-border pt-8",
};

export const minimalTemplate: Template = {
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

