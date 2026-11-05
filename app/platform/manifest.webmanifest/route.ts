import { platformManifest } from "@/lib/push/manifest";

/** The platform console's installable identity (§11.1). See the admin one for why this is a route. */
export function GET() {
  return Response.json(platformManifest(), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=3600",
    },
  });
}
