import type { Metadata } from "next";
import type { ContentMap } from "@/lib/content";
import { getStoreUrl, type UrlTenant } from "@/lib/store-url";

/**
 * Storefront SEO helpers: descriptions, social previews (Open Graph / Twitter) and JSON-LD.
 *
 * Why every page builds a full `openGraph` object instead of adding to the layout's: Next merges
 * metadata shallowly, so a page that sets `openGraph` at all replaces the layout's entirely
 * (siteName, images...). `pageMeta` below always emits the complete set.
 */

/** Google shows ~155-160 characters of a description; cut on a word boundary. */
export function plainText(input: string | null | undefined, max = 160): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!-]+$/, "")}…`;
}

/** Same-site paths ("/uploads/..", "/demo/..") become absolute on the store's own origin, which
 * social crawlers require. On a path-based store `new URL` drops the /store/[slug] part, which
 * is right: public files live at the host root. */
export function absoluteUrl(tenant: UrlTenant, url: string): string {
  return new URL(url, getStoreUrl(tenant)).href;
}

/** The store's fallback share image: hero photo, else the logo, else none. */
export function storeImage(content: ContentMap): string {
  return (content["hero.image"] || content["navbar.logo"] || "").trim();
}

/** Store-level description for pages with nothing more specific to say. */
export function storeDescription(storeName: string, content: ContentMap): string {
  return (
    plainText(content["hero.subtext"]) ||
    plainText(content["footer.about"]) ||
    `Shop online at ${storeName}.`
  );
}

type PageMetaInput = {
  tenant: UrlTenant & { name: string };
  /** Store-relative path of this page ("" for home), also used as the canonical. Omitted only
   * by the layout: canonicals are inherited, so a layout-level one would point every page that
   * doesn't set its own at the home page. */
  path?: string;
  /** Without the store name — the layout's title template appends it. Omit on the home page. */
  title?: string;
  description: string;
  images?: string[];
  type?: "website" | "article";
  noindex?: boolean;
};

export function pageMeta({ tenant, path, title, description, images = [], type = "website", noindex }: PageMetaInput): Metadata {
  const url = path === undefined ? undefined : getStoreUrl(tenant, path);
  const abs = images.filter(Boolean).slice(0, 4).map((i) => absoluteUrl(tenant, i));
  const fullTitle = title ? `${title} | ${tenant.name}` : tenant.name;
  return {
    ...(title ? { title } : {}),
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type,
      siteName: tenant.name,
      title: fullTitle,
      description,
      ...(url ? { url } : {}),
      ...(abs.length ? { images: abs } : {}),
    },
    twitter: {
      card: abs.length ? "summary_large_image" : "summary",
      title: fullTitle,
      description,
      ...(abs.length ? { images: abs } : {}),
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Pages that must never appear in results: cart, checkout, search results, order confirmation
 * (which also shows the customer's name and address). robots.txt already asks crawlers to skip
 * them; this covers a URL that's linked from somewhere else anyway. */
export function privatePageMeta(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

/** A JSON-LD <script> body. `<` is escaped so text from owners (product names, descriptions)
 * can never close the script tag — Next's JSON-LD guide recommends exactly this. */
export function jsonLd(data: object): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}
