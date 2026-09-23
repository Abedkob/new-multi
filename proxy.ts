import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { homeForRole } from "@/lib/roles";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getStoreUrl } from "@/lib/store-url";
import { isValidDomainFormat, normalizeHostname, wwwTwin } from "@/lib/domain-format";

// Optimistic gate only (reads the JWT, no DB). Pages and server actions repeat
// the role checks via lib/session.ts, and data access is scoped by tenantId.
const { auth } = NextAuth(authConfig);

// Next 16 runs Proxy on the Node.js runtime by default (not Edge), so a direct Prisma/env import
// here is fine at runtime. Proxy still executes as its own bundle though ("you should not attempt
// relying on shared modules or globals" — see the Proxy docs), so these two caches are declared
// fresh here rather than imported from anywhere shared; verified against pg_stat_activity that
// this doesn't open a second connection pool (see the session notes / KNOWN_GAPS.md).

type CacheEntry<T> = { value: T; expires: number };
const HOST_CACHE_TTL_MS = 30_000;
const HOST_CACHE_MAX = 1000;
// Misses (unknown hosts) get their own, smaller cache: anyone can send arbitrary Host headers,
// and if those shared a cache with real stores, a flood of junk hosts would evict the real
// entries and push every store's traffic back onto the database.
const HOST_MISS_CACHE_MAX = 500;

type HostResolution =
  | { kind: "store"; slug: string }
  // The www/apex twin of a store's domain (lib/domain-format.ts's wwwTwin): redirect there.
  | { kind: "twin"; slug: string; domain: string };

const hostHits = new Map<string, CacheEntry<HostResolution>>();
const hostMisses = new Map<string, CacheEntry<null>>();
const domainBySlug = new Map<string, CacheEntry<string | null>>();

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) cache.delete(key);
  return undefined;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, max: number) {
  // Evict the oldest insertion (Map iterates in insertion order) rather than clearing, so a
  // burst of new keys can only push out the stalest entries, never the whole cache at once.
  cache.delete(key);
  if (cache.size >= max) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: Date.now() + HOST_CACHE_TTL_MS });
}

/** Host -> store, for a custom-domain visitor. Tenant isn't RLS-guarded (see lib/prisma.ts's
 * withTenant docstring), so these are bare queries, same as getTenantBySlug. */
async function resolveHost(hostname: string): Promise<HostResolution | null> {
  const hit = cacheGet(hostHits, hostname);
  if (hit) return hit;
  if (cacheGet(hostMisses, hostname) === null) return null;

  let resolution: HostResolution | null = null;
  const exact = await prisma.tenant.findUnique({ where: { domain: hostname }, select: { slug: true } });
  if (exact) {
    resolution = { kind: "store", slug: exact.slug };
  } else {
    const twin = wwwTwin(hostname);
    const viaTwin = twin
      ? await prisma.tenant.findUnique({ where: { domain: twin }, select: { slug: true } })
      : null;
    if (viaTwin && twin) resolution = { kind: "twin", slug: viaTwin.slug, domain: twin };
  }

  if (resolution) cacheSet(hostHits, hostname, resolution, HOST_CACHE_MAX);
  else cacheSet(hostMisses, hostname, null, HOST_MISS_CACHE_MAX);
  return resolution;
}

/** slug -> domain, to redirect an old path-based URL to the store's own domain once it has one
 * (Tenant.domain is defined as verified-and-live, so this is always safe — see schema.prisma). */
async function resolveDomainForSlug(slug: string): Promise<string | null> {
  const cached = cacheGet(domainBySlug, slug);
  if (cached !== undefined) return cached;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { domain: true } });
  const domain = tenant?.domain ?? null;
  cacheSet(domainBySlug, slug, domain, HOST_CACHE_MAX);
  return domain;
}

/**
 * Temporary (307), not permanent (308), on purpose: browsers cache a 308 indefinitely, so if a
 * store's domain is ever disconnected or changed, shoppers would keep being sent to the old one
 * with no way for us to take it back. 307 also preserves the method, so a POST stays a POST.
 */
