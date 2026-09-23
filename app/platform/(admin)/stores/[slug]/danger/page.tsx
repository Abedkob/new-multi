import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteStoreButton } from "../delete-store-button";
import { loadStore } from "../load";

export default async function StoreDangerPage({
  params,
}: PageProps<"/platform/stores/[slug]/danger">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>Delete store</CardTitle>
        <CardDescription>
          Permanently deletes this store, its {tenant._count.products} products,{" "}
          {tenant._count.orders} orders and the owner account. This cannot be undone.
          {tenant.domain && (
            <>
              {" "}
              {tenant.domain} stops serving anything immediately — remove its DNS records
              afterwards.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DeleteStoreButton
          slug={tenant.slug}
          storeName={tenant.name}
          productCount={tenant._count.products}
          orderCount={tenant._count.orders}
        />
      </CardContent>
    </Card>
  );
}
