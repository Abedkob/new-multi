import type { Metadata } from "next";
import { ConsoleNav } from "@/components/platform/console-nav";
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
    // `console-neutral` takes the chroma out of every token for this subtree (app/globals.css):
    // the console is monochrome, and it is applied here rather than on each page so a screen
    // cannot be added without it. `bg-muted/40` is the panel's shell colour, which is what makes
    // `bg-card` on a SectionCard mean something — on a white page a panel's surface is invisible
    // and only its border shows, which is how /platform looked before.
    <div className="console-neutral flex flex-1 flex-col bg-muted/40">
      <ConsoleNav
        title="Platform admin"
        who={admin.email}
        widthClass="max-w-7xl"
        links={[
          // `exact` on the root only: a prefix match would light "Home" up on every page in the
          // console, and the row would show two current sections at once.
          { href: "/platform", label: "Home", exact: true },
          { href: "/platform/stores", label: "Stores" },
          { href: "/platform/analytics", label: "Analytics" },
          { href: "/platform/notifications", label: "Notifications" },
        ]}
        action={{ href: "/platform/stores/new", label: "New store" }}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        {children}
      </main>
      <PlatformAnalytics />
    </div>
  );
}
