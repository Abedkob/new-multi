"use client";

/**
 * The search half of the funnel (§3.6, D21).
 *
 * One emission point for every template, on the results page, rather than an emitter inside
 * each template's search control. Thirteen templates offer search four different ways — an
 * inline box, an icon that opens a panel, a bespoke dialog, a plain link — and an emitter per
 * control would mean four chances to miss a store's searches and four chances to double-count
 * them. Arriving at the results page is the submit, whichever control sent the shopper there.
 *
 * What is NOT emitted here matters as much: nothing per keystroke. The suggestion panels fetch
 * as a shopper types, and `useSuggestions` (templates/nav-client.tsx) is the only place allowed
 * to report one of those — once a query has settled and come back empty, which is the search a
 * merchant most wants to see and the one nobody ever submits.
 */

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useAnalytics } from "./tracker";

export function SearchResultsTracker({
  query,
  resultCount,
  page,
  productIdBySlug,
  children,
}: {
  /** Exactly what the shopper typed; normalized and scrubbed server-side, never stored raw. */
  query: string;
  resultCount: number;
  /** Paging is not a new search. Only the first page of results reports one. */
  page: number;
  /** Slug → id for the products on this page, so a click can name a product without a lookup. */
  productIdBySlug: Record<string, string>;
  children: ReactNode;
}) {
  const { track } = useAnalytics();
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (!query.trim() || page > 1) return;
    // Re-searching the same phrase after a filter change should not count twice, but a genuinely
    // different result count means a genuinely different answer, so it is part of the key.
    const key = `${query}|${resultCount}`;
    if (reported.current === key) return;
    reported.current = key;
    track({ type: "SEARCH_SUBMITTED", pageKind: "search", searchQuery: query, resultCount });
  }, [query, resultCount, page, track]);

  // Delegated, so no template's grid has to know analytics exists. `display: contents` keeps the
  // wrapper out of the layout entirely — the grid's own box stays the one the CSS sees.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const href = target.closest("a[href]")?.getAttribute("href");
    const slug = href?.match(/\/products\/([^/?#]+)/)?.[1];
    if (!slug) return;
    const productId = productIdBySlug[decodeURIComponent(slug)];
    if (!productId) return;
    track({
      type: "SEARCH_RESULT_CLICK",
      pageKind: "search",
      searchQuery: query,
      productId,
      // The click takes the shopper off this page, so the next scheduled flush may never come.
      immediate: true,
    });
  };

  return (
    <div style={{ display: "contents" }} onClick={onClick}>
      {children}
    </div>
  );
}
