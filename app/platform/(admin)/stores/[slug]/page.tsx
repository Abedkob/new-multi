import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/admin/section-card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { DuplicateStoreForm } from "./duplicate-store-form";
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
      done: status.privacy,
      label: "Privacy and reporting setup",
      detail: status.privacy
        ? `Responsible business and contact set · ${tenant.analyticsTimezone}.`
        : "Needed before this store can be measured: shoppers must be able to see who is responsible and how to get in touch.",
      href: `${base}/privacy`,
    },
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
      <SectionCard
        title="Store"
        description={
          <>
            {tenant._count.products} products · {tenant._count.orders} orders · created{" "}
            {tenant.createdAt.toLocaleDateString("en-US")}
          </>
        }
      >
        <UpdateStoreForm slug={tenant.slug} initialName={tenant.name} />
      </SectionCard>

      <SectionCard
        className={tenant.isPaused ? "border-destructive/50" : undefined}
        title="Store availability"
        description="Pausing stops the public storefront and checkout. The owner can still sign in to manage the store, and you can resume it here."
      >
        <StorePauseControl
          slug={tenant.slug}
          isPaused={tenant.isPaused}
          pausedAt={tenant.pausedAt}
          pauseReason={tenant.pauseReason}
        />
      </SectionCard>

      <SectionCard
        title="Store license"
        description="License keys and activation tokens are kept encrypted on the server. A configured license must remain active, including its provider-reported offline grace period."
      >
        <StoreLicenseControl slug={tenant.slug} license={tenant.license} />
      </SectionCard>

      <SectionCard
        title="Setup checklist"
        description="What's done, and what's left to do for this store."
      >
        <ul className="grid gap-3" data-testid="setup-checklist">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-start gap-3">
              {/* A filled tick, not a green one: `bg-primary` is near-black in this subtree, so
                  "done" reads as ink against an empty outline rather than as a hue. */}
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
      </SectionCard>

      <SectionCard
        title="Owner"
        description={
          <>
            {tenant.owner.name} &middot; {tenant.owner.email}
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Owners manage their products, categories, orders and page content from their own
            dashboard. Template, colors, domain, search and analytics are managed here.
          </p>
          <Separator />
          <ResetPasswordButton slug={tenant.slug} ownerEmail={tenant.owner.email} />
        </div>
      </SectionCard>

      {/* Was a bare button floating between six panels, which read as a stray control rather
          than a section. The editor is a separate full-screen page, so it gets a panel that
          says what it is before it sends you there. */}
      <SectionCard
        title="Template & theme"
        description="The store's template, colours and layout, with a live preview. Opens as its own full-screen editor."
      >
        <Link
          href={`${base}/theme`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Open template &amp; theme editor ↗
        </Link>
      </SectionCard>

      <SectionCard
        title="Duplicate this store"
        description={
          <>
            Copies the template, theme, content, {tenant._count.products} products and every
            category into a brand-new store with its own owner. Orders, the domain, license and
            analytics/ads ids never carry over.
          </>
        }
      >
        <DuplicateStoreForm slug={tenant.slug} storeName={tenant.name} />
      </SectionCard>
    </>
  );
}
