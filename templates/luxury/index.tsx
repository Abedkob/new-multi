import Link from "next/link";
import type { Variants } from "motion/react";
import { buttonVariants } from "@/components/ui/button";
import type { ContentMap } from "@/lib/content";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv, MotionH1, MotionH2, MotionLi, MotionP, MotionSection, MotionUl } from "../motion";
import { Picture, StoreBrand, cardPrice, productHref, sectionHref } from "../shared";
import { CartLink, SearchBox, CategoryMenu } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import type {
  SectionComponent,
  StoreInfo,
  StoreProduct,
  Template,
} from "../types";

const wrap = "mx-auto max-w-7xl px-4 sm:px-8";
const outlineCta = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-14 px-10 text-sm font-medium tracking-widest uppercase border-primary text-primary bg-transparent hover:bg-primary hover:text-primary-foreground transition-all duration-300 rounded-none",
);
const solidCta = cn(
  buttonVariants({ variant: "default", size: "lg" }),
  "h-14 px-10 text-sm font-medium tracking-widest uppercase bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 rounded-none",
);

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] } },
};
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.1 } },
};
const viewport = { once: true, amount: 0.2 } as const;

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-primary px-6 py-3 text-center text-xs font-light tracking-widest uppercase text-primary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data: { store, content, categoryTiles, pages } }) => (
  <header className="sticky top-0 z-40 w-full bg-background/95 backdrop-blur-sm border-b border-border/50">
    <div className={cn(wrap, "flex items-center justify-between py-6")}>
      <div className="flex-1 md:hidden">
        <CategoryMenu categories={categoryTiles} />
      </div>
      <nav className="hidden flex-1 items-center gap-8 md:flex">
        <CategoryMenu categories={categoryTiles} />
        <Link href={`/store/${store.slug}/shop`} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity">
          {content["navbar.shopLabel"]}
        </Link>
        {categoryTiles.slice(0, 2).map((c) => (
          <Link key={c.id} href={c.href} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity">
            {c.label}
          </Link>
        ))}
        {pages.map((pg) => (
          <Link key={pg.slug} href={pg.href} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity">
            {pg.label}
          </Link>
        ))}
      </nav>
      
      <div className="flex-1 text-center md:flex-none">
        <StoreBrand
          store={store}
          content={content}
          className="text-3xl font-serif tracking-tight"
          logoClassName="h-10 mx-auto"
        />
      </div>

      <div className="flex flex-1 items-center justify-end gap-6">
        <SearchBox
          slug={store.slug}
          placeholder={content["search.placeholder"]}
          buttonLabel={content["search.button"]}
          className="hidden md:flex"
          inputClassName="h-10 w-48 bg-transparent border-b border-border rounded-none px-0 text-sm focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/60 tracking-wide font-light"
          buttonClassName="sr-only"
        />
        <CartLink
          slug={store.slug}
          className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity"
        />
      </div>
    </div>
  </header>
);

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => {
  const hasImage = Boolean(content["hero.image"] || content["hero.imageMobile"]);

  return (
    <section className="relative flex flex-col justify-center min-h-[85vh] md:min-h-screen bg-secondary">
      {/* Background Image & Overlay */}
      {hasImage && (
        <div className="absolute inset-0 z-0">
          {content["hero.imageMobile"] && (
            <Picture
              src={content["hero.imageMobile"]}
              alt={store.name}
              className={cn("h-full w-full object-cover", content["hero.image"] ? "block sm:hidden" : "block")}
              imgClassName="h-full w-full object-cover object-center transform scale-105 transition-transform duration-[20s] ease-out"
              sizes="100vw"
            />
          )}
          {content["hero.image"] && (
            <Picture
              src={content["hero.image"]}
              alt={store.name}
              className={cn("h-full w-full object-cover", content["hero.imageMobile"] ? "hidden sm:block" : "block")}
              imgClassName="h-full w-full object-cover object-center transform scale-105 transition-transform duration-[20s] ease-out"
              sizes="100vw"
            />
          )}
          {/* Subtle gradient for text readability */}
          <div className="absolute inset-0 bg-black/30" />
        </div>
      )}

      {/* Content Container */}
      <div className="relative z-10 w-full mx-auto max-w-5xl px-5 text-center flex flex-col items-center justify-center">
        {visibility.heroText && (
          <MotionDiv
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="text-white w-full max-w-3xl"
          >
            <MotionH1
              variants={fadeUp}
              className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-serif font-light tracking-tight leading-[1.1] mb-6"
            >
              {content["hero.headline"]}
            </MotionH1>

            {content["hero.subtext"] && (
              <MotionP
                variants={fadeUp}
                className="mt-6 text-base sm:text-lg md:text-xl font-light text-white/90 max-w-xl mx-auto leading-relaxed"
              >
                {content["hero.subtext"]}
              </MotionP>
            )}

            {content["hero.ctaLabel"] && (
              <MotionDiv
                variants={fadeUp}
                className="mt-12"
              >
                <Link
                  href={sectionHref(store, "new-arrivals")}
                  className={cn(
                    "inline-flex items-center justify-center text-center px-12 py-4 text-xs font-medium tracking-[0.2em] uppercase",
                    "bg-white text-black hover:bg-black hover:text-white transition-colors duration-500"
                  )}
                >
                  {content["hero.ctaLabel"]}
                </Link>
              </MotionDiv>
            )}
          </MotionDiv>
        )}
      </div>
    </section>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-32")}>
    <h2 className="mb-16 text-center text-4xl font-serif font-light tracking-tight">{content["featuredCategories.heading"]}</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {categoryTiles.slice(0, 3).map((c, i) => (
        <MotionDiv key={c.id} variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewport} className="group cursor-pointer">
          <Link href={c.href} className="block">
            <div className="overflow-hidden aspect-[3/4] bg-secondary relative">
              <Picture
                src={c.image}
                alt={c.label}
                className="h-full w-full"
                imgClassName="h-full w-full object-cover transition-transform duration-1000 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-black/10 transition-colors duration-500 group-hover:bg-black/0" />
            </div>
            <div className="mt-8 text-center">
              <h3 className="text-xl font-serif tracking-wide">{c.label}</h3>
              <p className="text-xs uppercase tracking-widest mt-2 text-muted-foreground group-hover:text-primary transition-colors">Explore</p>
            </div>
          </Link>
        </MotionDiv>
      ))}
    </div>
  </section>
);

