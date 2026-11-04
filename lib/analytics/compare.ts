/**
 * Period-over-period arithmetic, and the rules that stop a comparison from misleading someone
 * (D42, D43, D45).
 *
 * Pure: no database, no env, no Node built-ins. Every threshold in here is a named number with
 * the reason beside it, so a product decision about what counts as "growing" is made in one
 * place and can be argued with — rather than being spread across the screens that act on it.
 *
 * The rule the rest of this module exists to serve: a comparison either carries enough evidence
 * to mean something, or it says so. There is no weaker version of a verdict. A merchant who
 * reorders stock because a nine-session week was "up 50%" loses real money, and the apology
 * costs more than the chart earned.
 */
import {
  localDayOf,
  localDaysBetween,
  shiftLocalDay,
  type LocalDay,
} from "@/lib/analytics/local-day";

/** An inclusive range of store-local days. Not instants: see local-day.ts. */
export type DayRange = { from: LocalDay; to: LocalDay; timeZone: string };

/** How many local days the range covers, inclusive of both ends. */
export function rangeLength(range: DayRange): number {
  return localDaysBetween(range.from, range.to).length;
}

export function daysIn(range: DayRange): LocalDay[] {
  return localDaysBetween(range.from, range.to);
}

/**
 * "Last N days" as N store-local days ending today — today included, because a merchant looking
 * at "last 7 days" at noon means up to now, not up to last midnight.
 *
 * Counted in days rather than in hours on purpose (D45): this platform's default zone changes
 * clocks at midnight, so "168 hours ago" lands at 01:00 or 23:00 twice a year and quietly
 * shifts the whole window by an hour.
 */
export function lastNLocalDays(days: number, at: Date, timeZone: string): DayRange {
  if (!Number.isInteger(days) || days < 1) throw new Error(`days must be >= 1, got ${days}`);
  const today = localDayOf(at, timeZone);
  return { from: shiftLocalDay(today, -(days - 1)), to: today, timeZone };
}

/**
 * The same number of days immediately before a range, for the comparison column.
 *
 * Day counts, again, not durations: the period before a 7-day window that contained a 25-hour
 * day is still 7 days, and the two windows are legitimately different lengths in hours. Any
 * other definition makes the previous period overlap the current one or skip a day.
 */
export function previousPeriod(range: DayRange): DayRange {
  const length = rangeLength(range);
  const to = shiftLocalDay(range.from, -1);
  return { from: shiftLocalDay(to, -(length - 1)), to, timeZone: range.timeZone };
}

export type Delta = {
  current: number;
  previous: number;
  absolute: number;
  /**
   * Null when there is nothing to divide by. Growth from zero is not a percentage, and showing
   * "+100%" or "+∞" for the first order a store ever took is the kind of number a merchant
   * repeats to someone else.
   */
  percent: number | null;
};

export function delta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    absolute: current - previous,
    percent: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

/**
 * A rate, or null. Never 0 for "nothing happened yet": a conversion rate of 0% claims that
 * visitors came and none bought, which is a different fact from having had no visitors.
 */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** The per-unit average of a money total, or null when there is nothing to average. */
export function averageCents(totalCents: number, count: number): number | null {
  return count === 0 ? null : Math.round(totalCents / count);
}

export type TrendVerdict = "growing" | "declining" | "steady" | "insufficient";

/**
 * What a trend judgment requires, as data (D42).
 *
 * `minPercent` and `minAbsolute` must BOTH be met: 20% of 5 sessions is one session, and a
 * one-session week is noise wearing a percentage. `minSample` is the floor below which no
 * verdict is offered at all — §5.8's "very small stores keep their real numbers but receive
 * 'Not enough activity for a reliable trend'" — and it is counted **across both periods**,
 * which is how §6 words its own "20 sessions across the comparison".
 *
 * The session numbers are §6's, not §5.8's, on purpose. §5.8 is about ranking stores against
 * each other in the platform console; §6 is the threshold at which a merchant is told something
 * about their own store. Using two different floors would let one screen call a week a trend
 * while the tile beside it says there is not enough evidence.
 */
export type TrendRule = { minPercent: number; minAbsolute: number; minSample: number };

export const TREND_RULES = {
  /** §6's "meaningful activity shift": 20 sessions across the comparison. */
  sessions: { minPercent: 20, minAbsolute: 10, minSample: 20 },
  /** Orders are rarer than sessions, so the absolute bar is lower — but it is not zero. */
  orders: { minPercent: 20, minAbsolute: 3, minSample: 10 },
  /** WhatsApp clicks are intent, counted like orders and never valued like them (§3.4). */
  whatsappClicks: { minPercent: 20, minAbsolute: 5, minSample: 15 },
} as const satisfies Record<string, TrendRule>;

export type TrendReading = {
  verdict: TrendVerdict;
  delta: Delta;
  rule: TrendRule;
  /** The sentence a screen prints beside the verdict, so the reader can judge it themselves. */
  evidence: string;
};

/**
 * A verdict, with the evidence that produced it attached — never a verdict on its own.
 *
 * `label` names what is being counted ("sessions") and goes into the evidence sentence, so the
 * caller cannot show a trend without also being able to say what it is a trend of.
 */
export function trend(
  current: number,
  previous: number,
  rule: TrendRule,
  label: string,
): TrendReading {
  const d = delta(current, previous);
  // Across both periods, not the larger of them: a week of 15 against a week of 14 is 29
  // observations of a steady store, and refusing to judge it would be as unhelpful as judging
  // 15 against 0 confidently.
  const sample = current + previous;
  if (sample < rule.minSample) {
    return {
      verdict: "insufficient",
      delta: d,
      rule,
      evidence: `${sample} ${label} across the two periods, below the ${rule.minSample} needed for a reliable trend`,
    };
  }
  const movedEnough =
    Math.abs(d.absolute) >= rule.minAbsolute &&
    d.percent !== null &&
    Math.abs(d.percent) >= rule.minPercent;
  const verdict: TrendVerdict = !movedEnough
    ? "steady"
    : d.absolute > 0
      ? "growing"
      : "declining";
  const change =
    d.percent === null
      ? `${d.absolute >= 0 ? "+" : ""}${d.absolute}`
      : `${d.absolute >= 0 ? "+" : ""}${d.absolute} (${d.percent >= 0 ? "+" : ""}${d.percent.toFixed(0)}%)`;
  return {
    verdict,
    delta: d,
    rule,
    evidence: `${current} ${label} against ${previous} in the period before: ${change}`,
  };
}

/** §5.8: a store counts as active if anything at all happened in the period. */
export function hasActivity(totals: {
  sessions: number;
  orders: number;
  whatsappClickSessions: number;
}): boolean {
  return totals.sessions > 0 || totals.orders > 0 || totals.whatsappClickSessions > 0;
}
