import { SectionCard } from "@/components/admin/section-card";
import { countStockMovements } from "@/lib/data/stock-ledger";
import { loadStore } from "../load";
import { StockControl } from "./stock-control";

/**
 * Platform admin only: a store cannot give itself a module.
 *
 * The movement count is shown for the reason the till's sale count is — the decision to turn it
 * off is easier to make when you can see whether it has been used.
 */
export default async function StoreStockPage({
  params,
}: PageProps<"/platform/stores/[slug]/stock">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const movements = await countStockMovements(tenant.id);

  return (
    <SectionCard
      title="Stock management"
      description="Gives this store a stockroom: a history of every change to every stock figure, a screen for receiving goods, and a stocktake. Meant for owners who also sell over a counter. With it on, stock moves on its own screens instead of on the product form, so saving a product can no longer overwrite a shelf somebody just counted. Only you can switch this on — the owner doesn't see this setting."
    >
      <StockControl
        slug={tenant.slug}
        enabled={tenant.stockEnabled}
        firstEnabledAt={tenant.stockFirstEnabledAt}
        movements={movements}
      />
    </SectionCard>
  );
}
