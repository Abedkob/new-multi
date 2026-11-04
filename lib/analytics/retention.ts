/**
 * Deleting what we no longer have a reason to keep (§4.7, D28, D35).
 *
 * This is the first thing in this project that destroys data, and it is written accordingly.
 *
 *  - **Nothing here touches an `Order`.** Orders are kept under commercial and tax rules, long
 *    past the analytics windows. A session deleted here leaves `Order.analyticsSessionId`
 *    pointing at a row that no longer exists, and that is by design: there is deliberately no
 *    foreign key, precisely so this deletion is possible (see the comment on the Order model).
 *    The order keeps its non-identifying dimensions and stays reconcilable as a sale.
 *
 *  - **Aggregates survive the raw events they came from.** Raw events last 90 days and daily
 *    figures 24 months, which is the whole reason aggregates exist as tables rather than as
 *    queries. A merchant comparing this February to last February must not be told the past
 *    was empty.
 *
 *  - **Everything is chunked.** A single `DELETE` over a year of events would hold locks and a
 *    transaction open for as long as it took; bounded batches let the job stop cleanly between
 *    them and leave the storefront alone throughout.
 *
 *  - **It can be asked what it would do** (D35). `--dry-run` counts exactly what each window
 *    matches and deletes nothing. The first production run is a dry run: a deletion count that
 *    surprises us is a bug found for free, and the alternative is finding it afterwards.
 */

import { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { withJobBypass, type JobTx } from "@/lib/prisma-job";

/** Rows per statement. Small enough that a batch never holds a lock long. */
const CHUNK = 1_000;

/** A safety stop, so one run can never spend an unbounded time deleting. */
const MAX_CHUNKS_PER_TABLE = 50;

export type RetentionWindow = {
  table: string;
  /** What §4.7 says, in words, for the run record a human reads. */
  rule: string;
  cutoff: Date;
  matched: number;
  deleted: number;
};

export type RetentionResult = {
  dryRun: boolean;
  windows: RetentionWindow[];
  totalDeleted: number;
};

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);
const monthsAgo = (now: Date, months: number) => {
  const then = new Date(now);
  then.setUTCMonth(then.getUTCMonth() - months);
  return then;
};

/**
 * Deletes in bounded batches by primary key.
 *
 * `deleteMany` has no LIMIT, so the ids come first and the delete follows — which also means a
 * row that arrives between the two statements is simply left for the next run, rather than
 * extending this one indefinitely.
 */
async function deleteInChunks(
  tx: JobTx,
  table: string,
  where: Prisma.Sql,
  dryRun: boolean,
): Promise<{ matched: number; deleted: number }> {
  const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT count(*) AS count FROM ${Prisma.raw(`"${table}"`)} WHERE ${where}`,
  );
  const matched = Number(count);
  if (dryRun || matched === 0) return { matched, deleted: 0 };

  let deleted = 0;
  for (let chunk = 0; chunk < MAX_CHUNKS_PER_TABLE; chunk++) {
    const removed = await tx.$executeRaw(
      Prisma.sql`
        DELETE FROM ${Prisma.raw(`"${table}"`)}
        WHERE "id" IN (
          SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE ${where} LIMIT ${CHUNK}
        )
      `,
    );
    deleted += removed;
    if (removed < CHUNK) break;
  }
  return { matched, deleted };
}

/**
 * Applies every §4.7 window, across all stores.
 *
 * Cross-tenant by nature — retention is the platform's obligation, not one store's — so it runs
 * under `withJobBypass`. The windows are keyed on time alone and never on a tenant, so there is
 * no WHERE clause here that a tenant context would protect anyway.
 */
export async function runRetention(now: Date, dryRun: boolean): Promise<RetentionResult> {
  const rawCutoff = daysAgo(now, env.ANALYTICS_RAW_RETENTION_DAYS);
  const visitorCutoff = monthsAgo(now, env.ANALYTICS_VISITOR_RETENTION_MONTHS);
  const aggregateCutoff = monthsAgo(now, env.ANALYTICS_AGGREGATE_RETENTION_MONTHS);
  const receiptCutoff = monthsAgo(now, env.ANALYTICS_RECEIPT_RETENTION_MONTHS);

  const windows: RetentionWindow[] = [];

  await withJobBypass(async (tx) => {
    const step = async (table: string, rule: string, cutoff: Date, where: Prisma.Sql) => {
      const { matched, deleted } = await deleteInChunks(tx, table, where, dryRun);
      windows.push({ table, rule, cutoff, matched, deleted });
    };

    // Raw events: 90 days. The oldest thing we keep and the largest.
    await step(
      "AnalyticsEvent",
      `raw events older than ${env.ANALYTICS_RAW_RETENTION_DAYS} days`,
      rawCutoff,
      Prisma.sql`"occurredAt" < ${rawCutoff}`,
    );

    // Sessions and visitors: 13 months after last activity. Sessions first, because a visitor
    // cascade would take sessions with it and make the session count meaningless in the report.
    await step(
      "AnalyticsSession",
      `sessions inactive for ${env.ANALYTICS_VISITOR_RETENTION_MONTHS} months`,
      visitorCutoff,
      Prisma.sql`"lastActivityAt" < ${visitorCutoff}`,
    );
    await step(
      "AnalyticsVisitor",
      `visitors unseen for ${env.ANALYTICS_VISITOR_RETENTION_MONTHS} months`,
      visitorCutoff,
      Prisma.sql`"lastSeenAt" < ${visitorCutoff}`,
    );

    // Consent receipts: 24 months past the decision's own expiry (§4.7), not past the decision.
    await step(
      "AnalyticsConsentReceipt",
      `consent receipts ${env.ANALYTICS_RECEIPT_RETENTION_MONTHS} months past expiry`,
      receiptCutoff,
      Prisma.sql`"expiresAt" < ${receiptCutoff}`,
    );

    // Aggregates: 24 months. Deliberately the longest window — see the header.
    for (const table of ["AnalyticsDailyMetric", "AnalyticsHourlyMetric", "AnalyticsProductDaily", "AnalyticsSearchDaily", "AnalyticsAcquisitionDaily"]) {
      await step(
        table,
        `aggregates older than ${env.ANALYTICS_AGGREGATE_RETENTION_MONTHS} months`,
        aggregateCutoff,
        Prisma.sql`"localDay" < ${aggregateCutoff}`,
      );
    }

    // The job's own bookkeeping, so the run table does not grow forever.
    await step(
      "AnalyticsScheduledRun",
      "run records older than 90 days",
      daysAgo(now, 90),
      Prisma.sql`"startedAt" < ${daysAgo(now, 90)}`,
    );
  });

  return {
    dryRun,
    windows,
    totalDeleted: windows.reduce((sum, w) => sum + w.deleted, 0),
  };
}

/** One line per window, for the run record and the operator's eyes. */
export const describeRetention = (result: RetentionResult) =>
  result.windows
    .filter((w) => w.matched > 0)
    .map((w) => `${w.table}: ${result.dryRun ? `${w.matched} would go` : `${w.deleted} deleted`}`)
    .join("; ") || "nothing to delete";
