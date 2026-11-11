import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { StatGroup } from "@/components/admin/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { getPlatformStats } from "@/lib/data/tenants";
import { cn } from "@/lib/utils";

/**
 * Deliberately not `StatTile`. That component exists to keep three rules about *measurements* —
 * a figure is exact, a percentage with no denominator is withheld, a verdict travels with its
 * evidence — and it is a client component that reads the dashboard's translation context, which
 * the console does not mount. These two are inventory counts with no period, no comparison and
 * no trend, so they are a panel with a number in it.
 */
/**
 * The console's own figure, because `StatTile` is a client component that reads the dictionary
 * and the console has no i18n provider — the same reason the platform analytics screen hand-rolls
 * its tiles. `StatGroup` IS shared: it is pure presentation and takes children, so both tools get
 * the same divided-group shape without the console needing a locale.
 *
 * `text-2xl`, not `text-3xl`: §7 says a figure must not outrank the page's own title, and this
 * one did.
 */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </span>
    </div>
  );
}

export default async function PlatformHome() {
  const { stores, products } = await getPlatformStats();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Platform overview"
        description="What exists on this deployment. Stores are created here; owners manage their own storefronts."
        actions={
          <>
            <Link href="/platform/stores/new" className={cn(buttonVariants())}>
              Create a store
            </Link>
            <Link
              href="/platform/stores"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              View all stores
            </Link>
          </>
        }
      />
      <StatGroup columns={2}>
        <Figure label="Stores" value={stores} />
        <Figure label="Products (all stores)" value={products} />
      </StatGroup>
    </div>
  );
}
