import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import type { Locale } from "@/lib/i18n/types";

/**
 * Dates, in the reader's language and the store's day.
 *
 * `Date.toLocaleString()` with no arguments uses the **server process's** locale, not the reader's
 * — so an Arabic dashboard rendered "11/11/2026, 5:27:44 AM", a US date with a latin AM, inside a
 * right-to-left table. Four till screens and the stock history did exactly that, and `timeAgo`
 * itself leaked `en-US` past seven days, so even its callers were only right for a week.
 *
 * `timeZone` is the store's own (`Tenant.analyticsTimezone`), for the reason the till's "taken
 * today" figure uses it: a Beirut shop on a UTC server would otherwise read a sale made at 01:00
 * as the previous evening. Optional, because not every caller has the tenant to hand, and the
 * locale is worth fixing on its own.
 */
const intl = (locale: Locale) => (locale === "ar" ? "ar" : "en-US");

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a short date. */
export function timeAgo(
  date: Date,
  t: (key: DictionaryKey) => string,
  now = new Date(),
  locale: Locale = "en",
): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${t("time.minAgo")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${t("time.hAgo")}`;
  const d = Math.round(h / 24);
  if (d === 1) return t("time.yesterday");
  if (d < 7) return `${d} ${t("time.daysAgo")}`;
  return new Intl.DateTimeFormat(intl(locale), { month: "short", day: "numeric" }).format(date);
}

/**
 * An exact date and time, for a record rather than a feed.
 *
 * A receipt and a ledger row need the moment, not "3 days ago": somebody is matching them against
 * a delivery note or a card terminal.
 */
export function formatDateTime(date: Date, locale: Locale, timeZone?: string): string {
  return new Intl.DateTimeFormat(intl(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
