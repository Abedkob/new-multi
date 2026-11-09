import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
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
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <SectionCard title={label}>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
    </SectionCard>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Figure label="Stores" value={stores} />
        <Figure label="Products (all stores)" value={products} />
      </div>
    </div>
  );
}
