/**
 * IANA time-zone helpers.
 *
 * A store's reporting zone decides where its business day falls, so a wrong value silently
 * misattributes every daily figure rather than failing loudly. Validation here is against the
 * runtime's own ICU data, not a hand-maintained list.
 *
 * Pure: no env, no node built-ins. Usable in client components (Intl is in every browser).
 */

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone this runtime knows, for a <select>. Falls back to a small regional list on a
 * runtime without Intl.supportedValuesOf, so the form still works rather than rendering empty.
 */
export function listTimeZones(): string[] {
  const supported = Intl.supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      // fall through
    }
  }
  return ["Asia/Beirut", "Asia/Dubai", "Europe/London", "Europe/Paris", "UTC"];
}

/** "Asia/Beirut (GMT+3)" — the offset is what an operator actually recognises. */
export function describeTimeZone(zone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value;
    return offset ? `${zone} (${offset})` : zone;
  } catch {
    return zone;
  }
}
