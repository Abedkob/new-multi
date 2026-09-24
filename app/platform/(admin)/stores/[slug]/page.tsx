import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { loadStore, setupStatus } from "./load";
import { ResetPasswordButton } from "./reset-password-button";
import { UpdateStoreForm } from "./update-store-form";
import { StorePauseControl } from "./store-pause-control";
import { StoreLicenseControl } from "./store-license-control";

export default async function StoreOverviewPage({
  params,
}: PageProps<"/platform/stores/[slug]">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const status = setupStatus(tenant);
  const base = `/platform/stores/${tenant.slug}`;

  const checklist = [
    {
      done: status.domain,
      label: "Connect a custom domain",
      detail: status.domain
        ? `Live at ${tenant.domain}.`
        : "Optional, but needed for the store's own Search Console property and Meta domain verification.",
      href: `${base}/domain`,
    },
    {
      done: status.domain ? status.searchConsoleTag : true,
      label: "Verify in Google Search Console and submit the sitemap",
      detail: status.domain
        ? status.searchConsoleTag
          ? "HTML-tag token saved. Make sure the sitemap is submitted too."
          : "Not needed if you verified with a DNS TXT record — then just submit the sitemap."
        : "Covered by the platform's own sitemap until the store has its own domain.",
      href: `${base}/search`,
    },
    {
      done: status.ga,
      label: "Google Analytics 4",
      detail: status.ga ? "Measurement ID set." : "Add a GA4 Measurement ID to see traffic and sales.",
      href: `${base}/analytics`,
    },
    {
      done: status.metaPixel,
      label: "Meta Pixel (Facebook & Instagram ads)",
      detail: status.metaPixel ? "Pixel ID set." : "Only needed if this store runs Meta ads.",
      href: `${base}/analytics`,
    },
    {
      done: status.ads,
      label: "Google Ads purchase conversion",
      detail: status.ads
        ? "Tag ID and purchase label set."
        : "Only needed if this store runs Google Ads (or import the GA4 purchase event instead).",
      href: `${base}/analytics#google-ads`,
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Store</CardTitle>
          <CardDescription>
            {tenant._count.products} products · {tenant._count.orders} orders · created{" "}
            {tenant.createdAt.toLocaleDateString("en-US")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <UpdateStoreForm slug={tenant.slug} initialName={tenant.name} />
        </CardContent>
      </Card>

      <Card className={tenant.isPaused ? "border-destructive/50" : undefined}>
        <CardHeader>
          <CardTitle>Store availability</CardTitle>
          <CardDescription>
            Pausing stops the public storefront and checkout. The owner can still sign in to manage
            the store, and you can resume it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StorePauseControl
            slug={tenant.slug}
            isPaused={tenant.isPaused}
            pausedAt={tenant.pausedAt}
            pauseReason={tenant.pauseReason}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Store license</CardTitle>
          <CardDescription>
            License keys and activation tokens are kept encrypted on the server. A configured
            license must remain active, including its provider-reported offline grace period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StoreLicenseControl slug={tenant.slug} license={tenant.license} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup checklist</CardTitle>
          <CardDescription>What&apos;s done, and what&apos;s left to do for this store.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3" data-testid="setup-checklist">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-start gap-3">
                <span
                  aria-label={item.done ? "done" : "to do"}
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-xs",
                    item.done
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border text-transparent",
                  )}
                >
                  ✓
                </span>
                <div className="grid flex-1 gap-0.5">
                  <Link href={item.href} className="text-sm font-medium hover:underline">
                    {item.label}
                  </Link>
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owner</CardTitle>
          <CardDescription>
            {tenant.owner.name} &middot; {tenant.owner.email}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Owners manage their products, categories, orders and page content from their own
            dashboard. Template, colors, domain, search and analytics are managed here.
          </p>
          <Separator />
          <ResetPasswordButton slug={tenant.slug} ownerEmail={tenant.owner.email} />
        </CardContent>
      </Card>

      <div>
        <Link
          href={`${base}/theme`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Open template &amp; theme editor ↗
        </Link>
      </div>
    </>
  );
}
