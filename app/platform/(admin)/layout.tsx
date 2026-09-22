import { DashboardNav } from "@/components/dashboard-nav";
import { requirePlatformAdmin } from "@/lib/session";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="flex flex-1 flex-col">
      <DashboardNav
        title="Platform admin"
        who={admin.email}
        widthClass="max-w-7xl"
        links={[
          { href: "/platform", label: "Home" },
          { href: "/platform/stores", label: "Stores" },
          { href: "/platform/stores/new", label: "New store" },
        ]}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 py-8">
        {children}
      </main>
    </div>
  );
}
