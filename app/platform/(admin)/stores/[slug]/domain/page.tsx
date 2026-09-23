import { CopyText } from "@/components/copy-text";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { wwwTwin } from "@/lib/domain-format";
import { env } from "@/lib/env";
import { DomainForm } from "../domain-form";
import { loadStore } from "../load";
import { DnsCheck } from "./dns-check";

export default async function StoreDomainPage({
  params,
}: PageProps<"/platform/stores/[slug]/domain">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);

  const ip = env.SERVER_PUBLIC_IP ?? null;
  const domain = tenant.domain ?? "yourdomain.com";
  const twin = wwwTwin(domain);
  // For a plain two-label domain (acme.com) DNS panels call the root "@" and the other "www".
  // For anything longer (shop.acme.com, acme.co.uk) we can't tell where the registered domain
  // starts, so show the full name and let the hint explain.
  const hostLabel = (name: string) => {
    const bare = name.startsWith("www.") ? name.slice(4) : name;
    if (bare.split(".").length !== 2) return name;
    return name.startsWith("www.") ? "www" : "@";
  };
  const records = [domain, ...(twin ? [twin] : [])].map((name) => ({ name, host: hostLabel(name) }));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Custom domain</CardTitle>
          <CardDescription>
            {tenant.domain
              ? `The store is live at ${tenant.domain}. Old /store/${tenant.slug} links, the sitemap and canonical tags all use it now.`
              : `The store is only reachable at /store/${tenant.slug} until a domain is connected.`}
          </CardDescription>
          <CardAction>
            <Badge variant={tenant.domain ? "default" : "secondary"}>
              {tenant.domain ? "Connected" : "Not connected"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DomainForm slug={tenant.slug} initialDomain={tenant.domain} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to point a domain at this store</CardTitle>
          <CardDescription>
            Do this in the DNS settings wherever the domain was bought (GoDaddy, Namecheap,
            Cloudflare, Google/Squarespace Domains...), then connect it above.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 text-sm">
          <ol className="grid list-decimal gap-4 pl-5">
            <li>
              <div className="grid gap-2">
                <span>
                  <strong>Create these two records</strong> (edit them if they already exist):
                </span>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Host / Name</th>
                        <th className="px-3 py-2 font-medium">Value / Points to</th>
                        <th className="px-3 py-2 font-medium">TTL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.name} className="border-t">
                          <td className="px-3 py-2 font-mono">A</td>
                          <td className="px-3 py-2">
                            <CopyText value={r.host} />
                            <span className="block text-[11px] text-muted-foreground">({r.name})</span>
                          </td>
                          <td className="px-3 py-2">
                            {ip ? (
                              <CopyText value={ip} />
                            ) : (
                              <span className="text-destructive">SERVER_PUBLIC_IP not set</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">Auto / 1 hour</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              </div>
              <span className="text-xs text-muted-foreground">
                &ldquo;@&rdquo; means the domain itself. If a panel wants the host relative to
                the registered domain (e.g. <code>shop</code> for shop.acme.com), enter only
                the part before it. Both names are needed: whichever one you connect is the store&apos;s address, and
                the other one redirects to it automatically. A <code>CNAME</code> for{" "}
                <code>www</code> pointing at the root domain works too, instead of the second A
                record.
                {!ip && " Set SERVER_PUBLIC_IP (this server's public IPv4) in the environment to see the exact value here."}
              </span>
              </div>
            </li>
            <li>
              <strong>Delete anything else on those two names</strong>: other <code>A</code>{" "}
              records, any <code>AAAA</code> (IPv6) records, and &ldquo;parking&rdquo; or
              &ldquo;forwarding&rdquo; the registrar set up. Leftover records send some visitors
              to the old place and block the HTTPS certificate.
            </li>
            <li>
              <strong>On Cloudflare:</strong> set both records to <em>DNS only</em> (grey cloud),
              not <em>Proxied</em> (orange). Proxied records hide this server&apos;s IP, so saving
              the domain above rejects them.
            </li>
            <li>
              <strong>Wait for DNS to update</strong> — usually minutes, occasionally up to 24–48
              hours. Use <em>Check DNS</em> below until both names say &ldquo;Ready&rdquo;.
            </li>
            <li>
              <strong>Connect it</strong> with the form above. Saving re-checks that the domain
              points here, then the store switches over within about 30 seconds. The HTTPS
              certificate is issued automatically on the first visit (by Caddy, via
              /api/tls-check — see KNOWN_GAPS.md until Caddy is set up on the server).
            </li>
            <li>
              <strong>Afterwards:</strong> set up <em>Google Search</em> for the new address, and
              verify the domain in Meta if the store runs Meta ads (see the other sections).
            </li>
          </ol>
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Email on the same domain isn&apos;t affected — leave <code>MX</code> and{" "}
            <code>TXT</code> records alone. Disconnecting later (empty the field and save) sends
            the store back to /store/{tenant.slug}; the domain&apos;s DNS can then be removed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Check DNS</CardTitle>
          <CardDescription>
            Looks up what the domain and its www version point at right now. Works before the
            domain is connected. Changes nothing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DnsCheck initialDomain={tenant.domain ?? ""} />
        </CardContent>
      </Card>
    </>
  );
}
