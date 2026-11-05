import type { Metadata } from "next";
import { DashboardNav } from "@/components/dashboard-nav";
import { PlatformAnalytics } from "@/components/platform-analytics";
import { requirePlatformAdmin } from "@/lib/session";

/** The platform console's own installable identity (§11.1). */
export const metadata: Metadata = { manifest: "/platform/manifest.webmanifest" };

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
          { href: "/platform/analytics", label: "Analytics" },
          { href: "/platform/stores/new", label: "New store" },
        ]}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 py-8">
        {children}
      </main>
      <PlatformAnalytics />
    </div>
  );
}