function ProductCard({ store, product, content }: { store: StoreInfo; product: StoreProduct; content: ContentMap }) {
  return (
    <MotionLi variants={fadeUp} className="group">
      <Link href={productHref(store, product)} className="block">
        <div className="overflow-hidden bg-secondary relative aspect-[2/3]">
          <Picture
            src={product.imageUrl}
            alt={product.name}
            className="absolute inset-0 h-full w-full"
            imgClassName="object-cover transition-transform duration-1000 group-hover:scale-105"
          />
        </div>
        <div className="mt-6 text-center">
          <h3 className="text-lg font-serif font-light text-foreground">{product.name}</h3>
          <span className="text-sm font-light text-muted-foreground mt-2 block tracking-wide">{cardPrice(product, content)}</span>
        </div>
      </Link>
    </MotionLi>
  );
}

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className={cn(wrap, "py-32 border-t border-border")}>
    <h2 className="mb-20 text-center text-4xl font-serif font-light tracking-tight">{content["newArrivals.heading"]}</h2>
    {newArrivals.length === 0 ? (
      <p className="text-center text-muted-foreground font-light">{content["newArrivals.empty"]}</p>
    ) : (
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-x-8 gap-y-16 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        {newArrivals.map((p) => (
          <ProductCard key={p.id} store={store} product={p} content={content} />
        ))}
      </MotionUl>
    )}
  </section>
);

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="bg-secondary/50">
    <div className={cn(wrap, "py-32")}>
      <h2 className="mb-20 text-center text-4xl font-serif font-light tracking-tight">{content["bestSellers.heading"]}</h2>
      {bestSellers.length === 0 ? (
        <p className="text-center text-muted-foreground font-light">{content["bestSellers.empty"]}</p>
      ) : (
        <MotionUl
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
          className="grid gap-x-8 gap-y-16 grid-cols-2 lg:grid-cols-4"
        >
          {bestSellers.map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} />
          ))}
        </MotionUl>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <section className="py-0">
    <div className="bg-primary text-primary-foreground">
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="mx-auto max-w-4xl px-6 py-32 text-center"
      >
        <MotionH2 variants={fadeUp} className="text-4xl font-serif font-light tracking-tight sm:text-6xl">
          {content["promoBanner.heading"]}
        </MotionH2>
        {content["promoBanner.subtext"] && (
          <MotionP variants={fadeUp} className="mt-8 whitespace-pre-line text-lg font-light text-primary-foreground/70 tracking-wide leading-relaxed">
            {content["promoBanner.subtext"]}
          </MotionP>
        )}
        <MotionDiv variants={fadeUp} className="mt-14">
          <Link
            href={sectionHref(store, "new-arrivals")}
            className="inline-flex items-center justify-center text-center px-12 py-4 text-xs font-medium tracking-[0.2em] uppercase border border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary transition-colors duration-500"
          >
            {content["promoBanner.ctaLabel"]}
          </Link>
        </MotionDiv>
      </MotionDiv>
    </div>
  </section>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  const image = content["brandStory.image"];
  return (
    <section className={cn(wrap, "py-32")}>
      <MotionDiv
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className={cn(
          "grid items-center gap-20",
          image ? "md:grid-cols-2" : "mx-auto max-w-4xl text-center",
        )}
      >
        <div className="order-last md:order-first">
          {content["brandStory.heading"] && (
            <MotionH2 variants={fadeUp} className="text-4xl font-serif font-light tracking-tight sm:text-5xl">
              {content["brandStory.heading"]}
            </MotionH2>
          )}
          <div className="w-12 h-px bg-foreground mt-8 opacity-20" />
          {content["brandStory.body"] && (
            <MotionP variants={fadeUp} className="mt-8 whitespace-pre-line text-lg font-light leading-loose text-muted-foreground">
              {content["brandStory.body"]}
            </MotionP>
          )}
        </div>
        {image && (
          <MotionDiv variants={fadeUp} className="">
            <div className="overflow-hidden aspect-[4/5] bg-secondary">
              <Picture src={image} alt={store.name} className="h-full w-full" imgClassName="object-cover" />
            </div>
          </MotionDiv>
        )}
      </MotionDiv>
    </section>
  );
};

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="border-t border-border">
    <div className={cn(wrap, "py-32")}>
      <h2 className="mb-20 text-center text-4xl font-serif font-light tracking-tight">{content["reviews.heading"]}</h2>
      <MotionUl
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        variants={stagger}
        className="grid gap-12 md:grid-cols-3"
      >
        {reviews.map((r, i) => (
          <MotionLi key={i} variants={fadeUp} className="text-center px-4">
            <blockquote className="text-xl font-serif font-light leading-relaxed text-foreground italic">
              &ldquo;{r.quote}&rdquo;
            </blockquote>
            {r.author && <p className="mt-8 text-xs uppercase tracking-widest text-muted-foreground">&mdash; {r.author}</p>}
          </MotionLi>
        ))}
      </MotionUl>
    </div>
  </section>
);

