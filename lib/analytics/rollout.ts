/**
 * Launch control for first-party storefront analytics
 * (STOREFRONT_ANALYTICS_MASTER_PLAN.md §2.3).
 *
 * This gates COLLECTION only. Two things are deliberately outside it:
 *
 *  - The consent banner, and
 *  - the gating of the per-store third-party tags (GA4, Google Ads, Meta Pixel).
 *
 * Both of those apply to every store from day one. Tying them to the rollout would leave every
 * store outside the pilot firing third-party tags with no consent decision at all, which is the
 * exact behavior §2.2 lists as having to change. So: a store outside the rollout still asks for
 * consent and still honours it; it simply has no first-party events to send yet.
 *
 * Server-only (reads lib/env.ts).
 */

import { env } from "@/lib/env";

/** The fields rollout decisions need — a structural type, so callers can pass a `select`ed row. */
export type RolloutTenant = {
  slug: string;
  analyticsPausedAt: Date | null;
};

/**
 * The platform's emergency stop (§2.3). Separate from `Tenant.isPaused`, which takes the whole
 * storefront offline: this one only silences analytics and leaves the store selling.
 */
export function analyticsPaused(tenant: Pick<RolloutTenant, "analyticsPausedAt">): boolean {
  return tenant.analyticsPausedAt !== null;
}

/** Whether first-party analytics collection is switched on for this store right now. */
export function rolloutIncludes(tenant: RolloutTenant): boolean {
  if (analyticsPaused(tenant)) return false;
  switch (env.ANALYTICS_ROLLOUT_MODE) {
    case "all":
      return true;
    case "pilot":
      // env validation guarantees the slug is set whenever the mode is "pilot".
      return tenant.slug === env.ANALYTICS_PILOT_TENANT_SLUG;
    case "off":
      return false;
  }
}
