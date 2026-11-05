import { adminManifest } from "@/lib/push/manifest";

/**
 * The merchant admin's installable identity (§11.1).
 *
 * A route handler rather than Next's `app/manifest.ts`, because that one is linked from every
 * page in the app — including the storefront, which would offer a shop's customers an install
 * prompt for its owner's admin panel.
 *
 * Public: a manifest names the app and nothing else. It is the same for every store, so there is
 * nothing here to scope to a tenant and nothing to authenticate.
 */
export function GET() {
  return Response.json(adminManifest(), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=3600",
    },
  });
}
