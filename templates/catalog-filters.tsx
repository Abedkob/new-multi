"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  activeFilterCount,
  filterParams,
  type AttributeFacet,
  type CatalogFilters,
} from "@/lib/catalog-filters";
import type { ContentMap } from "@/lib/content";
import { cn } from "@/lib/utils";

type Labels = Pick<
  ContentMap,
  | "catalog.filters"
  | "catalog.sort"
  | "catalog.sortNewest"
  | "catalog.sortPriceAsc"
  | "catalog.sortPriceDesc"
  | "catalog.sortName"
  | "catalog.price"
  | "catalog.min"
  | "catalog.max"
  | "catalog.apply"
  | "catalog.inStock"
  | "catalog.clear"
>;

/**
 * Sort + filters for the shop, category and search pages. A plain GET form, so it works without
 * JavaScript; with it, every change navigates straight away (the price range on Apply/Enter).
 * The URL is the only state (lib/catalog-filters.ts), so filtered pages can be shared, and
 * changing a filter always starts again from page 1.
 */
export function CatalogFilterBar({
  basePath,
  keep,
  filters,
  facets,
  labels,
  chipClass,
  panelClass,
  layout = "top",
}: {
  basePath: string;
  /** Params that belong to the page rather than the filters (the search term). */
  keep: [string, string][];
  filters: CatalogFilters;
  facets: AttributeFacet[];
  labels: Labels;
  chipClass: string;
  panelClass: string;
  /** "sidebar": a column beside the grid from lg up, filters always open there. */
  layout?: "top" | "sidebar";
}) {
  const side = layout === "sidebar";
  const router = useRouter();
  const count = activeFilterCount(filters);
  const [open, setOpen] = useState(count > 0);
  const form = useRef<HTMLFormElement>(null);

  // Only offer a choice where there is one; always keep a filter the shopper already picked.
  const shown = facets.filter((f) => f.values.length > 1 || filters.attrs[f.key]?.length);

  const go = () => {
    if (!form.current) return;
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(form.current)) {
      if (typeof v !== "string" || !v.trim() || (k === "sort" && v === "newest")) continue;
      q.append(k, v.trim());
    }
    const qs = q.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };

  const clearHref = keep.length ? `${basePath}?${new URLSearchParams(keep)}` : basePath;
  const priceValue = (cents: number | null) => (cents === null ? "" : String(cents / 100));

  return (
    <form
      // Re-mount on every URL change so the unchecked/checked state always matches the page
      // (e.g. after "Clear filters" or the back button).
      key={JSON.stringify(filterParams(filters))}
      ref={form}
      method="get"
      action={basePath}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className={cn("grid gap-4", side ? "content-start lg:sticky lg:top-32" : "mt-6")}
      data-testid="catalog-filters"
    >
      {keep.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div className={cn("flex flex-wrap items-center justify-between gap-3", side && "lg:grid lg:justify-stretch")}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="catalog-filter-panel"
          onClick={() => setOpen((o) => !o)}
          className={cn("inline-flex items-center gap-2", chipClass, count > 0 && "border-primary", side && "lg:hidden")}
        >
          {labels["catalog.filters"]}
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[0.7rem] leading-5 text-primary-foreground">
              {count}
            </span>
          )}
        </button>
        <label className={cn("flex items-center gap-2 text-sm", side && "lg:grid lg:gap-1.5")}>
          <span className={cn("whitespace-nowrap text-muted-foreground", side && "lg:font-medium lg:text-foreground")}>
            {labels["catalog.sort"]}
          </span>
          <select
            name="sort"
            defaultValue={filters.sort}
            onChange={go}
            data-testid="catalog-sort"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="newest">{labels["catalog.sortNewest"]}</option>
            <option value="price-asc">{labels["catalog.sortPriceAsc"]}</option>
            <option value="price-desc">{labels["catalog.sortPriceDesc"]}</option>
            <option value="name">{labels["catalog.sortName"]}</option>
          </select>
        </label>
      </div>

      {/* Hidden rather than unmounted when closed, so its fields still go along on submit. A class
          (not the hidden attribute) so the sidebar layout can always show it from lg up. */}
      <div
        id="catalog-filter-panel"
        className={cn("grid gap-6", panelClass, !open && "hidden", side && "lg:grid")}
      >
        <div className={cn("grid gap-6", !side && "sm:grid-cols-2 lg:grid-cols-3")}>
          <fieldset className="grid content-start gap-2">
            <legend className="mb-2 text-sm font-medium">{labels["catalog.price"]}</legend>
            <div className={cn("flex items-center gap-2", side && "flex-wrap")}>
              <input
                name="min"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                defaultValue={priceValue(filters.minCents)}
                placeholder={labels["catalog.min"]}
                aria-label={labels["catalog.min"]}
                className={cn(
                  "h-9 rounded-md border border-border bg-background px-2 text-sm",
                  side ? "w-0 min-w-0 flex-1" : "w-24",
                )}
              />
              <span className="text-muted-foreground">&ndash;</span>
              <input
                name="max"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                defaultValue={priceValue(filters.maxCents)}
                placeholder={labels["catalog.max"]}
                aria-label={labels["catalog.max"]}
                className={cn(
                  "h-9 rounded-md border border-border bg-background px-2 text-sm",
                  side ? "w-0 min-w-0 flex-1" : "w-24",
                )}
              />
              <button type="submit" className={cn(chipClass, side && "w-full")}>
                {labels["catalog.apply"]}
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="stock"
                value="1"
                defaultChecked={filters.inStock}
                onChange={go}
                className="size-4 accent-primary"
              />
              {labels["catalog.inStock"]}
            </label>
          </fieldset>

          {shown.map((f) => (
            <fieldset key={f.key} className="grid content-start gap-2">
              <legend className="mb-2 text-sm font-medium capitalize">{f.label}</legend>
              <div className="flex flex-wrap gap-2">
                {f.values.map((v) => (
                  <label
                    key={v.value}
                    className={cn(
                      "cursor-pointer select-none",
                      chipClass,
                      "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="attr"
                      value={`${f.key}:${v.value}`}
                      defaultChecked={filters.attrs[f.key]?.includes(v.value)}
                      onChange={go}
                      className="sr-only"
                    />
                    {v.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {count > 0 && (
          <div>
            <Link href={clearHref} scroll={false} className="text-sm underline underline-offset-4">
              {labels["catalog.clear"]}
            </Link>
          </div>
        )}
      </div>
    </form>
  );
}
