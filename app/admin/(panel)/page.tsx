import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { countOrdersByStatus } from "@/lib/data/orders";
import { countProducts } from "@/lib/data/products";
import { getTenantById } from "@/lib/data/tenants";
import { requireOwner } from "@/lib/session";

export default async function AdminHome() {
  const { tenantId, name } = await requireOwner();
  const [tenant, productCount, pendingOrders] = await Promise.all([
    getTenantById(tenantId),
    countProducts(tenantId),
    countOrdersByStatus(tenantId, "PENDING"),
  ]);
  if (!tenant) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-muted-foreground">Welcome back, {name}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Pending orders</CardDescription>
            <CardTitle className="text-3xl" data-testid="pending-orders">
              {pendingOrders}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Products</CardDescription>
            <CardTitle className="text-3xl">{productCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Storefront</CardDescription>
            <CardTitle className="font-mono text-base">
              /store/{tenant.slug}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/store/${tenant.slug}`}
          target="_blank"
          className={buttonVariants()}
        >
          View storefront
        </Link>
        <Link
          href="/admin/products/new"
          className={buttonVariants({ variant: "outline" })}
        >
          Add product
        </Link>
        <Link
          href="/admin/content"
          className={buttonVariants({ variant: "outline" })}
        >
          Edit content
        </Link>
      </div>
    </div>
  );
}
