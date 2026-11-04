/**
 * Where a store's day begins and ends (§3.7, D26).
 *
 * Timestamps are stored in UTC and reported in the store's own IANA zone. The viewer's device
 * never redefines the business day: an owner in Beirut checking yesterday's takings from Dubai
 * must see the same day they would see at home, or the number means nothing.
 *
 * This is the quiet one. A day boundary wrong by a few hours is invisible in a monthly total
 * and wrong in every daily chart, with no error anywhere — so everything here is derived from
 * the runtime's own ICU data rather than from arithmetic on offsets, and verified against a
 * real transition (`pnpm verify:aggregates`).
 *
 * Two facts about local days that a naive "midnight plus 24 hours" gets wrong, both of which
 * happen in Asia/Beirut, this platform's default zone, because it changes clocks AT MIDNIGHT:
 *
 *   - **A day can start at 01:00.** On 2026-03-29 local 00:00 simply does not exist: 23:59:59
 *     becomes 01:00:00. The day's first instant is 01:00 local, and `startOfLocalDay` returns
 *     it rather than a time that never happened.
 *   - **A day can be 25 hours long.** On 2026-10-24 the clocks go back at midnight, so local
 *     23:00 happens twice and the day has 25 hours' worth of instants.
 *
 * So a local day is defined here as *the set of instants that a store's clock calls that date*,
 * found from the formatter, not computed from a fixed length.
 *
 * Pure: no database, no env, no node built-ins. `Intl` is everywhere, so this is usable in a
 * client component as well as the job.
 */

/** A calendar date in a store's zone, "YYYY-MM-DD". Not an instant: it has no offset. */
export type LocalDay = string;

const DAY_MS = 86_400_000;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();
/** `${zone}:${day}` → the day's first instant. A job asks for the same few days repeatedly. */
const dayStarts = new Map<string, number>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, f);
  }
  return f;
}

function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = hourFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false });
    hourFormatters.set(timeZone, f);
  }
  return f;
}

/** The date a store's clock showed at this instant. */
export function localDayOf(at: Date, timeZone: string): LocalDay {
  return dayFormatter(timeZone).format(at);
}

/** The hour (0–23) a store's clock showed at this instant. */
export function localHourOf(at: Date, timeZone: string): number {
  // en-GB gives "24" for midnight in some ICU versions; fold it back to 0.
  return Number(hourFormatter(timeZone).format(at).slice(0, 2)) % 24;
}

/**
 * A `LocalDay` as the value stored in an aggregate row's `@db.Date` column, and back.
 *
 * A Postgres `date` has no zone, and the driver hands it back as UTC midnight, so the pair is
 * lossless as long as nobody reads it with a local-time accessor. One pair of functions here,
 * rather than a `new Date(`${day}T00:00:00.000Z`)` literal in every module that queries a
 * range: that literal was already in three places, and the day it is written once with the "Z"
 * missing, every report shifts by the reader's own offset.
 */
export const localDayToDate = (day: LocalDay): Date => new Date(`${day}T00:00:00.000Z`);
export const localDayFromDate = (value: Date): LocalDay => value.toISOString().slice(0, 10);

/** Calendar arithmetic on the date string itself — no zone involved, so no DST to get wrong. */
export function shiftLocalDay(day: LocalDay, days: number): LocalDay {
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return moved.toISOString().slice(0, 10);
}

export const nextLocalDay = (day: LocalDay) => shiftLocalDay(day, 1);
export const previousLocalDay = (day: LocalDay) => shiftLocalDay(day, -1);

/**
 * The first instant that the store's clock calls `day`.
 *
 * Found by bisection rather than by adding an offset, because the answer is "the earliest
 * instant with this local date" and that is true whether or not local midnight exists. The
 * search is over a 52-hour window around UTC midnight, which covers every real-world offset
 * (±14h) plus a transition.
 */
export function startOfLocalDay(day: LocalDay, timeZone: string): Date {
  const key = `${timeZone}:${day}`;
  const cached = dayStarts.get(key);
  if (cached !== undefined) return new Date(cached);

  const [y, m, d] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  let lo = utcMidnight - 26 * 3_600_000;
  let hi = utcMidnight + 26 * 3_600_000;

  // Invariant: lo is before the day, hi is in it or after. localDayOf is monotonic in time and
  // the strings compare lexicographically, so this converges on the boundary to the millisecond.
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDayOf(new Date(mid), timeZone) < day) lo = mid;
    else hi = mid;
  }
  if (localDayOf(new Date(hi), timeZone) !== day) {
    throw new Error(`${day} does not exist in ${timeZone}`);
  }
  dayStarts.set(key, hi);
  return new Date(hi);
}

/** Exclusive end: the first instant of the next local day. */
export function endOfLocalDay(day: LocalDay, timeZone: string): Date {
  return startOfLocalDay(nextLocalDay(day), timeZone);
}

/**
 * The half-open [start, end) range of instants belonging to a local day.
 *
 * Half-open on purpose: an aggregate that filters `occurredAt >= start AND occurredAt < end`
 * can never double-count the boundary millisecond, which an inclusive end would do on exactly
 * one event per day — the kind of error that is invisible until someone reconciles.
 */
export function localDayRange(day: LocalDay, timeZone: string): { start: Date; end: Date } {
  return { start: startOfLocalDay(day, timeZone), end: endOfLocalDay(day, timeZone) };
}

/** How long a local day actually is. 23, 24 or 25 hours, depending on the clocks. */
export function localDayLengthHours(day: LocalDay, timeZone: string): number {
  const { start, end } = localDayRange(day, timeZone);
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/**
 * The clock hours that exist on this local day, in order.
 *
 * Not `0..23`: a spring-forward day is missing an hour, and a fall-back day has one twice (it
 * appears once here, because an hourly bucket is a label, not a duration). Callers that want a
 * row per hour must use this rather than assuming 24, or a chart grows a phantom empty hour
 * twice a year and loses a real one.
 */
export function hoursInLocalDay(day: LocalDay, timeZone: string): number[] {
  const { start, end } = localDayRange(day, timeZone);
  const hours: number[] = [];
  // Walk on the half hour, so a sample always lands inside an hour rather than on its edge.
  for (let t = start.getTime() + 1_800_000; t < end.getTime(); t += 3_600_000) {
    const hour = localHourOf(new Date(t), timeZone);
    if (!hours.includes(hour)) hours.push(hour);
  }
  return hours;
}

/** Local days from `from` to `to` inclusive, oldest first. */
export function localDaysBetween(from: LocalDay, to: LocalDay): LocalDay[] {
  const days: LocalDay[] = [];
  for (let day = from; day <= to; day = nextLocalDay(day)) days.push(day);
  return days;
}

/** The `count` most recent local days as of `at`, oldest first — a recompute window. */
export function recentLocalDays(at: Date, timeZone: string, count: number): LocalDay[] {
  const today = localDayOf(at, timeZone);
  return localDaysBetween(shiftLocalDay(today, -(count - 1)), today);
}
