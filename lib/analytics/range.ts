/**
 * The period every report screen reads from the URL, in one place.
 *
 * Pure, so a client component can label a period without a round trip. Two reasons it is shared
 * rather than written per page:
 *
 *   1. **One set of periods.** A store whose Marketing tab offers 28 days and whose Acquisition
 *      tab offers 30 gives two different answers to the same question, and the owner has no way
 *      to see why.
 *   2. **The range is always store-local.** `lastNLocalDays` counts days in the store's own zone,
 *      so "last 7 days" is 7 local days even across a 23- or 25-hour one (D45). A page that
 *      built its own range from `Date` arithmetic would be off by an hour twice a year, in a way
 *      nothing on screen could reveal.
 *
 * An unknown or missing `?period=` falls back to the default rather than erroring: a URL is
 * something people edit and share.
 */

import { lastNLocalDays, type DayRange } from "@/lib/analytics/compare";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";

export const REPORT_PERIODS = [
  { id: "7", days: 7, labelKey: "period.7" },
  { id: "28", days: 28, labelKey: "period.28" },
  { id: "90", days: 90, labelKey: "period.90" },
] as const satisfies readonly { id: string; days: number; labelKey: DictionaryKey }[];

export type ReportPeriodId = (typeof REPORT_PERIODS)[number]["id"];

export const DEFAULT_PERIOD: ReportPeriodId = "28";

export function periodOf(value: string | undefined): (typeof REPORT_PERIODS)[number] {
  return REPORT_PERIODS.find((p) => p.id === value) ?? REPORT_PERIODS.find((p) => p.id === DEFAULT_PERIOD)!;
}

/** The store-local range a `?period=` names, ending today in the store's own zone. */
export function rangeFromPeriod(
  value: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): { range: DayRange; period: ReportPeriodId } {
  const period = periodOf(value);
  return { range: lastNLocalDays(period.days, now, timeZone), period: period.id };
}
