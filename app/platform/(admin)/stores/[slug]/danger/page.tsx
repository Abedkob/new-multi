import { SectionCard } from "@/components/admin/section-card";
import { DeleteStoreButton } from "../delete-store-button";
import { loadStore } from "../load";

export default async function StoreDangerPage({
  params,
}: PageProps<"/platform/stores/[slug]/danger">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);

  return (
    // The one red edge in a monochrome console, and the reason `--destructive` keeps its chroma
    // (ADMIN_UI.md §12): on a screen with no other colour, red means "this is irreversible" and
    // nothing else can.
    <SectionCard
      className="border-destructive/50"
      title="Delete store"
      description={
        <>
          Permanently deletes this store, its {tenant._count.products} products,{" "}
          {tenant._count.orders} orders and the owner account. This cannot be undone.
          {tenant.domain && (
            <>
              {" "}
              {tenant.domain} stops serving anything immediately — remove its DNS records
              afterwards.
            </>
          )}
        </>
      }
    >
      <DeleteStoreButton
        slug={tenant.slug}
        storeName={tenant.name}
        productCount={tenant._count.products}
        orderCount={tenant._count.orders}
      />
    </SectionCard>
  );
}
