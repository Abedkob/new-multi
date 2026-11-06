/**
 * Has the scheduled update ever run for this store?
 *
 * The third condition measurement needs, and the one the "nothing has been measured yet" panel
 * used to leave out. It checked the rollout and consent — both of which a store can satisfy
 * while the report stays empty, because the figures are built from aggregates and the aggregates
 * are built by `node dist/analytics-scheduled.mjs`. When that command had no entrypoint in the
 * production image, an operator saw two ticks and an empty dashboard and went looking in the one
 * place the panel pointed: consent. The missing sentence cost a day.
 *
 * Read from `AnalyticsAggregationCursor`, not from the raw event tables: the report layer's
 * aggregate-only rule (P5-01, `verify:reports`) forbids any consumer of `lib/analytics/report.ts`
 * from touching `analyticsEvent`, `analyticsSession` or `analyticsVisitor`, and the analytics
 * page is such a consumer. The cursor is also the better fact — it says a stage ran *for this
 * store*, which is what the owner is being told.
 */

import { withTenant } from "@/lib/prisma";

/** True once any aggregation stage has completed a run for this store. */
export async function hasAggregationRun(tenantId: string): Promise<boolean> {
  const cursor = await withTenant(tenantId, (db) =>
    db.analyticsAggregationCursor.findFirst({
      where: { tenantId, lastRunAt: { not: null } },
      select: { id: true },
    }),
  );
  return cursor !== null;
}
