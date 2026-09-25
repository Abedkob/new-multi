/**
 * Shop / category / search filters, and how they live in the URL. Pure and dependency-free, so
 * the server page (parsing), the data layer (querying) and the client filter bar (building
 * links) all agree on one format:
 *
 *   ?sort=sale&min=10&max=50&stock=1&attr=size:40&attr=size:41&attr=color:black
 *
 * `min`/`max` are in whole currency units as typed by the shopper; attribute keys and values are
 * matched case-insensitively (stored lowercased here). Anything malformed is dropped rather than
 * rejected, so a hand-edited URL still shows a page.
 */

export const SORTS = ["newest", "sale", "price-asc", "price-desc", "name"] as const;
export type CatalogSort = (typeof SORTS)[number];

export type CatalogFilters = {
  sort: CatalogSort;
  minCents: number | null;
  maxCents: number | null;
  inStock: boolean;
  /** Lowercased attribute key -> lowercased accepted values (any of them matches). */
  attrs: Record<string, string[]>;
};

export const NO_FILTERS: CatalogFilters = {
  sort: "newest",
  minCents: null,
  maxCents: null,
  inStock: false,
  attrs: {},
};

type Params = Record<string, string | string[] | undefined>;

const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const first = (v: string | string[] | undefined) => all(v)[0];

const MAX_ATTR_KEYS = 10;
const MAX_ATTR_VALUES = 30;

function toCents(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.trim());
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

export function parseCatalogFilters(sp: Params): CatalogFilters {
  const sort = SORTS.find((s) => s === first(sp.sort)) ?? "newest";
  let minCents = toCents(first(sp.min));
  let maxCents = toCents(first(sp.max));
  if (minCents !== null && maxCents !== null && minCents > maxCents) {
    [minCents, maxCents] = [maxCents, minCents];
  }

  const attrs: Record<string, string[]> = {};
  for (const raw of all(sp.attr)) {
    const i = raw.indexOf(":");
    if (i <= 0) continue;
    const key = raw.slice(0, i).trim().toLowerCase().slice(0, 100);
    const value = raw.slice(i + 1).trim().toLowerCase().slice(0, 100);
    if (!key || !value) continue;
    if (!attrs[key] && Object.keys(attrs).length >= MAX_ATTR_KEYS) continue;
    const list = (attrs[key] ??= []);
    if (!list.includes(value) && list.length < MAX_ATTR_VALUES) list.push(value);
  }

  return { sort, minCents, maxCents, inStock: first(sp.stock) === "1", attrs };
}

/** True when anything narrows or reorders the list (such URLs are kept out of search engines). */
export function hasActiveFilters(f: CatalogFilters): boolean {
  return (
    f.sort !== "newest" ||
    f.minCents !== null ||
    f.maxCents !== null ||
    f.inStock ||
    Object.keys(f.attrs).length > 0
  );
}

/** Count of narrowing filters (sort excluded), for the "Filters (2)" badge. */
export function activeFilterCount(f: CatalogFilters): number {
  return (
    (f.minCents !== null || f.maxCents !== null ? 1 : 0) +
    (f.inStock ? 1 : 0) +
    Object.values(f.attrs).reduce((n, v) => n + v.length, 0)
  );
}

const units = (cents: number) => String(cents / 100);

/** Query string entries for these filters (defaults omitted), in a stable order. */
export function filterParams(f: CatalogFilters): [string, string][] {
  const out: [string, string][] = [];
  if (f.sort !== "newest") out.push(["sort", f.sort]);
  if (f.minCents !== null) out.push(["min", units(f.minCents)]);
  if (f.maxCents !== null) out.push(["max", units(f.maxCents)]);
  if (f.inStock) out.push(["stock", "1"]);
  for (const [key, values] of Object.entries(f.attrs)) {
    for (const value of values) out.push(["attr", `${key}:${value}`]);
  }
  return out;
}

/** One attribute the shopper can filter on, with the values that exist in scope. `key`/`value`
 * are lowercased (what goes in the URL); `label`s are the stored spelling. */
export type AttributeFacet = { key: string; label: string; values: { value: string; label: string }[] };
