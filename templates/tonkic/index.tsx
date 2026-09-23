import Link from "next/link";
import type { Variants } from "motion/react";
import { buttonVariants } from "@/components/ui/button";
import type { ContentMap } from "@/lib/content";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MotionDiv } from "../motion";
import { HeroPicture, Picture, StoreBrand, StoreMenuButton, cardPrice, productHref, searchHref, sectionHref, shopHref } from "../shared";
import { CartLink, SearchBox } from "../nav-client";
import { ProductGallery, ProductImage, ProductPrice, ProductProvider, StockStatus, VariantPicker, AddToCart } from "../product-client";
import { ArrowRight, Search, ShoppingCart } from "lucide-react";
import type {
  SectionComponent,
  StoreInfo,
  StoreProduct,
  Template,
} from "../types";

const wrap = "mx-auto max-w-[1200px] px-6";
const blackCta = cn(
  buttonVariants({ variant: "default", size: "lg" }),
  "rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-8 h-12 text-sm font-medium transition-all"
);

/**
 * "Tonkic"'s animation language: a soft blur-to-focus "materialize", matching its rounded,
 * soft-shadow, modern-product-photography look — distinct from a plain fade or slide.
 */
const materialize: Variants = {
  hidden: { opacity: 0, scale: 0.94, filter: "blur(8px)" },
  visible: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};
const bgFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 1.2, ease: "easeOut" } },
};

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-primary px-6 py-2 text-center text-xs text-primary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data }) => {
  const { store, content, categoryTiles, pages } = data;
  return (
  <header className="border-b border-border/60 bg-background/90 backdrop-blur-md">
    <div className={cn(wrap, "flex items-center justify-between gap-3 py-4 md:py-5")}>
      <StoreMenuButton data={data} className="-ml-2 md:hidden" />
      <StoreBrand
        store={store}
        content={content}
        className="min-w-0 truncate text-lg font-bold tracking-tight text-foreground sm:text-2xl"
        logoClassName="h-8 sm:h-9"
      />
      
      <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground">
        <Link href={shopHref(store)} className="hover:opacity-70 transition">
          {content["navbar.shopLabel"]}
        </Link>
        {categoryTiles.slice(0, 3).map((c) => (
          <Link key={c.id} href={c.href} className="hover:opacity-70 transition">
            {c.label}
          </Link>
        ))}
        {pages.map((pg) => (
          <Link key={pg.slug} href={pg.href} className="hover:opacity-70 transition">
            {pg.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-5 text-foreground">
        <SearchBox
          slug={store.slug}
          basePath={store.basePath}
          placeholder={content["search.placeholder"]}
          buttonLabel={content["search.button"]}
          className="hidden md:flex"
          inputClassName="h-9 w-48 rounded-full border-border text-sm bg-muted/50 focus-visible:bg-background transition-colors text-foreground"
          buttonClassName="sr-only"
        />
        <Link href={searchHref(store)} className="md:hidden">
          <Search className="w-5 h-5 cursor-pointer hover:opacity-70 transition" />
        </Link>
        
        <CartLink
          basePath={store.basePath}
          className="text-sm font-medium hover:opacity-70 transition flex items-center gap-1"
        />
      </div>
    </div>
  </header>
  );
};

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => (
  <section className="relative flex min-h-[520px] items-center overflow-hidden bg-background py-16 md:min-h-[640px] md:py-20">
    {content["hero.image"] || content["hero.imageMobile"] ? (
      <MotionDiv initial="hidden" animate="visible" variants={bgFade} className="absolute inset-0 z-0">
        <HeroPicture content={content} alt={store.name} className="h-full w-full" />
      </MotionDiv>
    ) : (
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-secondary/50 via-secondary/20 to-background" />
    )}

    {visibility.heroText && (
      <div className={cn(wrap, "relative z-10 w-full")}>
        <MotionDiv
          initial="hidden"
          animate="visible"
          variants={materialize}
          className="max-w-xl rounded-[2rem] border border-border/40 bg-background/60 p-6 shadow-2xl backdrop-blur-md sm:p-8 md:p-10"
        >
          <h1 className="mb-5 text-4xl leading-[1.1] font-semibold tracking-tight text-foreground sm:text-5xl md:text-[64px]">
            {content["hero.headline"]}
          </h1>
          {content["hero.subtext"] && (
            <p className="mb-8 whitespace-pre-line text-base leading-relaxed font-medium text-foreground/90 sm:text-lg">
              {content["hero.subtext"]}
            </p>
          )}
          {content["hero.ctaLabel"] && (
            <Link href={sectionHref(store, "new-arrivals")} className={blackCta}>
              {content["hero.ctaLabel"]} <ArrowRight className="ml-2 w-4 h-4 inline" />
            </Link>
          )}
        </MotionDiv>
      </div>
    )}
  </section>
);

const BrandStory: SectionComponent = ({ data: { store, content, pages } }) => {
  const image = content["brandStory.image"];
  const about = pages.find((pg) => pg.slug === "about");
  return (
    <section className={cn(wrap, "py-16 md:py-24")}>
      {content["brandStory.heading"] && (
        <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
          <h2 className="text-2xl leading-tight font-semibold text-foreground sm:text-3xl md:text-4xl">
            {content["brandStory.heading"]}
          </h2>
        </div>
      )}

      <div className={cn("grid grid-cols-1 items-end gap-6", image && "md:grid-cols-12")}>
        {image && (
          <div className="md:col-span-7">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-secondary">
              <Picture src={image} alt={store.name} className="relative z-10 h-full w-full object-cover" />
            </div>
          </div>
        )}
        <div className={cn("flex flex-col justify-end", image ? "md:col-span-5" : "mx-auto max-w-2xl text-center")}>
          {content["brandStory.body"] && (
            <p className="mb-6 whitespace-pre-line text-sm leading-relaxed text-muted-foreground sm:text-base">
              {content["brandStory.body"]}
            </p>
          )}
          {about && (
            <div>
              <Link href={about.href} className={blackCta}>
                {about.label} <ArrowRight className="ml-2 w-4 h-4 inline" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-24")}>
      <div className="mb-10 border-b border-border pb-6 md:mb-12 md:pb-8">
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">{content["featuredCategories.heading"]}</h2>
      </div>
    {categoryTiles.length === 0 ? null : (
      <ul className="flex overflow-x-auto gap-6 md:gap-10 pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        {categoryTiles.map((c) => (
          <li key={c.id} className="snap-start shrink-0">
            <Link href={c.href} className="group flex flex-col items-center block w-32 md:w-40">
              <div className="aspect-square w-full bg-muted rounded-full overflow-hidden mb-4 relative shadow-sm border border-border/50 group-hover:border-border transition-colors">
                 <Picture src={c.image} alt={c.label} className="w-full h-full object-cover transition duration-500 group-hover:scale-110" />
                 <div className="absolute inset-0 bg-foreground/5 group-hover:bg-transparent transition-colors" />
              </div>
              <div className="text-center font-medium text-sm md:text-base text-foreground group-hover:text-primary transition-colors">
                {c.label}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    )}
  </section>
);

function ProductCard({
  store,
  product,
  content,
  ratio = "aspect-[4/3]",
}: {
  store: StoreInfo;
  product: StoreProduct;
  content: ContentMap;
  ratio?: string;
}) {
  return (
    <li className="h-full">
      <Link href={productHref(store, product)} className="group flex flex-col h-full bg-background rounded-2xl sm:rounded-3xl overflow-hidden border border-border/50 hover:border-border shadow-sm hover:shadow-xl transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 ease-out fill-mode-both hover:-translate-y-1">
        
        {/* Image Section */}
        <div className={cn(ratio, "bg-muted relative overflow-hidden")}>
           <Picture
             src={product.imageUrl}
             alt={product.name}
             className="w-full h-full object-cover relative z-10"
             imgClassName="transition duration-[0.8s] group-hover:scale-105"
           />
           
           <div className="absolute inset-0 z-20 bg-foreground/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
           
           {/* Badges */}
           <div className="absolute top-4 left-4 z-30">
             {!product.inStock && (
               <span className="bg-background/90 backdrop-blur-md text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
                 {content["product.outOfStock"]}
               </span>
             )}
           </div>
           
           {/* Reveal Action Button */}
           <div className="absolute bottom-4 right-4 z-30 translate-y-8 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 ease-out">
              <div className="bg-primary text-primary-foreground h-11 w-11 rounded-full flex items-center justify-center shadow-lg">
                <ArrowRight className="w-5 h-5 -rotate-45" />
              </div>
           </div>
        </div>

        {/* Content Section */}
        <div className="flex flex-1 flex-col p-3 sm:p-6">
          <div className="mb-2 flex flex-col items-start justify-between gap-1 sm:flex-row sm:gap-3">
             <h3 className="line-clamp-1 text-sm font-semibold text-foreground transition-colors group-hover:text-primary sm:text-lg">
               {product.name}
             </h3>
             <span className="shrink-0 text-sm font-bold text-foreground sm:text-base">
               {cardPrice(product, content)}
             </span>
          </div>
          
          {product.description && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
          )}
        </div>
      </Link>
    </li>
  );
}

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="mb-10 border-b border-border pb-6 md:mb-12 md:pb-8">
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">{content["bestSellers.heading"]}</h2>
      </div>

      {bestSellers.length === 0 ? (
        <p className="text-center text-muted-foreground">{content["bestSellers.empty"]}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-6 md:gap-8 lg:grid-cols-3">
          {bestSellers.map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} />
          ))}
        </ul>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => {
  const image = content["promoBanner.image"];
  return (
    <section className="bg-muted/50">
      <div className={cn(wrap, "grid items-center gap-10 py-16 md:gap-12 md:py-24", image && "md:grid-cols-2")}>
        {image && (
          <div className="relative aspect-square overflow-hidden rounded-[40px] border border-border/50 bg-secondary shadow-sm">
            <Picture src={image} alt={content["promoBanner.heading"]} className="h-full w-full object-cover object-center" />
          </div>
        )}
        <div className={cn("flex flex-col gap-6", image ? "items-start" : "mx-auto max-w-2xl items-center text-center")}>
          <h2 className="text-3xl leading-tight font-semibold text-foreground sm:text-4xl md:text-5xl">
            {content["promoBanner.heading"]}
          </h2>
          {content["promoBanner.subtext"] && (
            <p className="max-w-lg whitespace-pre-line text-base leading-relaxed text-muted-foreground sm:text-lg">
              {content["promoBanner.subtext"]}
            </p>
          )}
          {content["promoBanner.ctaLabel"] && (
            <div className="mt-2">
              <Link href={sectionHref(store, "new-arrivals")} className={blackCta}>
                {content["promoBanner.ctaLabel"]} <ArrowRight className="ml-2 w-4 h-4 inline" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="mb-10 border-b border-border pb-6 md:mb-12 md:pb-8">
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">{content["newArrivals.heading"]}</h2>
      </div>
      {newArrivals.length === 0 ? (
        <p className="text-center text-muted-foreground">{content["newArrivals.empty"]}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-6 md:gap-8 lg:grid-cols-4">
          {newArrivals.map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} ratio="aspect-square" />
          ))}
        </ul>
      )}
    </div>
  </section>
);

const Reviews: SectionComponent = ({ data: { content, reviews } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="text-center mb-16">
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">{content["reviews.heading"]}</h2>
      </div>
      
      <ul className="grid gap-6 md:grid-cols-3">
        {reviews.slice(0,3).map((r, i) => (
          <li key={i} className="bg-muted rounded-2xl p-8 flex flex-col justify-between">
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              &ldquo;{r.quote}&rdquo;
            </p>
            {r.author && (
              <div className="flex items-center gap-3">
                 <div className="grid size-10 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                   {[...r.author.trim()][0]?.toUpperCase()}
                 </div>
                 <div className="text-sm font-semibold text-foreground">{r.author}</div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  </section>
);

const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-6 md:mb-12 md:pb-8">
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">{content["instagram.heading"]}</h2>
        {instagram.url && (
          <a href={instagram.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
             @{instagram.handle}
          </a>
        )}
      </div>
      {instagram.tiles.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:gap-4 md:grid-cols-6">
          {instagram.tiles.map((t, i) => (
            <li key={i} className="aspect-square bg-muted rounded-2xl overflow-hidden">
              <Picture src={t.image} alt={store.name} className="w-full h-full object-cover" />
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);

const Footer: SectionComponent = ({ data: { store, content, categoryTiles, pages } }) => (
  <footer className="bg-background border-t border-border">
    <div className={cn(wrap, "py-16 md:py-24")}>
       <div className="mb-12 grid grid-cols-1 gap-10 sm:grid-cols-2 md:mb-16 md:grid-cols-4 md:gap-12">
          <div className="md:col-span-2">
             <StoreBrand
               store={store}
               content={content}
               className="mb-6 block text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
               logoClassName="h-9"
             />
             <p className="text-muted-foreground text-sm leading-relaxed max-w-md">
               {content["footer.about"]}
             </p>
          </div>
          
          {categoryTiles.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-6 uppercase tracking-wider">{content["featuredCategories.heading"]}</p>
              <ul className="grid gap-4 text-sm text-muted-foreground">
                {categoryTiles.map((c) => (
                  <li key={c.id}>
                    <Link href={c.href} className="hover:text-foreground transition-colors">
                      {c.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pages.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-6 uppercase tracking-wider">{content["footer.linksHeading"]}</p>
              <ul className="grid gap-4 text-sm text-muted-foreground">
                {pages.map((pg) => (
                  <li key={pg.slug}>
                    <Link href={pg.href} className="hover:text-foreground transition-colors">
                      {pg.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
       </div>

       <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-border">
           <p className="text-sm text-muted-foreground">
             {fillTokens(content["footer.copyright"], store)}
           </p>
           <nav className="flex flex-wrap justify-center gap-x-8 gap-y-4 mt-4 md:mt-0">
              <Link href={shopHref(store)} className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors">
                {content["navbar.shopLabel"]}
              </Link>
           </nav>
       </div>
    </div>
  </footer>
);

const ProductPage: Template["ProductPage"] = ({ data, product, related }) => {
  const { store, content } = data;
  return (
    <ProductProvider product={product} content={content}>
      <div className={cn(wrap, "py-10 md:py-20")}>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col-reverse md:flex-row gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
            <ProductGallery className="flex-row md:flex-col justify-center md:justify-start" />
            <div className="flex items-center justify-center flex-1">
              <ProductImage className="w-full aspect-square" />
            </div>
          </div>
          <div className="lg:py-12 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 fill-mode-both ease-out">
            <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">{product.name}</h1>
            <p className="mb-6 text-2xl font-medium text-foreground md:mb-8">
              <ProductPrice />
            </p>
            {product.description && (
              <p className="mb-8 whitespace-pre-line leading-relaxed text-muted-foreground">{product.description}</p>
            )}
            
            <VariantPicker
              look="minimal"
              labelClassName="text-sm font-medium text-foreground mb-1 block"
            />
            
            <div className="mt-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 md:mt-10 md:gap-4">
              <AddToCart look="tonkic" basePath={store.basePath} className="rounded-full h-14 bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-95 shadow-md" />
              <Link
                href={`${store.basePath}/cart`}
                aria-label={content["product.viewCart"]}
                className="w-14 h-14 rounded-full border border-border flex items-center justify-center hover:bg-muted text-foreground transition-all hover:scale-[1.05] active:scale-95"
              >
                <ShoppingCart className="w-5 h-5" />
              </Link>
            </div>
            
            <StockStatus look="dot" className="mt-8 block" />
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-20 border-t border-border pt-12 animate-in fade-in duration-1000 md:mt-32 md:pt-16">
             <div className="flex justify-between items-end mb-10">
                <h2 className="text-2xl font-semibold text-foreground">{content["product.relatedHeading"]}</h2>
             </div>
            <ul className="grid grid-cols-2 gap-3 sm:gap-8 lg:grid-cols-4">
              {related.map((p) => (
                <ProductCard key={p.id} store={store} product={p} content={content} ratio="aspect-square" />
              ))}
            </ul>
          </section>
        )}
      </div>
    </ProductProvider>
  );
};

// Sits inside the catalog page's own container, next to the filter sidebar: no extra wrapper.
const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <ul className="grid grid-cols-2 gap-3 sm:gap-8 xl:grid-cols-3">
    {products.map((p) => (
      <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
    ))}
  </ul>
);

const pageStyle: Template["pageStyle"] = {
  container: "mx-auto max-w-[1200px] px-6 py-32",
  title: "text-4xl md:text-5xl font-semibold tracking-tight mb-4 text-foreground",
  subtitle: "text-lg text-muted-foreground",
  chip: "rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-muted transition text-foreground",
  panel: "mt-12 bg-muted rounded-3xl p-8",
};

export const tonkicTemplate: Template = {
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
