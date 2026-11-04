/**
 * Process-local ingestion counters (§11.10).
 *
 * Phase 6 alerts when "at least 20 attempted batches and over 5% operational drops within ten
 * minutes". That threshold needs a numerator and a denominator, and they have to be counted at
 * the moment work is turned away — afterwards there is nothing left to count, because a dropped
 * batch leaves no row anywhere by design.
 *
 * So the counting happens here, in memory, and Phase 4's scheduled command flushes a snapshot
 * into AnalyticsOperationalMetric. Deliberately not written to the database per request: the
 * whole point of dropping a batch is to do less work, and a drop that costs an INSERT is not a
 * drop.
 *
 * The distinction that matters is POLICY versus OPERATIONAL:
 *
 *   - Policy drops are the system working. A visitor refused analytics; a store is outside the
 *     rollout; a token expired. Alerting on these would page someone because consent is being
 *     honoured.
 *   - Operational drops are the system struggling. The pool was full, the database timed out,
 *     a limiter bit. These are what the health alert is for.
 *
 * Counters are monotonic until a snapshot resets them, and are per process — with several
 * instances each reports its own, which is what the aggregate in Phase 4 expects.
 */

export const POLICY_DROPS = [
  "no-consent",
  "out-of-rollout",
  "bad-token",
  "unknown-tenant",
] as const;

export const OPERATIONAL_DROPS = [
  "rate-limit-visitor",
  "rate-limit-ip",
  "rate-limit-tenant",
  "rate-limit-new-visitor",
  "concurrency",
  "database",
] as const;

export type PolicyDrop = (typeof POLICY_DROPS)[number];
export type OperationalDrop = (typeof OPERATIONAL_DROPS)[number];
export type DropReason = PolicyDrop | OperationalDrop;

const zeroed = <T extends readonly string[]>(keys: T) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T[number], number>;

type Counters = {
  since: number;
  /** Every batch that reached the endpoint and parsed, policy drops included. */
  attemptedBatches: number;
  acceptedBatches: number;
  storedEvents: number;
  /** Events discarded because their product or variant is not this store's. */
  rejectedOwnershipEvents: number;
  /** Envelopes that failed validation outright — a client bug, answered with 400. */
  invalidEnvelopes: number;
  policy: Record<PolicyDrop, number>;
  operational: Record<OperationalDrop, number>;
};

const fresh = (): Counters => ({
  since: Date.now(),
  attemptedBatches: 0,
  acceptedBatches: 0,
  storedEvents: 0,
  rejectedOwnershipEvents: 0,
  invalidEnvelopes: 0,
  policy: zeroed(POLICY_DROPS),
  operational: zeroed(OPERATIONAL_DROPS),
});

// Survives hot reloads in development, so a dev session's numbers stay comparable.
const globalForHealth = globalThis as unknown as { analyticsHealth?: Counters };
const counters: Counters = (globalForHealth.analyticsHealth ??= fresh());

export const recordAttempt = () => {
  counters.attemptedBatches += 1;
};

export const recordInvalidEnvelope = () => {
  counters.invalidEnvelopes += 1;
};

export function recordAccepted(storedEvents: number, rejectedOwnershipEvents = 0) {
  counters.acceptedBatches += 1;
  counters.storedEvents += storedEvents;
  counters.rejectedOwnershipEvents += rejectedOwnershipEvents;
}

export function recordDrop(reason: DropReason) {
  if ((POLICY_DROPS as readonly string[]).includes(reason)) {
    counters.policy[reason as PolicyDrop] += 1;
  } else {
    counters.operational[reason as OperationalDrop] += 1;
  }
}

export type AnalyticsHealth = Counters & {
  windowMs: number;
  operationalDrops: number;
  policyDrops: number;
  /** The figure §11.10's threshold is written against. */
  operationalDropPercent: number;
};

/** A point-in-time view. Pass `reset` from the scheduled flush so windows do not overlap. */
export function snapshotAnalyticsHealth(reset = false): AnalyticsHealth {
  const operationalDrops = Object.values(counters.operational).reduce((a, b) => a + b, 0);
  const policyDrops = Object.values(counters.policy).reduce((a, b) => a + b, 0);
  const snapshot: AnalyticsHealth = {
    ...counters,
    policy: { ...counters.policy },
    operational: { ...counters.operational },
    windowMs: Date.now() - counters.since,
    operationalDrops,
    policyDrops,
    operationalDropPercent:
      counters.attemptedBatches === 0
        ? 0
        : (operationalDrops / counters.attemptedBatches) * 100,
  };
  if (reset) Object.assign(counters, fresh());
  return snapshot;
}
