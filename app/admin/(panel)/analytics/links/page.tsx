import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { LinkBuilder, type LinkDestination } from "@/components/analytics/link-builder";
import { listCategories } from "@/lib/data/categories";
import { listProducts } from "@/lib/data/products";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { getStoreUrl } from "@/lib/store-url";

/**
 * The owner's tracked-link builder (§5.5, D37).
 *
 * This route does the two things the component deliberately cannot: it resolves the store's
 * public URL (which differs on a custom domain) and loads the destinations. The component
 * itself holds no routing or data loading, so Phase 5's Marketing section will mount it in a
 * tab without a rewrite and this page becomes a redirect.
 */
export default async function TrackedLinksPage() {
  const { tenantId } = await requireOwner();
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
      <PageHeader
        title={t("nav.trackedLinks")}
        description={t("trackedLinks.page.description")}
      />
      <LinkBuilder storeUrl={getStoreUrl(tenant)} destinations={destinations} />
    </div>
  );
}
