/**
 * The joint-controller arrangement between the platform and each merchant (§4.1).
 *
 * The arrangement itself lives in the merchant subscription agreement; what is recorded per
 * store is which version was in force, when it was recorded, and which platform operator
 * recorded it. That trio is the audit trail, and it is why the version is a constant here rather
 * than something an operator types: a free-text version would make the records unusable the
 * first time someone typed "v2" instead of "2026-11".
 *
 * Bump JOINT_CONTROLLER_VERSION when the arrangement's terms change. Existing stores keep the
 * version they agreed to, so it stays visible which stores are on which terms.
 *
 * Pure: no env, no node built-ins. Safe in client components.
 */

export const JOINT_CONTROLLER_VERSION = "2026-11";

/** Shown next to the confirmation checkbox when a store is created. */
export const JOINT_CONTROLLER_SUMMARY =
  "The platform defines and operates the measurement system; the merchant receives and acts on " +
  "their own store's analytics. The platform is the primary coordinator for visitor privacy " +
  "requests, and visitors may exercise their rights against either party.";
