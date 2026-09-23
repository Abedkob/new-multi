import Link from "next/link";
import type { Variants } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fillTokens, type ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionUl } from "../motion";
import { HeroPicture, Picture, StoreBrand, StoreMenuButton, cardPrice, productHref, sectionHref, shopHref, storeHref } from "../shared";
import { CartLink, SearchBox } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import type {
  SectionComponent,
  StoreInfo,
  StoreProduct,
  Template,
} from "../types";

/**
 * "Classic": traditional shop. Utility bar, header with search, nav bar, bordered rounded
 * cards, serif headings, structured grids, breadcrumbs. The search box is a visual
 * placeholder for now (no search yet). Colors only come from theme tokens.
 */

const serif = "font-serif";
const wrap = "mx-auto max-w-7xl px-5";
const sectionHeading = cn(
  serif,
  "mb-6 border-b border-border pb-3 text-2xl font-bold",
);

/**
 * "Classic"'s animation language: a refined fade with a slight scale-up, like a photo
 * settling into a frame — quicker and calmer than a slide, matching the bordered-card,
 * traditional-shop feel.
 */
const settle: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.03 } },
};
// A tiny threshold: a long product grid on a phone can be several screens tall, so "25% in
// view" would never be reached and the grid would stay invisible until scrolled far enough.
const viewport = { once: true, amount: 0.05 } as const;

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-primary px-4 py-1.5 text-center text-xs text-primary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
  <header className="border-b border-border bg-background">
    <div className={cn(wrap, "flex items-center gap-x-4 py-3 md:gap-x-8 md:py-5")}>
      <StoreMenuButton data={data} className="-ml-2 md:hidden" />
      <StoreBrand
        store={store}
        content={content}
        className={cn(serif, "min-w-0 truncate text-xl font-bold tracking-tight text-primary md:text-3xl")}
        logoClassName="h-8 md:h-9"
      />
      <SearchBox
        slug={store.slug}
        basePath={store.basePath}
        placeholder={content["search.placeholder"]}
        buttonLabel={content["search.button"]}
        className="ml-auto hidden w-96 max-w-md md:flex"
        inputClassName="w-full"
        buttonClassName="rounded-md bg-primary font-medium text-primary-foreground"
      />
      <CartLink
        basePath={store.basePath}
        className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted md:ml-0"
      />
    </div>
    <nav className="hidden bg-primary text-primary-foreground md:block">
      <ul className={cn(wrap, "flex gap-x-6 overflow-x-auto py-2.5 text-sm")}>
        <li>
          <Link href={shopHref(store)} className="font-semibold">
            {content["navbar.shopLabel"]}
          </Link>
        </li>
        {categoryTiles.map((c) => (
          <li key={c.id} className="whitespace-nowrap opacity-90">
            <Link href={c.href}>{c.label}</Link>
          </li>
        ))}
        {pages.map((pg) => (
          <li key={pg.slug} className="ml-auto whitespace-nowrap opacity-90 first-of-type:ml-auto [&+li]:ml-0">
            <Link href={pg.href}>{pg.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => (
  <div className={cn(wrap, "pt-8")}>
    <section className="grid overflow-hidden rounded-lg border border-border bg-secondary text-secondary-foreground md:grid-cols-5">
      {visibility.heroText && (
        <MotionDiv
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="p-8 sm:p-12 md:col-span-3"
        >
          <MotionH1 variants={settle} className={cn(serif, "text-3xl font-bold leading-tight sm:text-5xl")}>
            {content["hero.headline"]}
          </MotionH1>
          <MotionP variants={settle} className="mt-4 max-w-lg whitespace-pre-line leading-relaxed opacity-80">
            {content["hero.subtext"]}
          </MotionP>
          <MotionDiv variants={settle}>
            <Link
              href={sectionHref(store, "new-arrivals")}
              className={cn(buttonVariants({ size: "lg" }), "mt-8")}
            >
              {content["hero.ctaLabel"]}
            </Link>
          </MotionDiv>
        </MotionDiv>
      )}
      {(content["hero.image"] || content["hero.imageMobile"]) && (
        <MotionDiv
          initial="hidden"
          animate="visible"
          variants={settle}
          className={cn("min-h-48", visibility.heroText ? "md:col-span-2" : "md:col-span-5")}
        >
          <HeroPicture content={content} alt={store.name} className="h-full" mobileClassName="aspect-[4/5]" />
        </MotionDiv>
      )}
    </section>
  </div>
);

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "pt-12")}>
    <h2 className={sectionHeading}>{content["featuredCategories.heading"]}</h2>
    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5"
    >
      {categoryTiles.map((c) => (
        <MotionLi key={c.id} variants={settle}>
          <Link href={c.href} className="group block">
            <Card className="gap-0 overflow-hidden rounded-md py-0 shadow-sm transition group-hover:shadow-md">
              <Picture src={c.image} alt={c.label} className="aspect-[16/10]" />
              <CardContent className="flex items-center justify-between px-4 py-3">
                <span className={cn(serif, "text-lg font-semibold group-hover:text-primary")}>
                  {c.label}
                </span>
                <span aria-hidden className="text-primary">
                  &rarr;
                </span>
              </CardContent>
            </Card>
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
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
}) {
  const inStock = product.inStock;
  const href = productHref(store, product);
  return (
    <MotionLi variants={settle}>
      <Card className="h-full gap-0 rounded-md py-0 shadow-sm">
        <Link href={href}>
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="aspect-square rounded-t-md"
          />
        </Link>
        <CardHeader className="gap-1 px-4 pt-4">
          <CardTitle className={cn(serif, "text-base font-semibold")}>
            <Link href={href} className="hover:text-primary hover:underline">
              {product.name}
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 px-4 pt-2">
          <span className="text-lg font-bold text-accent">{cardPrice(product, content)}</span>
          <Badge variant={inStock ? "secondary" : "outline"}>
            {inStock ? content["product.inStock"] : content["product.outOfStock"]}
          </Badge>
        </CardContent>
        <CardFooter className="mt-auto border-0 bg-transparent px-4 py-4">
          <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            {content["product.viewLabel"]}
          </Link>
        </CardFooter>
      </Card>
    </MotionLi>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "pt-12")}>
    <h2 className={sectionHeading}>{content["newArrivals.heading"]}</h2>
    {newArrivals.length === 0 ? (
      <p className="text-muted-foreground">{content["newArrivals.empty"]}</p>
    ) : (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4"
      >
        {newArrivals.map((p) => (
          <ProductCard key={p.id} store={store} product={p} content={content} />
        ))}
      </MotionUl>
    )}
  </section>
);

// Best sellers use a compact horizontal card so the section reads differently from the grid above.
const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className={cn(wrap, "pt-12")}>
    <h2 className={sectionHeading}>{content["bestSellers.heading"]}</h2>
    {bestSellers.length === 0 ? (
      <p className="text-muted-foreground">{content["bestSellers.empty"]}</p>
    ) : (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-4 md:grid-cols-2"
      >
        {bestSellers.map((p, i) => (
          <MotionLi key={p.id} variants={settle}>
            <Card className="flex-row gap-0 overflow-hidden rounded-md py-0 shadow-sm">
              <Link href={productHref(store, p)} className="w-28 shrink-0 sm:w-36">
                <Picture src={p.imageUrl} alt={p.name} className="aspect-square h-full w-full" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4">
                <Badge className="w-fit bg-accent text-accent-foreground">#{i + 1}</Badge>
                <Link
                  href={productHref(store, p)}
                  className={cn(serif, "truncate font-semibold hover:text-primary hover:underline")}
                >
                  {p.name}
                </Link>
                <span className="font-bold text-accent">{cardPrice(p, content)}</span>
              </div>
            </Card>
          </MotionLi>
        ))}
      </MotionUl>
    )}
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <div className={cn(wrap, "pt-12")}>
    <MotionDiv
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="flex flex-col items-start justify-between gap-6 rounded-lg bg-primary p-8 text-primary-foreground sm:flex-row sm:items-center sm:p-10"
    >
      <div>
        <MotionH2 variants={settle} className={cn(serif, "text-2xl font-bold sm:text-3xl")}>
          {content["promoBanner.heading"]}
        </MotionH2>
        {content["promoBanner.subtext"] && (
          <MotionP variants={settle} className="mt-2 max-w-xl whitespace-pre-line opacity-90">
            {content["promoBanner.subtext"]}
          </MotionP>
        )}
      </div>
      <MotionDiv variants={settle}>
        <Link
          href={sectionHref(store, "new-arrivals")}
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "shrink-0")}
        >
          {content["promoBanner.ctaLabel"]}
        </Link>
      </MotionDiv>
    </MotionDiv>
  </div>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <div className="mt-12 bg-secondary text-secondary-foreground">
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(wrap, "grid items-center gap-8 py-12", image && "md:grid-cols-2")}
      >
        <div>
          {content["brandStory.heading"] && (
            <MotionH2 variants={settle} className={cn(serif, "text-2xl font-bold sm:text-3xl")}>
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          {content["brandStory.body"] && (
            <MotionP variants={settle} className="mt-4 whitespace-pre-line leading-relaxed opacity-85">
              {content["brandStory.body"]}
            </MotionP>
          )}
        </div>
        {image && (
          <MotionDiv variants={settle}>
            <Card className="overflow-hidden rounded-md py-0 shadow-sm">
              <Picture src={image} alt={store.name} className="aspect-[4/3]" />
            </Card>
          </MotionDiv>
        )}
      </MotionDiv>
    </div>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className={cn(wrap, "pt-12")}>
    <h2 className={sectionHeading}>{content["reviews.heading"]}</h2>
    <MotionUl
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={stagger}
      className="grid gap-5 md:grid-cols-3"
    >
      {reviews.map((r, i) => (
        <MotionLi key={i} variants={settle}>
          <Card className="h-full rounded-md shadow-sm">
            <CardContent className="grid gap-4">
              <blockquote className={cn(serif, "text-lg italic leading-relaxed")}>
                &ldquo;{r.quote}&rdquo;
              </blockquote>
              {r.author && (
                <>
                  <Separator />
                  <p className="text-sm font-semibold text-primary">{r.author}</p>
                </>
              )}
            </CardContent>
          </Card>
        </MotionLi>
      ))}
    </MotionUl>
  </section>
);

const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className={cn(wrap, "pt-12")}>
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
      <h2 className={cn(serif, "text-2xl font-bold")}>{content["instagram.heading"]}</h2>
      {instagram.url && (
        <a
          href={instagram.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-primary hover:underline"
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
        className="grid grid-cols-3 gap-3 md:grid-cols-6"
      >
        {instagram.tiles.map((t, i) => (
          <MotionLi key={i} variants={settle}>
            <Picture
              src={t.image}
              alt={store.name}
              className="aspect-square rounded-md border border-border"
            />
          </MotionLi>
        ))}
      </MotionUl>
    )}
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, categoryTiles, pages } }) => (
  <footer className="mt-14 border-t border-border bg-secondary text-secondary-foreground">
    <div className={cn(wrap, "grid gap-10 py-12 md:grid-cols-4")}>
      <div className="md:col-span-2">
        <p className={cn(serif, "text-xl font-bold")}>{store.name}</p>
        <p className="mt-3 max-w-lg whitespace-pre-line text-sm leading-relaxed opacity-80">
          {content["footer.about"]}
        </p>
      </div>
      {categoryTiles.length > 0 && (
        <div>
          <p className="text-sm font-semibold">{content["featuredCategories.heading"]}</p>
          <ul className="mt-3 grid gap-1.5 text-sm opacity-80">
            {categoryTiles.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className="hover:underline">
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pages.length > 0 && (
        <div>
          <p className="text-sm font-semibold">{store.name}</p>
          <ul className="mt-3 grid gap-1.5 text-sm opacity-80">
            {pages.map((pg) => (
              <li key={pg.slug}>
                <Link href={pg.href} className="hover:underline">
                  {pg.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    <Separator />
    <p className="px-5 py-4 text-center text-xs opacity-70">
      {fillTokens(content["footer.copyright"], store)}
    </p>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-8")}>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href={storeHref(store)} className="hover:text-primary hover:underline">
            {store.name}
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={sectionHref(store, "new-arrivals")}
            className="hover:text-primary hover:underline"
          >
            {content["navbar.shopLabel"]}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{product.name}</span>
        </nav>

        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <div className="grid gap-3">
            <Card className="overflow-hidden rounded-md py-0 shadow-sm">
              <ProductImage className="aspect-square" />
            </Card>
            <ProductGallery />
          </div>
          <div>
            <h1 className={cn(serif, "text-3xl font-bold leading-tight sm:text-4xl")}>
              {product.name}
            </h1>
            <div className="mt-4 flex items-center gap-4">
              <span className="text-3xl font-bold text-accent">
                <ProductPrice />
              </span>
              <StockStatus look="classicBadge" />
            </div>
            <div className="mt-6">
              <VariantPicker look="classic" labelClassName={serif} />
            </div>
            <div className="mt-6">
              <AddToCart look="classic" basePath={store.basePath} />
            </div>
            <Separator className="my-6" />
            {product.description && (
              <>
                <h2 className={cn(serif, "text-lg font-semibold")}>
                  {content["product.descriptionHeading"]}
                </h2>
                <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">
                  {product.description}
                </p>
              </>
            )}
            <Link
              href={storeHref(store)}
              className={cn(buttonVariants({ variant: "outline" }), "mt-8")}
            >
              &larr; {content["product.back"]}
            </Link>
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-14">
            <h2 className={sectionHeading}>{content["product.relatedHeading"]}</h2>
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4"
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
    className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-7xl px-5 py-8",
  title: "font-serif text-3xl font-bold leading-tight sm:text-4xl",
  subtitle: "text-sm text-muted-foreground",
  chip: "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted hover:text-primary",
  panel: "rounded-md border border-border p-5 shadow-sm",
};

export const classicTemplate: Template = {
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
  Instagram,
  Footer,
  ProductPage,
};
