/**
 * Active-now, as a merchant-facing question (§7.3, §8.2).
 *
 * Redis only: presence is a five-minute truth that nobody needs tomorrow, so writing it to
 * Postgres would buy nothing and cost a connection on every ping.
 *
 * The whole value of this module is the distinction between "nobody is here" and "we cannot
 * tell". A dashboard that shows 0 during a Redis outage is lying, and a merchant acts on it.
 */

import { env } from "@/lib/env";
import { countPresence, touchPresence, type PresenceResult } from "@/lib/redis";

export const presenceWindowMs = () => env.ANALYTICS_ACTIVE_WINDOW_MINUTES * 60_000;

/** Best effort: a failed touch costs one visitor's presence for a few minutes, nothing more. */
export function markActive(tenantId: string, sessionId: string): Promise<boolean> {
  return touchPresence(tenantId, sessionId, presenceWindowMs());
}

export function activeVisitors(tenantId: string): Promise<PresenceResult> {
  return countPresence(tenantId, presenceWindowMs());
}

export type { PresenceResult };
