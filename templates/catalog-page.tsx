import Link from "next/link";
import {
  filterParams,
  hasActiveFilters,
  type AttributeFacet,
  type CatalogFilters,
} from "@/lib/catalog-filters";
import { fillVars, type ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";
import { CatalogFilterBar } from "./catalog-filters";
import { SearchBox } from "./nav-client";
import type { StoreProduct, StorefrontData, Template } from "./types";

/**
 * Shared layout for the shop, category and search pages: heading, optional breadcrumb and
 * category chips, sort + filters, the template's own product grid, and numbered pagination
 * that keeps the filters. The template supplies the grid and the class names, so it still looks
 * like that template.
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
  keep = [],
  filters,
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
  /** Query params that belong to the page itself (the search term), kept when paging/filtering. */
  keep?: [string, string][];
  /** Sort + filters; omit to show none (e.g. an empty search). */
  filters?: { value: CatalogFilters; facets: AttributeFacet[] };
  emptyText: string;
  showSearch?: boolean;
}) {
  const { content, store } = data;
  const s = template.pageStyle;
  const href = (p: number) => {
    const q = new URLSearchParams([...keep, ...(filters ? filterParams(filters.value) : [])]);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const sidebar = template.filterLayout === "sidebar" && !!filters;
  const filterBar = filters && (
    <CatalogFilterBar
      basePath={basePath}
      keep={keep}
      filters={filters.value}
      facets={filters.facets}
      labels={filterLabels(content)}
      chipClass={s.chip}
      panelClass={sidebar ? "" : s.panel}
      layout={sidebar ? "sidebar" : "top"}
    />
  );
  const results =
    products.length === 0 ? (
      <p className="text-muted-foreground" data-testid="catalog-empty">
        {filters && hasActiveFilters(filters.value) && total === 0 ? content["catalog.noMatch"] : emptyText}
      </p>
    ) : (
      <template.ProductGrid data={data} products={products} />
    );

  return (
    <div className={s.catalogContainer ?? s.container} data-testid="catalog-page">
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
          basePath={store.basePath}
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

      {sidebar ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
          <aside aria-label={content["catalog.filters"]}>{filterBar}</aside>
          <div>{results}</div>
        </div>
      ) : (
        <>
          {filterBar}
          <div className="mt-10">{results}</div>
        </>
      )}

      {pages > 1 && (
        <nav
          aria-label="Pagination"
          data-testid="pagination"
          className="mt-12 flex flex-wrap items-center justify-between gap-4"
        >
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev" className={cn("inline-block", s.chip)}>
              &larr; {content["catalog.previous"]}
            </Link>
          ) : (
            <span />
          )}
          <ol className="flex flex-wrap items-center gap-1.5">
            {pageList(page, pages).map((p, i) =>
              p === null ? (
                <li key={`gap-${i}`} aria-hidden className={s.subtitle}>
                  &hellip;
                </li>
              ) : (
                <li key={p}>
                  <Link
                    href={href(p)}
                    aria-current={p === page ? "page" : undefined}
                    aria-label={fillVars(content["catalog.pageOf"], { page: p, pages })}
                    className={cn(
                      "inline-block min-w-9 text-center",
                      s.chip,
                      p === page && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {p}
                  </Link>
                </li>
              ),
            )}
          </ol>
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

/** Page numbers to show: first, last, and two either side of the current one; null = a gap. */
function pageList(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

const FILTER_LABELS = [
  "catalog.filters",
  "catalog.sort",
  "catalog.sortNewest",
  "catalog.sortPriceAsc",
  "catalog.sortPriceDesc",
  "catalog.sortName",
  "catalog.price",
  "catalog.min",
  "catalog.max",
  "catalog.apply",
  "catalog.inStock",
  "catalog.clear",
] as const;

/** Only the labels the client filter bar uses, not the store's whole content map. */
function filterLabels(content: ContentMap) {
  return Object.fromEntries(FILTER_LABELS.map((k) => [k, content[k]])) as Pick<
    ContentMap,
    (typeof FILTER_LABELS)[number]
  >;
}
