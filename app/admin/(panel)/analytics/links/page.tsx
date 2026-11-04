import { permanentRedirect } from "next/navigation";

/**
 * Phase 4 shipped the tracked-link builder at this path; Phase 5 moved it into Marketing
 * (D38, P5-15). The redirect stays because owners were given this link and may have
 * bookmarked it.
 *
 * `LinkBuilder` itself moved **unchanged** — the component holds no routing and no data
 * loading, which is the property P4-35 exists to protect and this is the first use of it.
 */
export default function MovedTrackedLinksPage() {
  permanentRedirect("/admin/marketing/links");
}
