import { cn } from "@/lib/utils";

/** A segment sweeping left to right across a track — see .animate-loading-bar in globals.css. */
function BarLoader({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-1 w-48 overflow-hidden rounded-full bg-muted", className)}>
      <span className="absolute inset-y-0 w-1/3 rounded-full bg-foreground animate-loading-bar" />
    </div>
  );
}

/**
 * The very first thing a shopper sees, shown by app/store/[slug]/loading.tsx while the layout's
 * tenant + storefront data is still loading. Rendered before the tenant's own theme colors are
 * known (ThemeScope hasn't mounted yet), so it only uses the platform's neutral default palette
 * — never a store's brand color.
 */
export function StoreEntranceLoading({ name }: { name: string }) {
  return (
    <div
      role="status"
      aria-label="Loading store"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center"
    >
      <p aria-hidden className="max-w-xl truncate text-xl font-medium text-foreground sm:text-2xl">
        {name}
      </p>
      <BarLoader />
    </div>
  );
}

/**
 * For every other storefront route (shop, category, product, cart, checkout, search, pages).
 * The navbar/footer are already mounted (the layout doesn't re-run on same-store navigation), so
 * this only fills the content slot — plain, theme-aware, no store name repeated.
 */
export function SectionLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[50vh] items-center justify-center py-24">
      <BarLoader />
    </div>
  );
}
