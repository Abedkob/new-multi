import { NextResponse } from "next/server";
import { getTenantByDomain } from "@/lib/data/tenants";
import { isValidDomainFormat, normalizeHostname, wwwTwin } from "@/lib/domain-format";

export const dynamic = "force-dynamic";

/**
 * On-demand TLS gate for the reverse proxy in front of Next (e.g. Caddy's
 * `on_demand_tls { ask http://127.0.0.1:3000/api/tls-check }`). Before issuing a certificate
 * for a hostname it has never seen, the proxy calls this with ?domain=<host>: 200 means "a store
 * serves this host" (its connected domain, or that domain's www/apex twin, which proxy.ts
 * redirects), anything else means refuse. Without a gate like this, anyone could point a
 * domain at the server and make it request certificates for them until the CA rate-limits it.
 *
 * Only reveals whether a domain is connected, which the domain's own DNS already makes public.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("domain") ?? "";
  const domain = normalizeHostname(raw);
  if (!isValidDomainFormat(domain)) return new NextResponse(null, { status: 400 });

  if (await getTenantByDomain(domain)) return new NextResponse(null, { status: 200 });
  const twin = wwwTwin(domain);
  if (twin && (await getTenantByDomain(twin))) return new NextResponse(null, { status: 200 });
  return new NextResponse(null, { status: 404 });
}
