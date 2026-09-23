/**
 * Pure domain-format helpers: no Node built-ins, no env import. Safe to import from anywhere,
 * including client components (lib/validation.ts's domainFormSchema uses them and is reachable
 * from client form components) and proxy.ts — unlike lib/domain-check.ts, which does real DNS
 * lookups and reads server env, and must only ever be imported from server-only code.
 */

/**
 * A bare hostname: letters/digits/hyphens per label, at least two labels, no protocol or path,
 * and a top-level label that isn't all digits (so an IPv4 literal like 203.0.113.10 is rejected —
 * a store needs a real domain, not the server's address).
 * Deliberately not exhaustively RFC-compliant — this only needs to catch obvious typos and
 * pasted URLs before they reach the real DNS check.
 */
export function isValidDomainFormat(v: string): boolean {
  return (
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(v) &&
    !/\.\d+$/.test(v)
  );
}

/**
 * Canonical form of a Host header / typed domain: lowercased, port removed, trailing root dot
 * ("acme.com.") removed. IPv6 literals ("[::1]:3000") come back as "[::1]" and never match a
 * stored domain. Tenant.domain is always stored in this form, so lookups compare like-for-like.
 */
export function normalizeHostname(host: string): string {
  const h = host.trim().toLowerCase();
  const bare = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
  return bare.replace(/\.$/, "");
}

/**
 * The www/apex twin of a hostname: "www.acme.com" <-> "acme.com". Owners almost always want
 * both to work, but only one is stored as Tenant.domain; proxy.ts redirects the twin to it.
 * Returns null for a bare two-label host with nothing sensible to strip ("www.com").
 */
export function wwwTwin(hostname: string): string | null {
  if (hostname.startsWith("www.")) {
    const apex = hostname.slice(4);
    return apex.includes(".") ? apex : null;
  }
  return `www.${hostname}`;
}
