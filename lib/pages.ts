/** The four optional content pages a store can write (each needs non-empty text to exist). */
export const PAGE_SLUGS = ["about", "contact", "faq", "shipping"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

export const isPageSlug = (s: string): s is PageSlug =>
  (PAGE_SLUGS as readonly string[]).includes(s);
