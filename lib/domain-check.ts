import { Resolver, lookup } from "node:dns/promises";
import { env } from "@/lib/env";

// Server-only, by convention rather than an enforced guard (the "server-only" package isn't a
// dependency here): this reads env.ts (DATABASE_URL, AUTH_SECRET — must never reach a client
// bundle) and node:dns/promises (a Node built-in Turbopack can't bundle for the browser at all).
// An earlier version of this file didn't separate these, and lib/validation.ts imported it for
// isValidDomainFormat/isPlatformOwnHostname — since lib/validation.ts is also imported by a
// client component (app/admin/preview/live-preview.tsx, for isImageUrl/isInstagramHandle), that
// pulled this whole module into the client bundle and broke the build. The pure format check now
// lives in lib/domain-format.ts instead, which has no Node/env imports and is safe to share with
// client code; keep every future export here (anything using env or a Node built-in) out of
// lib/validation.ts's import graph — only actions.ts (a "use server" file) should import this one.

export { isValidDomainFormat } from "@/lib/domain-format";

/** A domain that resolves to this server's own platform host would make proxy.ts's host check
 * ambiguous (it would never be treated as a custom domain) — reject it outright rather than
 * silently accepting a value that could never actually route anywhere. */
export function isPlatformOwnHostname(hostname: string): boolean {
  const platformHostname = new URL(env.baseUrl).hostname;
  return hostname === platformHostname || hostname === "localhost" || hostname === "127.0.0.1";
}

export type DomainCheckResult =
  | { ok: true }
  | { ok: false; reason: "no-dns" | "wrong-ip"; resolvedIp?: string };

/**
 * Confirms a domain's DNS actually points here before Tenant.domain is set — everything
 * downstream (sitemap, robots, canonicals, proxy's rewrite) treats that field as "verified and
 * live" (see the schema comment), so this is the one gate that keeps that true.
 *
 * Uses the OS resolver (respects /etc/hosts, so a manually-added local entry works for testing),
 * not a raw DNS-only query — the two usually agree, but this is deliberately the one an admin's
 * own browser/curl would also get.
 */
export async function checkDomainResolves(hostname: string): Promise<DomainCheckResult> {
  let resolvedIp: string;
  try {
    resolvedIp = (await lookup(hostname, { family: 4 })).address;
  } catch {
    return { ok: false, reason: "no-dns" };
  }
  if (env.SERVER_PUBLIC_IP && resolvedIp !== env.SERVER_PUBLIC_IP) {
    return { ok: false, reason: "wrong-ip", resolvedIp };
  }
  return { ok: true };
}

export type HostDnsReport = {
  hostname: string;
  /** A records (IPv4). */
  a: string[];
  /** AAAA records (IPv6). Any here that don't also serve this store break IPv6 visitors and
   * Let's Encrypt validation (which prefers IPv6), so the admin page flags them. */
  aaaa: string[];
  /** CNAME target, if the name is an alias (common for www). */
  cname: string | null;
  /** CAA issuers ("letsencrypt.org", ...). Empty = any CA may issue. */
  caa: string[];
  /** Set when a lookup failed for a reason other than "no such record" (timeout, SERVFAIL). */
  error: string | null;
};

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "ENONAME", "NXDOMAIN"]);

/**
 * Raw DNS view of one hostname for the platform admin's "Check DNS" button — unlike
 * checkDomainResolves (the save-time gate, which only asks the OS resolver for one IPv4), this
 * queries DNS directly for A, AAAA, CNAME and CAA, so the page can show exactly what is wrong
 * (www missing, a leftover AAAA, a CAA record that blocks Let's Encrypt).
 * Doesn't see /etc/hosts entries, so dev-only names like "shop.localhost" show no records.
 */
export async function inspectHostDns(hostname: string): Promise<HostDnsReport> {
  const resolver = new Resolver({ timeout: 4000, tries: 2 });
  let error: string | null = null;
  const attempt = async <T>(fn: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code ?? "ERROR";
      if (!NO_RECORD.has(code)) error ??= code;
      return empty;
    }
  };
  const [a, aaaa, cname, caa] = await Promise.all([
    attempt(() => resolver.resolve4(hostname), [] as string[]),
    attempt(() => resolver.resolve6(hostname), [] as string[]),
    attempt(async () => (await resolver.resolveCname(hostname))[0] ?? null, null as string | null),
    attempt(
      async () =>
        (await resolver.resolveCaa(hostname)).flatMap((r) => (r.issue ? [r.issue] : [])),
      [] as string[],
    ),
  ]);
  return { hostname, a, aaaa, cname, caa, error };
}
