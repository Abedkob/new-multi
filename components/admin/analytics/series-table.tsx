"use client";

import { useT } from "@/lib/i18n/context";

/**
 * The daily series, as a table with a bar in each row.
 *
 * A table first, with the bar drawn inside it, rather than a chart with a table hidden behind a
 * toggle (§5.9). The bar is a `div` whose width is a percentage of the largest value and which
 * is `aria-hidden`: the number beside it is the content, and a screen reader that announced
 * "62 percent width" would be reading the decoration.
 *
 * A day with no row at all is a zero and is shown (P5-04): a series that skips quiet days turns
 * a store that was open and empty into a store that was closed, and the two mean different
 * things to the person deciding whether to post today.
 */
export function SeriesTable({
  points,
  label,
}: {
  points: { day: string; sessions: number; orders: number }[];
  label: string;
}) {
  const t = useT();
  const peak = Math.max(1, ...points.map((p) => p.sessions));

  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left text-sm text-muted-foreground">{label}</caption>
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="py-1 text-start font-medium">
            {t("reports.series.day")}
          </th>
          <th scope="col" className="py-1 text-end font-medium">
            {t("reports.series.sessions")}
          </th>
          <th scope="col" className="py-1 text-end font-medium">
            {t("reports.series.orders")}
          </th>
          <th scope="col" aria-hidden="true" className="w-1/2" />
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.day} className="border-t">
            <th scope="row" className="py-1 text-start font-normal tabular-nums">
              {point.day}
            </th>
            <td className="py-1 text-end tabular-nums">{point.sessions}</td>
            <td className="py-1 text-end tabular-nums">{point.orders}</td>
            <td className="py-1 ps-3" aria-hidden="true">
              <div
                className="h-2 rounded-sm bg-primary/30"
                style={{ width: `${(point.sessions / peak) * 100}%` }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
