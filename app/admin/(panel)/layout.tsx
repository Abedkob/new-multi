import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { countOrdersByStatus } from "@/lib/data/orders";
import { getTenantById } from "@/lib/data/tenants";
import { requireTenantMember } from "@/lib/session";
import { CAPABILITIES, can } from "@/lib/permissions";
import { hasCounterSaleHistory } from "@/lib/counter-sales";
import { hasStockHistory } from "@/lib/stock";
import { getStoreUrl } from "@/lib/store-url";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The shell serves both roles and grants neither anything: every page below it names its own
  // capability. What the role decides here is only which links are drawn — see AdminNav.
  const member = await requireTenantMember();
  const [tenant, pendingOrders] = await Promise.all([
    getTenantById(member.tenantId),
    countOrdersByStatus(member.tenantId, "PENDING"),
  ]);
  if (!tenant) notFound();
  // `allowed` already means exactly "which links to draw", so the store's own facts belong here
  // too: both counter capabilities are held by both roles in EVERY store, and without this a
  // shop with no till would be offered one. "This store has a till" is not a viewer fact, so it
  // is filtered here rather than by adding a second concept to AdminNav.
  //
  // The two questions are deliberately different. History stays reachable once a store has ever
  // had a till, so an owner never loses sight of takings they already recorded; selling needs the
  // switch to be on right now. Neither costs a query — both are columns on the row above.
  const allowed = CAPABILITIES.filter((capability) => {
    if (!can(member.role, capability)) return false;
    if (capability === "counter:read") return hasCounterSaleHistory(tenant);
    if (capability === "counter:sell") return tenant.counterSalesEnabled;
    // The stockroom, by the same rule and for the same reason: the history stays reachable once a
    // store has ever had the module, so an owner never loses sight of movements already recorded.
    // Two more columns on the row above, so still no extra query.
    if (capability === "stock:read") return hasStockHistory(tenant);
    if (capability === "stock:move") return tenant.stockEnabled;
    return true;
  });

  return (
    <div className="flex flex-1 flex-col bg-muted/40 md:flex-row">
      <AdminNav
        storeName={tenant.name}
        storeUrl={getStoreUrl(tenant)}
        email={member.email}
        pendingOrders={pendingOrders}
        allowed={allowed}
      />
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">
        {children}
      </main>
    </div>
  );
}
