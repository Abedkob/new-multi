import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { countCounterSales } from "@/lib/data/counter-sales";
import { loadStore } from "../load";
import { CounterSalesControl } from "./counter-sales-control";

/**
 * Platform admin only: a store cannot give itself a sales channel.
 *
 * The count of recorded sales is shown because the decision to turn the till off is easier to
 * make when you can see whether it has been used.
 */
export default async function StoreCounterSalesPage({
  params,
}: PageProps<"/platform/stores/[slug]/counter">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const recordedSales = await countCounterSales(tenant.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Counter sales</CardTitle>
        <CardDescription>
          Gives this store a till: the owner and their staff can record sales made in person, paid
          by cash or card, and stock comes out of the same shelf as online orders. Only you can
          switch this on — the owner doesn&apos;t see this setting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CounterSalesControl
          slug={tenant.slug}
          enabled={tenant.counterSalesEnabled}
          firstEnabledAt={tenant.counterSalesFirstEnabledAt}
          recordedSales={recordedSales}
        />
      </CardContent>
    </Card>
  );
}
