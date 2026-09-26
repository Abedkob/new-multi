import Link from "next/link";
import { SocialPlatformIcon } from "@/components/social-platform-icon";
import { fillTokens } from "@/lib/content";
import { cn } from "@/lib/utils";
import { shopHref, StoreBrand } from "./shared";
import type { SocialLink, StorefrontData } from "./types";

export type FooterLook =
  | "minimal"
  | "classic"
  | "tonkic"
  | "fashion"
  | "luxury"
  | "atelier"
  | "atlas"
  | "pearl"
  | "drop"
  | "kinetic"
  | "mirage";

type FooterStyle = {
  layout: "centered" | "columns" | "editorial";
  surface: string;
  muted: string;
  link: string;
  border: string;
  brand: string;
  decorativeWordmark?: boolean;
};

const STYLES: Record<FooterLook, FooterStyle> = {
  minimal: {
    layout: "centered",
    surface: "border-t border-border bg-background text-foreground",
    muted: "text-muted-foreground",
    link: "text-muted-foreground hover:text-primary",
    border: "border-border",
    brand: "text-2xl font-light tracking-tight",
  },
  classic: {
    layout: "columns",
    surface: "border-t border-border bg-secondary text-secondary-foreground",
    muted: "text-secondary-foreground/70",
    link: "text-secondary-foreground/75 hover:text-secondary-foreground",
    border: "border-secondary-foreground/20",
    brand: "font-serif text-2xl font-bold",
  },
  tonkic: {
    layout: "columns",
    surface: "border-t border-border bg-background text-foreground",
    muted: "text-muted-foreground",
    link: "text-muted-foreground hover:text-primary",
    border: "border-border",
    brand: "text-3xl font-bold tracking-tight",
  },
  fashion: {
    layout: "columns",
    surface: "bg-primary text-primary-foreground",
    muted: "text-primary-foreground/70",
    link: "text-primary-foreground/75 hover:text-primary-foreground",
    border: "border-primary-foreground/20",
    brand: "font-serif text-3xl tracking-tight",
    decorativeWordmark: true,
  },
  luxury: {
    layout: "centered",
    surface: "relative isolate overflow-hidden border-t border-border bg-secondary/50 text-foreground",
    muted: "text-muted-foreground",
    link: "text-muted-foreground hover:text-accent",
    border: "border-border",
    brand: "font-serif text-4xl sm:text-5xl",
  },
  atelier: {
    layout: "columns",
    surface: "overflow-hidden bg-primary text-primary-foreground",
    muted: "text-primary-foreground/70",
    link: "text-primary-foreground/75 hover:text-primary-foreground",
    border: "border-primary-foreground/20",
    brand: "font-serif text-3xl italic tracking-tight",
    decorativeWordmark: true,
  },
  atlas: {
    layout: "editorial",
    surface: "border-t border-foreground bg-background text-foreground",
    muted: "text-muted-foreground",
    link: "text-muted-foreground hover:text-primary",
    border: "border-border",
    brand: "text-xl font-bold uppercase tracking-tight",
    decorativeWordmark: true,
  },
  pearl: {
    layout: "columns",
    surface: "bg-primary text-primary-foreground",
    muted: "text-primary-foreground/70",
    link: "text-primary-foreground/75 hover:text-primary-foreground",
    border: "border-primary-foreground/20",
    brand: "font-serif text-2xl",
  },
  drop: {
    layout: "editorial",
    surface: "border-t border-border bg-secondary text-secondary-foreground",
    muted: "text-secondary-foreground/70",
    link: "text-secondary-foreground/75 hover:text-secondary-foreground",
    border: "border-secondary-foreground/20",
    brand: "text-3xl font-black uppercase tracking-tight",
  },
  kinetic: {
    layout: "editorial",
    surface: "bg-primary text-primary-foreground",
    muted: "text-primary-foreground/65",
    link: "text-primary-foreground/70 hover:text-primary-foreground",
    border: "border-primary-foreground/20",
    brand: "text-3xl font-black tracking-[-0.04em]",
  },
  mirage: {
    layout: "columns",
    surface: "bg-primary text-primary-foreground",
    muted: "text-primary-foreground/65",
    link: "text-primary-foreground/70 hover:text-primary-foreground",
    border: "border-primary-foreground/20",
    brand: "text-3xl font-semibold tracking-[-0.04em]",
  },
};

