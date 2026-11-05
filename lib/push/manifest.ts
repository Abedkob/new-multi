/**
 * The two installable identities (§11.1).
 *
 * Two manifests rather than one, because they are two apps to the person installing them: a
 * merchant installs "my shop's admin" and a platform operator installs the console. One manifest
 * with a start URL of `/` would install a single app that opens on whichever the installer
 * happened to be looking at, and iOS would show one Home Screen icon for both.
 *
 * Neither is linked from the storefront. A shop's customers must not be offered an install
 * prompt for the admin app — which is what a root `app/manifest.ts` would do, since Next links
 * it from every page.
 *
 * Icons come from lib/push/icons.ts, generated from assets/icon-{admin,platform}.svg and
 * committed under public/icons (D76). The two apps have genuinely different marks, because an
 * operator who taps the wrong one of two identical Home Screen icons is looking at another
 * tenant's data before they notice. `pnpm verify:icons` checks every src here resolves to a
 * real PNG of the size it claims — Android refuses to install a manifest whose icons 404, and
 * it does not say why.
 */

import { iconSet } from "@/lib/push/icons";

export type AdminManifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "portrait";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

function manifest(kind: "admin" | "platform"): AdminManifest {
  const isAdmin = kind === "admin";
  return {
    // A stable id: changing it makes an installed app a *different* app, and the one on the
    // owner's Home Screen stops receiving updates.
    id: isAdmin ? "/admin" : "/platform",
    name: isAdmin ? "Store admin" : "Platform console",
    short_name: isAdmin ? "Store" : "Platform",
    start_url: isAdmin ? "/admin" : "/platform",
    // Scoped, so a notification tap into /admin opens the installed app rather than a browser
    // tab, and so the storefront is never inside the installed app's scope.
    scope: isAdmin ? "/admin" : "/platform",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: iconSet(kind)
      .filter((icon) => icon.target === "manifest")
      .map((icon) => ({
        src: icon.src,
        sizes: `${icon.size}x${icon.size}`,
        type: "image/png",
        purpose: icon.purpose,
      })),
  };
}

export const adminManifest = () => manifest("admin");
export const platformManifest = () => manifest("platform");
