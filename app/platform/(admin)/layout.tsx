import type { Metadata } from "next";
import { DashboardNav } from "@/components/dashboard-nav";
import { PlatformAnalytics } from "@/components/platform-analytics";
import { appleTouchIcon } from "@/lib/push/icons";
import { requirePlatformAdmin } from "@/lib/session";

/**
 * The platform console's own installable identity (§11.1), with its own icon — see
 * app/admin/layout.tsx for why the apple-touch link is needed at all, and
 * assets/icon-platform.svg for why this mark is a different shape and colour rather than the
 * merchant one recoloured.
 */
export const metadata: Metadata = {
  manifest: "/platform/manifest.webmanifest",
  icons: { icon: "/icons/platform-192.png", apple: appleTouchIcon("platform") },
};

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
          { href: "/platform/notifications", label: "Notifications" },
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
