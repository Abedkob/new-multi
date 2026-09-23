import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getStoreUrl } from "@/lib/store-url";
import { cn } from "@/lib/utils";
import { loadStore, setupStatus } from "./load";
import { StoreNav } from "./store-nav";

/** "Manage store": one store's settings, split into sidebar sections. Platform admin only. */
export default async function ManageStoreLayout({
  children,
  params,
}: LayoutProps<"/platform/stores/[slug]">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const status = setupStatus(tenant);
  const base = `/platform/stores/${tenant.slug}`;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Link
            href="/platform/stores"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← All stores
          </Link>
          <h1 className="text-2xl font-semibold">{tenant.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{tenant.domain ?? `/store/${tenant.slug}`}</span>
            <Badge variant={tenant.domain ? "default" : "secondary"}>
              {tenant.domain ? "Custom domain" : "Platform URL"}
            </Badge>
          </div>
        </div>
        <Link
          href={getStoreUrl(tenant)}
          target="_blank"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          View store ↗
        </Link>
      </div>

      {/* minmax(0, …) columns: the phone nav strip scrolls inside its own box instead of
          stretching the column (and the whole page) to its full width. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="min-w-0 md:sticky md:top-4 md:self-start">
          <StoreNav
            items={[
              { href: base, label: "Overview" },
              { href: `${base}/domain`, label: "Domain", todo: !status.domain },
              {
                href: `${base}/search`,
                label: "Google Search",
                todo: !status.domain && !status.searchConsoleTag,
              },
              {
                href: `${base}/analytics`,
                label: "Analytics & ads",
                todo: !status.ga && !status.metaPixel,
              },
              { href: `${base}/branding`, label: "Favicon" },
              { href: `${base}/theme`, label: "Theme", external: true },
              { href: `${base}/danger`, label: "Danger zone" },
            ]}
          />
        </aside>
        <div className="grid min-w-0 content-start gap-6">{children}</div>
      </div>
    </div>
  );
}
