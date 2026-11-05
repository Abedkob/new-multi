"use client";

import type { HeatmapCell, HeatmapMeasure } from "@/lib/analytics/report";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

const WEEKDAY_KEYS: DictionaryKey[] = [
  "weekday.0",
  "weekday.1",
  "weekday.2",
  "weekday.3",
  "weekday.4",
  "weekday.5",
  "weekday.6",
];

/**
 * Weekday × hour, as a real table.
 *
 * A `<table>` rather than a grid of divs, because that is what this is: each cell has a row
 * header (the day) and a column header (the hour), and a screen reader announces both. The
 * shading is a background colour on a cell whose text is the number itself — not a colour
 * standing in for a number, which is the version of this chart nobody can read (§5.9).
 *
 * Only the hours that exist in the data get columns. A store that is never open at 4am has no
 * 4am column, rather than 7 zeros that imply a measurement was taken and came back empty.
 */
export function HeatmapGrid({
  cells,
  measure,
  timeZone,
}: {
  cells: HeatmapCell[];
  measure: HeatmapMeasure;
  timeZone: string;
}) {
  const t = useT();

  if (cells.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("heatmap.empty")}
      </p>
    );
  }

  const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
  const weekdays = [...new Set(cells.map((c) => c.weekday))].sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c.value]));
  const peak = Math.max(...cells.map((c) => c.value), 1);
  const show = (value: number) =>
    measure === "orderValueCents" ? formatPrice(value) : String(value);

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="pb-2 text-start text-sm text-muted-foreground">
            {t("heatmap.caption").replace("{0}", timeZone)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-1 text-start font-medium text-muted-foreground">
                {t("heatmap.table.day")}
              </th>
              {hours.map((hour) => (
                <th key={hour} scope="col" className="p-1 text-center font-medium text-muted-foreground">
                  {String(hour).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdays.map((weekday) => (
              <tr key={weekday}>
                <th scope="row" className="p-1 text-start font-normal">
                  {t(WEEKDAY_KEYS[weekday])}
                </th>
                {hours.map((hour) => {
                  const value = byKey.get(`${weekday}:${hour}`);
                  return (
                    <td
                      key={hour}
                      className="p-1 text-center tabular-nums"
                      // An hour that was never recorded is blank, not 0.
                      style={
                        value === undefined
                          ? undefined
                          : { backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round((value / peak) * 60)}%, transparent)` }
                      }
                    >
                      {value === undefined ? "" : show(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("heatmap.note")}</p>
    </div>
  );
}
