/**
 * Phase 4 verification: the business day, and the aggregates built on it
 * (pnpm verify:aggregates — P4-06 to P4-08, and P4-18 to P4-23 as they arrive).
 *
 * The timezone half of this runs before any aggregate exists, deliberately. A day boundary that
 * is wrong by a few hours produces no error anywhere: the monthly total still adds up, and every
 * daily chart is quietly wrong. So it is proven against a real transition first, and in the
 * zone that actually matters here.
 *
 * Asia/Beirut is this platform's default and it changes clocks AT MIDNIGHT, which makes it the
 * sharpest possible test rather than the easiest:
 *
 *   - 2026-03-29 has no local 00:00 at all. The day begins at 01:00.
 *   - 2026-10-24 has 25 hours, because local 23:00 happens twice.
 *
 * Needs no server. The timezone checks need no database either.
 *   pnpm verify:aggregates
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import {
  endOfLocalDay,
  hoursInLocalDay,
  localDayLengthHours,
  localDayOf,
  localDayRange,
  localDaysBetween,
  localHourOf,
  nextLocalDay,
  previousLocalDay,
  recentLocalDays,
  startOfLocalDay,
} from "../lib/analytics/local-day";
import { prisma } from "../lib/prisma";
import { closeRedis } from "../lib/redis";

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

const BEIRUT = "Asia/Beirut";

function timeZoneChecks() {
  // ------------------------------------------------- P4-06: the store's day, not the UTC day
  // 23:30 in Beirut on 2026-06-15 is 20:30 UTC the same day — easy. The one that matters is
  // 00:30 local, which is still the PREVIOUS day in UTC: an order at half past midnight must
  // not appear in yesterday's figures.
  const lateEvening = new Date("2026-06-15T20:30:00Z"); // 23:30 local
  const afterMidnight = new Date("2026-06-15T21:30:00Z"); // 00:30 local on the 16th
  assert.equal(localDayOf(lateEvening, BEIRUT), "2026-06-15");
  assert.equal(localHourOf(lateEvening, BEIRUT), 23);
  assert.equal(localDayOf(afterMidnight, BEIRUT), "2026-06-16");
  assert.equal(localHourOf(afterMidnight, BEIRUT), 0);
  // The same instant, reported by a store in a different zone, is a different day. This is the
  // whole reason the zone lives on the tenant and not on the viewer.
  assert.equal(localDayOf(afterMidnight, "UTC"), "2026-06-15");
  assert.equal(localDayOf(afterMidnight, "Pacific/Kiritimati"), "2026-06-16");
  ok("P4-06", "23:30 and 00:30 local land on their own local days, whatever UTC says");

  // The range is half-open, so no instant belongs to two days and none belongs to none.
  const day = "2026-06-15";
  const { start, end } = localDayRange(day, BEIRUT);
  assert.equal(localDayOf(start, BEIRUT), day);
  assert.equal(localDayOf(new Date(end.getTime() - 1), BEIRUT), day);
  assert.equal(localDayOf(end, BEIRUT), "2026-06-16", "the end instant belongs to the next day");
  assert.equal(end.getTime() - start.getTime(), 24 * 3_600_000);
  ok("P4-06", "a normal day is a half-open 24-hour range whose end belongs to the next day");

  // ------------------------------------------------------ P4-07: a day that loses an hour
  // Beirut springs forward at midnight, so 2026-03-29 00:00 does not exist. A naive
  // "midnight + 24h" would both invent an instant and run an hour into the next day.
  const springs = "2026-03-29";
  const springStart = startOfLocalDay(springs, BEIRUT);
  assert.equal(localDayOf(springStart, BEIRUT), springs);
  assert.equal(localHourOf(springStart, BEIRUT), 1, "the day begins at 01:00, not at midnight");
  assert.equal(localDayLengthHours(springs, BEIRUT), 23);
  const springHours = hoursInLocalDay(springs, BEIRUT);
  assert.equal(springHours.length, 23);
  assert.ok(!springHours.includes(0), "hour 00 must not appear on a day that has no midnight");
  assert.deepEqual(springHours[0], 1);
  // No instant is lost between the two days, and none is counted twice.
  assert.equal(
    endOfLocalDay(previousLocalDay(springs), BEIRUT).getTime(),
    springStart.getTime(),
    "the previous day must end exactly where this one begins",
  );
  ok("P4-07", `${springs} in Beirut is 23 hours, starts at 01:00 and has no hour 00`);

  // ------------------------------------------------- P4-07: a day that repeats an hour
  const falls = "2026-10-24";
  assert.equal(localDayLengthHours(falls, BEIRUT), 25, "the clocks go back at the next midnight");
  const fallHours = hoursInLocalDay(falls, BEIRUT);
  assert.equal(new Set(fallHours).size, fallHours.length, "an hour label must appear once");
  assert.equal(fallHours.length, 24, "all 24 labels exist; one of them covers two hours");
  // The repeated hour's second pass still belongs to this day, not to the next.
  const secondPass = new Date(endOfLocalDay(falls, BEIRUT).getTime() - 1_800_000);
  assert.equal(localDayOf(secondPass, BEIRUT), falls);
  assert.equal(localHourOf(secondPass, BEIRUT), 23);
  ok("P4-07", `${falls} in Beirut is 25 hours, and the repeated 23:00 still belongs to it`);

  // Boundaries hold at a year end too, where string arithmetic is easiest to get wrong.
  assert.equal(nextLocalDay("2026-12-31"), "2027-01-01");
  assert.equal(previousLocalDay("2026-01-01"), "2025-12-31");
  assert.equal(nextLocalDay("2028-02-28"), "2028-02-29", "2028 is a leap year");
  assert.deepEqual(localDaysBetween("2026-02-27", "2026-03-02"), [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
  ]);
  assert.deepEqual(recentLocalDays(new Date("2026-03-30T10:00:00Z"), BEIRUT, 3), [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ]);
  ok("P4-06", "day arithmetic crosses months, years and a leap day without a zone involved");

  // A zone the runtime does not know must fail loudly rather than silently bucket as UTC.
  assert.throws(() => localDayOf(new Date(), "Mars/Olympus"), /time zone|Invalid/i);
  ok("P4-06", "an unknown zone throws instead of quietly reporting UTC days");
}

async function main() {
  timeZoneChecks();

  // Every store carries a zone already (Phase 1's Tenant.analyticsTimezone); this phase is
  // where it starts deciding anything. A store with a zone the runtime cannot resolve would
  // break its own reports, so the data is checked, not just the code.
  const zones = await prisma.tenant.findMany({
    select: { slug: true, analyticsTimezone: true },
  });
  const broken = zones.filter((t) => {
    try {
      localDayOf(new Date(), t.analyticsTimezone);
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(
    broken.map((t) => `${t.slug}: ${t.analyticsTimezone}`),
    [],
    "these stores have a reporting zone this runtime cannot resolve",
  );
  ok("P4-06", `all ${zones.length} store reporting zone(s) resolve on this runtime`);
}

async function shutdown() {
  await prisma.$disconnect().catch(() => {});
  await closeRedis().catch(() => {});
}

main()
  .then(async () => {
    await shutdown();
    console.log(`\n${checks} checks passed.`);
    process.exit(0);
  })
  .catch(async (error) => {
    await shutdown();
    console.error("\nFAILED:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
