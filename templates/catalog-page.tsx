import Link from "next/link";
import { fillVars } from "@/lib/content";
import { cn } from "@/lib/utils";
import { SearchBox } from "./nav-client";
import type { StoreProduct, StorefrontData, Template } from "./types";

/**
 * Shared layout for the shop, category and search pages: heading, optional breadcrumb and
 * category chips, the template's own product grid, and simple previous/next pagination. The
 * template supplies the grid and the class names, so it still looks like that template.
 */
export function CatalogPage({
  template,
  data,
  title,
  breadcrumb,
  chips,
  products,
  total,
  page,
  pages,
  basePath,
  query,
  emptyText,
  showSearch,
}: {
  template: Template;
  data: StorefrontData;
  title: string;
  breadcrumb?: { label: string; href?: string }[];
  chips?: { label: string; href: string; active?: boolean }[];
  products: StoreProduct[];
  total: number;
  page: number;
  pages: number;
  /** Page path without the query string, e.g. /store/x/shop */
  basePath: string;
  /** Extra query params to keep when paging (the search term). */
  query?: Record<string, string>;
  emptyText: string;
  showSearch?: boolean;
}) {
  const { content, store } = data;
  const s = template.pageStyle;
  const href = (p: number) => {
    const q = new URLSearchParams(query);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className={s.container} data-testid="catalog-page">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className={cn(s.subtitle, "mb-4")}>
          {breadcrumb.map((b, i) => (
            <span key={`${b.label}-${i}`}>
              {i > 0 && <span className="mx-2">/</span>}
              {b.href ? (
                <Link href={b.href} className="hover:underline">
                  {b.label}
                </Link>
              ) : (
                <span className="text-foreground">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <h1 className={s.title}>{title}</h1>
      <p className={cn(s.subtitle, "mt-2")} data-testid="result-count">
        {fillVars(content["catalog.count"], { count: total })}
      </p>

      {showSearch && (
        <SearchBox
          slug={store.slug}
          placeholder={content["search.placeholder"]}
          buttonLabel={content["search.button"]}
          className="mt-6 max-w-lg"
          inputClassName="w-full"
          buttonClassName="bg-primary text-primary-foreground"
        />
      )}

      {chips && chips.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2" data-testid="category-chips">
          {chips.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                aria-current={c.active ? "page" : undefined}
                className={cn(
                  "inline-block",
                  s.chip,
                  c.active && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10">
        {products.length === 0 ? (
          <p className="text-muted-foreground" data-testid="catalog-empty">
            {emptyText}
          </p>
        ) : (
          <template.ProductGrid data={data} products={products} />
        )}
      </div>

      {pages > 1 && (
        <nav
          aria-label="Pagination"
          data-testid="pagination"
          className="mt-12 flex items-center justify-between gap-4"
        >
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev" className={cn("inline-block", s.chip)}>
              &larr; {content["catalog.previous"]}
            </Link>
          ) : (
            <span />
          )}
          <span className={s.subtitle}>{fillVars(content["catalog.pageOf"], { page, pages })}</span>
          {page < pages ? (
            <Link href={href(page + 1)} rel="next" className={cn("inline-block", s.chip)}>
              {content["catalog.next"]} &rarr;
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
