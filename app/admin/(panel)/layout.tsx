import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { countOrdersByStatus } from "@/lib/data/orders";
import { getTenantById } from "@/lib/data/tenants";
import { requireTenantMember } from "@/lib/session";
import { CAPABILITIES, can } from "@/lib/permissions";
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
  const allowed = CAPABILITIES.filter((capability) => can(member.role, capability));

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
