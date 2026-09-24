import { headers } from "next/headers";
import { StoreEntranceLoading } from "@/components/store-loading";

/**
 * Best-effort display name from the slug alone (proxy.ts's x-store-slug header — see its
 * docstring for why loading.tsx, which Next renders with no params at all, can't get this any
 * other way). Deliberately not a DB lookup: Next can't stream anything, not even this fallback,
 * until this component resolves, so it has to stay instant. The real tenant.name replaces it a
 * moment later once the actual page renders.
 */
function titleCaseSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function StoreEntranceLoadingPage() {
  const slug = (await headers()).get("x-store-slug");
  return <StoreEntranceLoading name={slug ? titleCaseSlug(slug) : "Loading store…"} />;
}
