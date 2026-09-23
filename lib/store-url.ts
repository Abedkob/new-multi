import { env } from "@/lib/env";

export type UrlTenant = { slug: string; domain: string | null };

/**
 * Origin (scheme + host, no trailing slash, no path) a store is reachable at. Once a tenant has
 * a custom domain this switches automatically — nothing that calls getStoreUrl/getStorePathname
 * needs to change when that happens.
 *
 * The custom-domain branch reuses PLATFORM_BASE_URL's own scheme (and, outside production, its
 * port) instead of hardcoding https:// — in production that's always https, but in dev a test
 * domain like "acme.localhost:3000" needs http and the dev port to actually resolve.
 */
export function getStoreOrigin(tenant: UrlTenant): string {
  if (!tenant.domain) return `${env.baseUrl}/store/${tenant.slug}`;
  const platform = new URL(env.baseUrl);
  const port = env.NODE_ENV === "production" ? "" : `:${platform.port || (platform.protocol === "https:" ? "443" : "80")}`;
  return `${platform.protocol}//${tenant.domain}${port}`;
}

/**
 * Absolute URL for a path within this store's own site. `path` is relative to the store root
 * (e.g. "/shop", "/category/shoes"), or omitted/"/" for the home page — never prefix it with
 * "/store/[slug]" yourself, getStoreOrigin already accounts for the path-based fallback.
 */
export function getStoreUrl(tenant: UrlTenant, path = ""): string {
  const origin = getStoreOrigin(tenant);
  if (path === "" || path === "/") return origin;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Pathname only, resolved the same way as getStoreUrl. Useful for robots.txt Disallow rules,
 * which must be host-relative and correct on both path-based and custom-domain hosts.
 */
export function getStorePathname(tenant: UrlTenant, path = ""): string {
  return new URL(getStoreUrl(tenant, path)).pathname;
}

/**
 * The prefix every storefront-internal link (nav, cart, product cards, breadcrumbs, redirects)
 * needs in front of a store-relative path: "/store/{slug}" for a path-based store, or "" once it
 * has its own domain — a custom domain's root already IS the store, and (once domain routing
 * rewrites {domain}/* to /store/{slug}/* — see proxy.ts) the visible URL has no /store/{slug} in
 * it, so a link built with that prefix would 404. This is the one thing that has to flow into
 * StorefrontData.store.basePath for every template/client component to build correct links.
 */
export function getStoreBasePath(tenant: UrlTenant): string {
  return tenant.domain ? "" : `/store/${tenant.slug}`;
}
