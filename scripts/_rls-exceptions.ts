/**
 * Tables that carry a tenantId and are deliberately NOT under Row-Level Security, each with the
 * reason. Anything else with a tenantId must be protected, and a new one shows up as a failure
 * rather than as silence.
 *
 * One declaration because two checks ask the same question and must not answer it differently:
 * `verify:aggregates`' P4-23a reads it against the live schema, and `drill:restore` reads it
 * against a restored copy. The drill was written with the rule hard-coded and immediately
 * reported `AnalyticsAuditLog` as a restore failure — a correct rule, a wrong exception list,
 * and exactly the kind of disagreement that teaches people to ignore a red line.
 */
export const DELIBERATELY_OPEN: Record<string, string> = {
  // An audit record ABOUT a store is not data belonging to it: a store owner must not be able
  // to read or alter it, and it outlives the store (nullable tenantId, ON DELETE SET NULL).
  AnalyticsAuditLog: "platform evidence about a store, not the store's data",
};