function SocialLinks({ links, linkClass }: { links: SocialLink[]; linkClass: string }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label="Social links">
      <ul className="grid gap-3">
        {links.map((link) => {
          return (
            <li key={link.platform}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("inline-flex min-h-10 items-center gap-2 text-sm transition-colors", linkClass)}
              >
                <SocialPlatformIcon platform={link.platform} />
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function LinkGroup({
  heading,
  children,
  muted,
}: {
  heading: string;
  children: React.ReactNode;
  muted: string;
}) {
  return (
    <div data-footer-motion-item>
      <h3 className={cn("mb-5 text-xs font-semibold uppercase tracking-[0.16em]", muted)}>
        {heading}
      </h3>
      {children}
    </div>
  );
}

function FooterNavigation({ data, style }: { data: StorefrontData; style: FooterStyle }) {
  const { store, content, categoryTiles, pages, socialLinks } = data;
  return (
    <>
      <LinkGroup heading={content["featuredCategories.heading"]} muted={style.muted}>
        <nav aria-label="Shop">
          <ul className="grid gap-3">
            <li>
              <Link href={shopHref(store)} className={cn("inline-flex min-h-10 items-center text-sm transition-colors", style.link)}>
                {content["navbar.shopLabel"]}
              </Link>
            </li>
            {categoryTiles.map((category) => (
              <li key={category.id}>
                <Link href={category.href} className={cn("inline-flex min-h-10 items-center text-sm transition-colors", style.link)}>
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </LinkGroup>

      {pages.length > 0 && (
        <LinkGroup heading={content["footer.linksHeading"]} muted={style.muted}>
          <nav aria-label="Information">
            <ul className="grid gap-3">
              {pages.map((page) => (
                <li key={page.slug}>
                  <Link href={page.href} className={cn("inline-flex min-h-10 items-center text-sm transition-colors", style.link)}>
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </LinkGroup>
      )}

      {socialLinks.length > 0 && (
        <LinkGroup heading="Connect" muted={style.muted}>
          <SocialLinks links={socialLinks} linkClass={style.link} />
        </LinkGroup>
      )}
    </>
  );
}

function FooterBrand({ data, style }: { data: StorefrontData; style: FooterStyle }) {
  return (
    <div data-footer-motion-item className="min-w-0 max-w-full">
      <StoreBrand
        store={data.store}
        content={data.content}
        className={cn("max-w-full [overflow-wrap:anywhere]", style.brand)}
        logoClassName="h-10"
      />
      <p className={cn("mt-5 max-w-md whitespace-pre-line text-sm leading-relaxed", style.muted)}>
        {data.content["footer.about"]}
      </p>
    </div>
  );
}

function FooterBottom({ data, style }: { data: StorefrontData; style: FooterStyle }) {
  return (
    <div
      data-footer-motion-bottom
      className={cn(
        "mt-12 flex flex-col gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between",
        style.border,
        style.muted,
      )}
    >
      <p>{fillTokens(data.content["footer.copyright"], data.store)}</p>
      <Link href="#top" className={cn("inline-flex min-h-10 items-center transition-colors", style.link)}>
        Back to top <span aria-hidden>&uarr;</span>
      </Link>
    </div>
  );
}

/**
 * One footer contract for every template. `look` changes composition and typography, while
 * navigation, social behavior, accessibility and theme-token usage stay consistent.
 */
export function StoreFooter({ data, look }: { data: StorefrontData; look: FooterLook }) {
  const style = STYLES[look];
  const wordmark = data.content["navbar.logoText"] || data.store.name;
  const wordmarkSize = wordmark.length > 28
    ? "text-[clamp(2.25rem,8vw,7rem)]"
    : wordmark.length > 18
      ? "text-[clamp(2.5rem,10vw,8rem)]"
      : "text-[clamp(3rem,12vw,9rem)]";
  const centeredLinks = [
    { key: "shop", label: data.content["navbar.shopLabel"], href: shopHref(data.store) },
    ...data.categoryTiles.map((item) => ({ key: item.id, label: item.label, href: item.href })),
    ...data.pages.map((item) => ({ key: item.slug, label: item.label, href: item.href })),
  ];

  return (
    <footer className={style.surface}>
      {look === "luxury" && (
        <div
          aria-hidden
          className="absolute left-1/2 top-[72%] -z-10 aspect-square w-[150vw] -translate-x-1/2 rounded-full border border-accent/30 bg-background/40 lg:w-[100vw]"
        />
      )}
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
        {style.layout === "centered" ? (
          <div className="text-center">
            <div className="flex justify-center">
              <FooterBrand data={data} style={style} />
            </div>
            <nav aria-label="Footer" className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-3">
              {centeredLinks.map((link) => (
                <Link key={link.key} href={link.href} className={cn("inline-flex min-h-10 items-center text-sm transition-colors", style.link)}>
                  {link.label}
                </Link>
              ))}
            </nav>
            {data.socialLinks.length > 0 && (
              <div className="mt-8 flex justify-center">
                <SocialLinks links={data.socialLinks} linkClass={style.link} />
              </div>
            )}
            <FooterBottom data={data} style={style} />
          </div>
        ) : (
          <>
            {style.layout === "editorial" && (
              <div
                aria-hidden
                className={cn(
                  "mb-10 max-w-full pr-20 font-black uppercase leading-[0.88] tracking-tighter [overflow-wrap:anywhere] sm:pr-0",
                  wordmarkSize,
                  style.border,
                )}
              >
                <span className="block max-w-full">{wordmark}</span>
              </div>
            )}
            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-12">
              <div className="sm:col-span-2">
                <FooterBrand data={data} style={style} />
              </div>
              <FooterNavigation data={data} style={style} />
            </div>
            <FooterBottom data={data} style={style} />
          </>
        )}
      </div>
      {style.decorativeWordmark && style.layout !== "editorial" && (
        <div
          aria-hidden
          className="-mb-[3vw] overflow-hidden px-4 text-center text-[16vw] font-black leading-none tracking-tighter opacity-10"
        >
          <span className="block max-w-full [overflow-wrap:anywhere]">{data.store.name}</span>
        </div>
      )}
    </footer>
  );
}
