import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
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
      {/* This layout owns the h1 for every page in the section, so none of them renders one —
          the same rule as /admin's Analytics and Marketing layouts, and the one `verify:admin-ui`
          checks. The back link, the title and the actions were a hand-rolled copy of PageHeader
          with its own class list; the arrow it drew by hand did not flip in Arabic, which the
          console does not use today but the component handles anyway. */}
      <PageHeader
        title={tenant.name}
        back={{ href: "/platform/stores", label: "All stores" }}
        actions={
          <Link
            href={getStoreUrl(tenant)}
            target="_blank"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            View store ↗
          </Link>
        }
        className="mb-0"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{tenant.domain ?? `/store/${tenant.slug}`}</span>
          <Badge variant={tenant.domain ? "default" : "secondary"}>
            {tenant.domain ? "Custom domain" : "Platform URL"}
          </Badge>
        </div>
      </PageHeader>

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
              {
                href: `${base}/privacy`,
                label: "Privacy",
                todo: !status.privacy,
              },
              { href: `${base}/branding`, label: "Favicon" },
              // No `todo` dot: setupStatus means "what is incomplete", and a store without a
              // till is not incomplete. It is a commercial arrangement, not a missing step.
              { href: `${base}/counter`, label: "Counter sales" },
              // Same reasoning: a store without a stockroom is not incomplete.
              { href: `${base}/stock`, label: "Stock management" },
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
