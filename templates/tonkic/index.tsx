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
import { ArrowRight, Search, Menu, ShoppingCart } from "lucide-react";
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
const outlineCta = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "rounded-full px-8 h-12 text-sm font-medium border-border transition-all"
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
const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.04 } },
};
const viewport = { once: true, amount: 0.2 } as const;

const Announcement: SectionComponent = ({ data }) => (
  <div className="bg-primary px-6 py-2 text-center text-xs text-primary-foreground">
    {data.content["announcement.text"]}
  </div>
);

const Navbar: SectionComponent = ({ data: { store, content, categoryTiles, pages } }) => (
  <header className="absolute inset-x-0 top-0 z-50">
    <div className={cn(wrap, "flex items-center justify-between py-6")}>
      <StoreBrand
        store={store}
        content={content}
        className="text-2xl font-bold tracking-tight text-foreground"
        logoClassName="h-9"
      />
      
      <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground">
        <Link href={`/store/${store.slug}/shop`} className="hover:opacity-70 transition">
          {content["navbar.shopLabel"] || "Shop"}
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
          placeholder={content["search.placeholder"] || "Search..."}
          buttonLabel={content["search.button"] || "Search"}
          className="hidden md:flex"
          inputClassName="h-9 w-48 rounded-full border-border text-sm bg-muted/50 focus-visible:bg-background transition-colors text-foreground"
          buttonClassName="sr-only"
        />
        <Link href={`/store/${store.slug}/search`} className="md:hidden">
          <Search className="w-5 h-5 cursor-pointer hover:opacity-70 transition" />
        </Link>
        
        <CartLink
          slug={store.slug}
          className="text-sm font-medium hover:opacity-70 transition flex items-center gap-1"
        />
        <Menu className="w-5 h-5 cursor-pointer hover:opacity-70 transition md:hidden" />
      </div>
    </div>
  </header>
);

const Hero: SectionComponent = ({ data: { store, content, visibility } }) => (
  <section className="relative min-h-[700px] flex items-center pt-32 pb-20 overflow-hidden bg-background">
    {content["hero.image"] ? (
      <MotionDiv initial="hidden" animate="visible" variants={bgFade} className="absolute inset-0 z-0">
        <Picture src={content["hero.image"]} alt={store.name} className="w-full h-full object-cover object-center" sizes="100vw" />
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
          className="max-w-xl bg-background/60 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 md:p-10 rounded-[2rem] shadow-2xl"
        >
          <h1 className="text-5xl md:text-[64px] leading-[1.1] font-semibold tracking-tight text-foreground mb-6">
            {content["hero.headline"] || "Hear every detail with crystal clarity"}
          </h1>
          <p className="text-foreground/90 text-lg mb-8 leading-relaxed font-medium">
            {content["hero.subtext"] || "High-quality headphones deliver an exceptional listening experience while blending style and comfort, thoughtfully crafted for those who love great sound."}
          </p>
          <Link href={sectionHref(store, "new-arrivals")} className={blackCta}>
            {content["hero.ctaLabel"] || "View Collection"} <ArrowRight className="ml-2 w-4 h-4 inline" />
          </Link>
        </MotionDiv>
      </div>
    )}
  </section>
);

const BrandStory: SectionComponent = ({ data: { store, content } }) => {
  return (
    <section className={cn(wrap, "py-24")}>
      <div className="max-w-3xl mx-auto text-center mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
        <h2 className="text-3xl md:text-4xl font-semibold leading-tight text-foreground">
          {content["brandStory.heading"] || "We're passionate about sound, creating premium headphones that elevate your music experience with exceptional audio quality."}
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200 fill-mode-both ease-out">
        <div className="md:col-span-7">
           <div className="aspect-[4/3] bg-secondary rounded-3xl overflow-hidden relative after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_2s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent">
             {content["brandStory.image"] && <Picture src={content["brandStory.image"]} alt="Brand Image" className="w-full h-full object-cover relative z-10" />}
           </div>
        </div>
        <div className="md:col-span-5 flex flex-col justify-end">
           <div className="aspect-square bg-secondary rounded-3xl overflow-hidden mb-8 w-3/4 relative after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_2s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent">
             {content["brandStory.image"] && <Picture src={content["brandStory.image"]} alt="Brand Image 2" className="w-full h-full object-cover grayscale relative z-10" />}
           </div>
           <p className="text-muted-foreground mb-6 leading-relaxed text-sm">
             {content["brandStory.body"] || "At Tonkic, where premium sound meets modern design. We're committed to providing high-quality headphones that deliver an unparalleled listening experience."}
           </p>
           <div>
             <Link href={`/store/${store.slug}/about`} className={blackCta}>
               More About us <ArrowRight className="ml-2 w-4 h-4 inline" />
             </Link>
           </div>
        </div>
      </div>
    </section>
  );
};

