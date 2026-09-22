import { DashboardNav } from "@/components/dashboard-nav";
import { requireOwner } from "@/lib/session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const owner = await requireOwner();
  return (
    <div className="flex flex-1 flex-col">
      <DashboardNav
        title="Store admin"
        who={owner.email}
        links={[
          { href: "/admin", label: "Dashboard" },
          { href: "/admin/content", label: "Content" },
          { href: "/admin/products", label: "Products" },
          { href: "/admin/categories", label: "Categories" },
          { href: "/admin/orders", label: "Orders" },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 py-8">
        {children}
      </main>
    </div>
  );
}
