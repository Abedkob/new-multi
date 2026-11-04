/**
 * Getting process-local counters somewhere another process can read them (D34, §11.10).
 *
 * The counters in `lib/analytics/health.ts` live in one Next process's memory. The scheduled
 * command that evaluates them runs in a different container, so it cannot see them — and an
 * internal endpoint would not help, because behind a proxy it would reach one arbitrary
 * instance and leave the others unread.
 *
 * So the process that owns the numbers writes them, and the scheduler only reads. Three rules
 * make that safe to do from inside a request path:
 *
 *  1. **After the response.** The flush runs in `after()`, so a shopper's beacon is answered
 *     before anything is written. Nothing about collection may ever wait on bookkeeping.
 *  2. **Best effort, always.** Every failure is swallowed. A health snapshot that could break
 *     ingestion would be worse than no snapshot, and the counters it failed to write are
 *     simply counted into the next window.
 *  3. **Only when due.** One row per instance per window, not one per batch. The window is
 *     `ANALYTICS_HEALTH_FLUSH_MINUTES` (default 5), and a process that receives no traffic
 *     writes nothing at all — so an absence of rows means silence, never failure.
 *
 * The row is deliberately not tenant-scoped. These are numbers about the platform's ingestion,
 * and separating them per store would make the one question they exist to answer — "is
 * ingestion healthy right now" — unanswerable.
 */

import { hostname } from "node:os";
import { env } from "@/lib/env";
import { analyticsPrisma } from "@/lib/prisma-analytics";
import { snapshotAnalyticsHealth, type AnalyticsHealth } from "@/lib/analytics/health";

/** Enough to tell two instances apart without naming anybody's infrastructure. */
let instanceId: string | undefined;
export function analyticsInstanceId(): string {
  if (!instanceId) {
    try {
      instanceId = `${hostname()}:${process.pid}`;
    } catch {
      instanceId = `unknown:${process.pid}`;
    }
  }
  return instanceId;
}

const windowMs = () => env.ANALYTICS_HEALTH_FLUSH_MINUTES * 60_000;

/** Whether the current window is old enough to be worth a row. */
export function healthFlushDue(health: AnalyticsHealth = snapshotAnalyticsHealth()): boolean {
  // A window with nothing in it is not worth a row however old it is: a quiet instance must
  // leave no trace, or "no rows" stops meaning silence.
  if (health.attemptedBatches === 0) return false;
  return health.windowMs >= windowMs();
}

/**
 * Writes the current window and resets it, if it is due.
 *
 * Returns what it wrote, for the checks. Callers in a request path must not await it for
 * correctness — pass it to `after()` and let it run when the response is already gone.
 */
export async function flushAnalyticsHealth(force = false): Promise<AnalyticsHealth | null> {
  try {
    const peek = snapshotAnalyticsHealth();
    if (!force && !healthFlushDue(peek)) return null;
    if (peek.attemptedBatches === 0) return null;

    // Reset as we read, so two windows can never overlap and no batch is counted twice.
    const health = snapshotAnalyticsHealth(true);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - health.windowMs);

    await analyticsPrisma.analyticsOperationalMetric.create({
      data: {
        instance: analyticsInstanceId(),
        windowStart,
        windowEnd,
        attemptedBatches: health.attemptedBatches,
        acceptedBatches: health.acceptedBatches,
        storedEvents: health.storedEvents,
        rejectedOwnershipEvents: health.rejectedOwnershipEvents,
        policyDrops: health.policyDrops,
        operationalDrops: health.operationalDrops,
        // D29: its own column, never folded into the operational rate. A 400 means our own code
        // sent something the contract refuses, and Phase 3 found exactly that defect while the
        // operational rate sat at zero throughout.
        contractRejections: health.invalidEnvelopes,
        policyDetail: health.policy,
        operationalDetail: health.operational,
      },
    });
    return health;
  } catch {
    // The counters stay where they are and roll into the next window. Nothing a shopper or a
    // merchant can see depends on this row existing.
    return null;
  }
}