function redirectToStore(tenant: { slug: string; domain: string }, pathname: string, search: string) {
  return NextResponse.redirect(`${getStoreUrl(tenant, pathname)}${search}`, 307);
}

function isPlatformHost(hostname: string): boolean {
  const platformHostname = new URL(env.baseUrl).hostname;
  return hostname === platformHostname || hostname === "localhost" || hostname === "127.0.0.1";
}

/** These two are the one place a dotted extension is exactly the page being asked for — each
 * store's own /store/[slug]/(robots.txt|sitemap.xml) route, not a public/ asset — so they must
 * be excluded from looksLikeStaticFile's heuristic below, or a domain visitor would get the
 * platform's root robots.txt/sitemap.xml instead of their own. */
const SITE_METADATA_FILES = new Set(["/robots.txt", "/sitemap.xml"]);

/** A public/ asset (image, font, svg, ...) rather than a page — these live at the same path
 * regardless of host, so a custom-domain visitor needs them passed through unrewritten. */
const looksLikeStaticFile = (pathname: string) =>
  !SITE_METADATA_FILES.has(pathname) && /\.[a-zA-Z0-9]+$/.test(pathname);

const PLATFORM_ONLY_PREFIXES = ["/admin", "/platform", "/login", "/force-logout"];

async function handleCustomDomainHost(req: NextRequest, pathname: string, hostname: string) {
  if (pathname.startsWith("/api") || pathname.startsWith("/_next") || looksLikeStaticFile(pathname)) {
    return NextResponse.next();
  }

  // The admin/platform consoles, auth pages, etc. don't exist from a store's own domain — a
  // domain pointed at this server for an unrelated reason must never reach them.
  if (PLATFORM_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Junk Host headers (IP literals, garbage) can never be a stored domain: answer without a query.
  if (!isValidDomainFormat(hostname)) return new NextResponse("Not found", { status: 404 });

  const resolved = await resolveHost(hostname);
  if (!resolved) return new NextResponse("Not found", { status: 404 });
  if (resolved.kind === "twin") {
    return redirectToStore(resolved, pathname, req.nextUrl.search);
  }

  const url = req.nextUrl.clone();
  url.pathname = `/store/${resolved.slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

/** A path-based /store/[slug]/... view of a store that now has its own domain redirects there
 * (query string included), so the domain is the one URL search engines and shoppers see. */
async function maybeRedirectToDomain(pathname: string, search: string) {
  const match = pathname.match(/^\/store\/([^/]+)(\/.*)?$/);
  if (!match) return undefined;
  const [, slug, rest] = match;
  const domain = await resolveDomainForSlug(slug);
  if (!domain) return undefined;
  return redirectToStore({ slug, domain }, rest ?? "", search);
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const hostname = normalizeHostname(req.headers.get("host") ?? "");

  if (!isPlatformHost(hostname)) {
    return handleCustomDomainHost(req, pathname, hostname);
  }

  const user = req.auth?.user;
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, req.nextUrl));

  if (pathname === "/login") {
    return user ? redirectTo(homeForRole(user.role)) : undefined;
  }

  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    if (user?.role !== "PLATFORM_ADMIN") return redirectTo("/login");
    return;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (user?.role !== "STORE_OWNER") return redirectTo("/login");
    if (
      user.mustChangePassword &&
      pathname !== "/admin/change-password"
    ) {
      return redirectTo("/admin/change-password");
    }
    return;
  }

  if (pathname === "/store" || pathname.startsWith("/store/")) {
    return maybeRedirectToDomain(pathname, req.nextUrl.search);
  }
});

export const config = {
  // Host-based routing needs Proxy on (in principle) every path, not just the auth-gated ones —
  // a custom domain has to be caught regardless of what it asks for. /api and the Next internals
  // are excluded because they never need rewriting (see handleCustomDomainHost's own early
  // passthrough for the public/ assets that can't be excluded by extension-less path alone).
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};