const FeaturedCategories: SectionComponent = ({ data: { content, categoryTiles } }) => (
  <section className={cn(wrap, "py-24")}>
    <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b border-border pb-8">
      <div>
         <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{content["featuredCategories.heading"] || "Categories"}</p>
         <h2 className="text-3xl font-semibold text-foreground">Featured Collections</h2>
      </div>
    </div>
    {categoryTiles.length === 0 ? null : (
      <ul className="flex overflow-x-auto gap-6 md:gap-10 pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        {categoryTiles.map((c) => (
          <li key={c.id} className="snap-start shrink-0">
            <Link href={c.href} className="group flex flex-col items-center block w-32 md:w-40">
              <div className="aspect-square w-full bg-muted rounded-full overflow-hidden mb-4 relative shadow-sm border border-border/50 group-hover:border-border transition-colors">
                 <Picture src={c.image} alt={c.label} className="w-full h-full object-cover transition duration-500 group-hover:scale-110" />
                 <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors" />
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
      <Link href={productHref(store, product)} className="group flex flex-col h-full bg-background rounded-3xl overflow-hidden border border-border/50 hover:border-border shadow-sm hover:shadow-xl transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 ease-out fill-mode-both hover:-translate-y-1">
        
        {/* Image Section */}
        <div className={cn(ratio, "bg-muted relative overflow-hidden")}>
           <Picture
             src={product.imageUrl}
             alt={product.name}
             className="w-full h-full object-cover relative z-10"
             imgClassName="transition duration-[0.8s] group-hover:scale-105"
           />
           
           <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-20" />
           
           {/* Badges */}
           <div className="absolute top-4 left-4 z-30">
             {!product.inStock && (
               <span className="bg-background/90 backdrop-blur-md text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
                 {content["product.outOfStock"] || "Out of Stock"}
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
        <div className="flex flex-col flex-1 p-6">
          <div className="flex justify-between items-start gap-3 mb-2">
             <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
               {product.name}
             </h3>
             <span className="font-bold text-foreground shrink-0">
               {cardPrice(product, content)}
             </span>
          </div>
          
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              {product.description || "Experience high-fidelity audio with premium noise canceling and comfortable design."}
          </p>
        </div>
      </Link>
    </li>
  );
}

const BestSellers: SectionComponent = ({ data: { store, content, bestSellers } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b border-border pb-8">
        <div>
           <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{content["bestSellers.heading"] || "Best Sellers"}</p>
           <h2 className="text-3xl font-semibold text-foreground">Trending Products</h2>
        </div>
        <p className="text-muted-foreground max-w-xs text-sm text-right hidden md:block">
           Discover our most popular headphones, crafted for premium sound, comfort, and everyday listening.
        </p>
      </div>

      {bestSellers.length === 0 ? (
        <p className="text-center text-muted-foreground">{content["bestSellers.empty"]}</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {bestSellers.slice(0, 3).map((p) => (
            <ProductCard key={p.id} store={store} product={p} content={content} />
          ))}
        </ul>
      )}
    </div>
  </section>
);

const PromoBanner: SectionComponent = ({ data: { store, content } }) => (
  <section className="bg-muted/50">
    <div className={cn(wrap, "py-24 grid md:grid-cols-2 gap-12 items-center")}>
      <div className="relative animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
         <div className="bg-gradient-to-tr from-secondary to-muted rounded-[40px] aspect-square overflow-hidden flex items-end justify-center relative shadow-sm border border-border/50">
            {content["promoBanner.image"] && <Picture src={content["promoBanner.image"]} alt="Banner" className="w-full h-full object-cover object-center" />}
         </div>
      </div>
      <div className="flex flex-col items-start gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 fill-mode-both ease-out">
          <h2 className="text-4xl md:text-5xl font-semibold leading-tight text-foreground">
             {content["promoBanner.heading"]}
          </h2>
          {content["promoBanner.subtext"] && (
            <p className="text-muted-foreground text-lg leading-relaxed max-w-lg">
               {content["promoBanner.subtext"]}
            </p>
          )}
          <div className="mt-4">
            <Link href={sectionHref(store, "new-arrivals")} className={blackCta}>
              {content["promoBanner.ctaLabel"] || "Shop Now"} <ArrowRight className="ml-2 w-4 h-4 inline" />
            </Link>
          </div>
      </div>
    </div>
  </section>
);

const NewArrivals: SectionComponent = ({ data: { store, content, newArrivals } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b border-border pb-8">
        <div>
           <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{content["newArrivals.heading"] || "New Arrivals"}</p>
           <h2 className="text-3xl font-semibold text-foreground">Latest Products</h2>
        </div>
      </div>
      {newArrivals.length === 0 ? (
        <p className="text-center text-muted-foreground">{content["newArrivals.empty"]}</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {newArrivals.slice(0, 4).map((p) => (
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
        <h2 className="text-3xl font-semibold mb-4 text-foreground">{content["reviews.heading"] || "What Our Customers Say"}</h2>
        <p className="text-muted-foreground max-w-md mx-auto text-sm">Hear from music lovers around the world who enjoy premium sound, lasting comfort, and an exceptional listening experience.</p>
      </div>
      
      <ul className="grid gap-6 md:grid-cols-3">
        {reviews.slice(0,3).map((r, i) => (
          <li key={i} className="bg-muted rounded-2xl p-8 flex flex-col justify-between">
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              &ldquo;{r.quote}&rdquo;
            </p>
            {r.author && (
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-full bg-secondary"></div>
                 <div>
                    <div className="text-sm font-semibold text-foreground">{r.author}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Verified Buyer</div>
                 </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-center mt-10 gap-4">
         <button className="w-10 h-10 rounded-full border border-border flex items-center justify-center hover:bg-muted text-muted-foreground"><ArrowRight className="w-4 h-4 rotate-180" /></button>
         <button className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90"><ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  </section>
);

const Instagram: SectionComponent = ({ data: { store, content, instagram } }) => (
  <section className="bg-background">
    <div className={cn(wrap, "py-24")}>
      <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b border-border pb-8">
        <div>
           <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Social</p>
           <h2 className="text-3xl font-semibold text-foreground">{content["instagram.heading"] || "On Instagram"}</h2>
        </div>
        {instagram.url && (
          <a href={instagram.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
             @{instagram.handle}
          </a>
        )}
      </div>
      {instagram.tiles.length > 0 && (
        <ul className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
    <div className={cn(wrap, "py-24")}>
       <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="md:col-span-2">
             <Link href={`/store/${store.slug}`} className="text-3xl font-bold tracking-tight text-foreground block mb-6">
               {store.name}
             </Link>
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
              <p className="text-xs font-semibold text-foreground mb-6 uppercase tracking-wider">{store.name}</p>
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
              <Link href={`/store/${store.slug}/shop`} className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors">
                {content["navbar.shopLabel"] || "Shop"}
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
      <div className={cn(wrap, "py-32")}>
        <div className="grid gap-12 lg:grid-cols-2">
          <div className="flex flex-col-reverse md:flex-row gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
            <ProductGallery className="flex-row md:flex-col justify-center md:justify-start" />
            <div className="flex items-center justify-center flex-1">
              <ProductImage className="w-full aspect-square" />
            </div>
          </div>
          <div className="lg:py-12 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 fill-mode-both ease-out">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4 text-foreground">{product.name}</h1>
            <p className="text-2xl font-medium text-foreground mb-8">
              <ProductPrice />
            </p>
            <p className="text-muted-foreground leading-relaxed mb-8">
               {product.description || "Designed for long listening sessions with ultimate comfort."}
            </p>
            
            <VariantPicker
              look="minimal"
              labelClassName="text-sm font-medium text-foreground mb-1 block"
            />
            
            <div className="mt-10 flex gap-4">
              <AddToCart look="tonkic" slug={store.slug} className="flex-1 rounded-full h-14 bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-95 shadow-md" />
              <button className="w-14 h-14 rounded-full border border-border flex items-center justify-center hover:bg-muted text-foreground transition-all hover:scale-[1.05] active:scale-95">
                <ShoppingCart className="w-5 h-5" />
              </button>
            </div>
            
            <StockStatus look="dot" className="mt-8 block" />
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-32 border-t border-border pt-16 animate-in fade-in duration-1000">
             <div className="flex justify-between items-end mb-10">
                <h2 className="text-2xl font-semibold text-foreground">{content["product.relatedHeading"] || "You may also like"}</h2>
             </div>
            <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
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

const ProductGrid: Template["ProductGrid"] = ({ data, products }) => (
  <div className={cn(wrap, "py-32")}>
    <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <ProductCard key={p.id} store={data.store} product={p} content={data.content} />
      ))}
    </ul>
  </div>
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
