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

/**
 * The rollout as data: the mode, and the one slug that matters in `pilot`.
 *
 * Both decisions below are pure functions of this, and `current()` is the only place the
 * environment is read. That split is not ceremony — `lib/env.ts` validates at import, so a check
 * that wanted to exercise all three modes otherwise had to re-import the module per mode and
 * fight the require cache. A decision worth testing is worth making testable.
 */
export type Participation = {
  mode: "off" | "pilot" | "all";
  /** Set whenever mode is "pilot"; env validation guarantees it. */
  pilotSlug?: string;
};

function current(): Participation {
  return {
    mode: env.ANALYTICS_ROLLOUT_MODE,
    pilotSlug: env.ANALYTICS_PILOT_TENANT_SLUG,
  };
}

/** Whether this store takes part, given a rollout. Pure. */
export function includesWith(p: Participation, tenant: RolloutTenant): boolean {
  if (analyticsPaused(tenant)) return false;
  switch (p.mode) {
    case "all":
      return true;
    case "pilot":
      return tenant.slug === p.pilotSlug;
    case "off":
      return false;
  }
}

/** Whether first-party analytics collection is switched on for this store right now. */
export function rolloutIncludes(tenant: RolloutTenant): boolean {
  return includesWith(current(), tenant);
}

/**
 * The same decision as `rolloutIncludes`, as a database filter (§2.3).
 *
 * Why this exists. For four phases the scheduled command walked
 * `where: { analyticsPausedAt: null }` and the notification stages walked every store with no
 * filter at all, while every request-time path keyed on `rolloutIncludes`. Three definitions of
 * "this store participates", and the job's was the loosest — so a store the rollout excluded was
 * still aggregated every five minutes.
 *
 * That is not merely wasted work. `recomputeDays` upserts the daily metric unconditionally, so a
 * store with no events gets a row of zeros, which sets `lastComputedAt`, which makes
 * `/admin/analytics` consider the store measured and render **a grid of zeros** — the exact
 * outcome P5-25 and the NotMeasuring panel were written to prevent, because a grid of zeros
 * reads as "nobody came to your store" when the truth is "nothing has been counted yet". It
 * stayed invisible because the scheduled command could not run in the production image at all.
 *
 * Housekeeping deliberately does NOT use this: retention must delete an excluded store's old
 * rows, and new-order notifications, delivery leases and push cleanup are not analytics. The
 * split is asserted by `pnpm verify:rollout`.
 *
 * The trade-off, stated rather than hidden: in `off` nothing aggregates, so rolling the mode
 * back stops aggregates being corrected as well as stopping collection. A day that still needs
 * recomputing after a rollback is a manual
 * `node dist/analytics-scheduled.mjs --stage=nightly-backfill` with the mode temporarily set.
 */
export function participationWhere(): TenantParticipationFilter {
  return whereWith(current());
}

/** The filter shape, narrow on purpose so a caller cannot smuggle another condition in. */
export type TenantParticipationFilter = {
  analyticsPausedAt: null;
  slug?: string;
  id?: { in: string[] };
};

/** The same decision as `includesWith`, as a filter. Pure. */
export function whereWith(p: Participation): TenantParticipationFilter {
  switch (p.mode) {
    case "all":
      return { analyticsPausedAt: null };
    case "pilot":
      return { analyticsPausedAt: null, slug: p.pilotSlug };
    case "off":
      // Matches nothing, explicitly. An empty `in` is how this says "no store" to Prisma without
      // a caller having to special-case the mode and get it wrong.
      return { analyticsPausedAt: null, id: { in: [] } };
  }
}
