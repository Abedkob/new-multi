import { notFound } from "next/navigation";
import { saveCampaignAction } from "../campaigns/actions";
import { LinkBuilder, type LinkDestination } from "@/components/analytics/link-builder";
import { listCategories } from "@/lib/data/categories";
import { listProducts } from "@/lib/data/products";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { getStoreUrl } from "@/lib/store-url";

/**
 * The owner's tracked-link builder (§5.5, D37).
 *
 * This route does the two things the component deliberately cannot: it resolves the store's
 * public URL (which differs on a custom domain) and loads the destinations. The component holds
 * no routing and no data loading, which is why moving it here in Phase 5 needed no change to it
 * at all (P4-35's property, P5-15's requirement); the Phase 4 path is now a redirect.
 */
export default async function TrackedLinksPage() {
  const { tenantId } = await requireCapability("marketing:read");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const [categories, products] = await Promise.all([
    listCategories(tenantId),
    listProducts(tenantId),
  ]);

  // Home, the catalog, then the store's own categories and products. Capped, because a picker
  // with four hundred products in it is not a picker.
  const destinations: LinkDestination[] = [
    { label: "Store home", path: "" },
    { label: "Everything (shop)", path: "/shop" },
    ...categories.slice(0, 30).map((category: { name: string; slug: string }) => ({
      label: `Category: ${category.name}`,
      path: `/category/${category.slug}`,
    })),
    ...products.slice(0, 50).map((product: { name: string; slug: string }) => ({
      label: `Product: ${product.name}`,
      path: `/products/${product.slug}`,
    })),
  ];

  return (
    <div className="grid gap-4">
      {/* The section header is the layout's; this is the tab's own line. */}
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("trackedLinks.page.description")}
      </p>
      {/* The save handler is passed in, not imported by the component: the builder still holds
          no action and no data loading of its own (D37, P5-15). */}
      <LinkBuilder
        storeUrl={getStoreUrl(tenant)}
        destinations={destinations}
        onSaveCampaign={saveCampaignAction}
      />
    </div>
  );
}