const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className="py-24 overflow-hidden">
    <div className="mb-16 text-center px-6">
      <h2 className="text-3xl font-serif font-light tracking-tight">{content["instagram.heading"]}</h2>
      {instagram.url && (
        <a
          href={instagram.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm font-light tracking-widest text-muted-foreground hover:text-primary transition-colors uppercase"
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
        className="flex w-full overflow-hidden"
      >
        {instagram.tiles.slice(0, 5).map((t, i) => (
          <MotionLi key={i} variants={fadeUp} className="flex-1 min-w-[20vw] aspect-square relative group">
            <Picture src={t.image} alt={store.name} className="h-full w-full" imgClassName="object-cover transition-transform duration-700 group-hover:scale-105" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-500" />
          </MotionLi>
        ))}
      </MotionUl>
    )}
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, pages } }) => (
  <footer className="bg-primary text-primary-foreground border-t border-primary-foreground/10">
    <div className={cn(wrap, "py-24")}>
      <div className="grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <StoreBrand
            store={store}
            content={content}
            className="text-4xl font-serif font-light text-white tracking-tight"
            logoClassName="h-12"
          />
          <p className="mt-8 max-w-sm whitespace-pre-line text-sm font-light leading-relaxed text-primary-foreground/70">
            {content["footer.about"]}
          </p>
        </div>
        
        <div className="md:col-span-3 md:col-start-8">
          <h3 className="mb-8 text-xs font-medium uppercase tracking-[0.2em] text-white">Explore</h3>
          <ul className="space-y-4">
            {pages.map((pg) => (
              <li key={pg.slug}>
                <Link href={pg.href} className="text-sm font-light text-primary-foreground/70 hover:text-white transition-colors">
                  {pg.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`/store/${store.slug}/shop`} className="text-sm font-light text-primary-foreground/70 hover:text-white transition-colors">
                Shop All
              </Link>
            </li>
          </ul>
        </div>
        
        <div className="md:col-span-2">
          <h3 className="mb-8 text-xs font-medium uppercase tracking-[0.2em] text-white">Social</h3>
          <ul className="space-y-4">
            <li><a href="#" className="text-sm font-light text-primary-foreground/70 hover:text-white transition-colors">Instagram</a></li>
            <li><a href="#" className="text-sm font-light text-primary-foreground/70 hover:text-white transition-colors">Pinterest</a></li>
            <li><a href="#" className="text-sm font-light text-primary-foreground/70 hover:text-white transition-colors">Twitter</a></li>
          </ul>
        </div>
      </div>
      
      <div className="mt-32 pt-8 border-t border-primary-foreground/10 flex flex-col md:flex-row justify-between items-center text-xs font-light text-primary-foreground/50 tracking-widest uppercase">
        <p>{fillTokens(content["footer.copyright"], store)}</p>
        <p className="mt-4 md:mt-0">All Rights Reserved</p>
      </div>
    </div>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-16 md:py-24")}>
        <div className="mb-12">
          <Link
            href={`/store/${store.slug}`}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            &larr; {content["product.back"]}
          </Link>
        </div>

        <div className="grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="bg-secondary aspect-[3/4] mb-4">
              <ProductImage className="h-full w-full object-cover" />
            </div>
            <ProductGallery className="grid grid-cols-2 gap-4" />
          </div>
          
          <div className="lg:col-span-4 lg:col-start-9 lg:sticky lg:top-32 lg:self-start">
            <h1 className="text-3xl sm:text-4xl font-serif font-light tracking-tight">{product.name}</h1>
            <p className="mt-4 text-xl font-light tracking-wide text-muted-foreground">
              <ProductPrice />
            </p>
            
            <div className="my-10 w-full h-px bg-border" />
            
            <div className="space-y-8">
              <VariantPicker
                look="minimal"
                labelClassName="text-xs uppercase tracking-widest font-medium mb-4 block"
              />
              
              <StockStatus look="dot" className="block text-sm font-light" />
              
              <div className="pt-4">
                <AddToCart look="solid" slug={store.slug} />
              </div>
            </div>
            
            {product.description && (
              <div className="mt-16 pt-8 border-t border-border">
                <h2 className="text-xs uppercase tracking-widest font-medium mb-6">{content["product.descriptionHeading"]}</h2>
                <p className="whitespace-pre-line text-sm font-light leading-loose text-muted-foreground">
                  {product.description}
                </p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-40 border-t border-border pt-32">
            <h2 className="mb-16 text-center text-3xl font-serif font-light tracking-tight">{content["product.relatedHeading"]}</h2>
            <MotionUl
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={stagger}
              className="grid gap-x-8 gap-y-16 grid-cols-2 lg:grid-cols-4"
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
    className="grid gap-x-8 gap-y-16 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
  >
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </MotionUl>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-3xl px-6 py-32",
  title: "text-5xl font-serif font-light tracking-tight mb-4 text-center",
  subtitle: "text-lg font-light text-muted-foreground text-center",
  chip: "rounded-none border border-border px-6 py-2 text-xs uppercase tracking-widest hover:bg-secondary transition-colors",
  panel: "mt-16 p-0 bg-transparent",
};

export const luxuryTemplate: Template = {
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
