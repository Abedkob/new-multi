import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { countOrdersByStatus } from "@/lib/data/orders";
import { getTenantById } from "@/lib/data/tenants";
import { requireOwner } from "@/lib/session";
import { getStoreUrl } from "@/lib/store-url";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const owner = await requireOwner();
  const [tenant, pendingOrders] = await Promise.all([
    getTenantById(owner.tenantId),
    countOrdersByStatus(owner.tenantId, "PENDING"),
  ]);
  if (!tenant) notFound();

  return (
    <div className="flex flex-1 flex-col bg-muted/40 md:flex-row">
      <AdminNav
        storeName={tenant.name}
        storeUrl={getStoreUrl(tenant)}
        email={owner.email}
        pendingOrders={pendingOrders}
      />
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">
        {children}
      </main>
    </div>
  );
}
