import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a short date. */
export function timeAgo(date: Date, t: (key: DictionaryKey) => string, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${t("time.minAgo")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${t("time.hAgo")}`;
  const d = Math.round(h / 24);
  if (d === 1) return t("time.yesterday");
  if (d < 7) return `${d} ${t("time.daysAgo")}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
