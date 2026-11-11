"use client";

import type { Delta } from "@/lib/analytics/compare";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * A row of figures as one object, divided by hairlines — not N panels in a grid.
 *
 * The analytics overview was twelve bordered cards, the dashboard five, and a figure is the one
 * thing on these screens that does not need a box: it is already the loudest mark on the line.
 * Twelve boxes made twelve equal objects out of what is really one reading, and left the odd one
 * out stranded on a second row beside three empty columns.
 *
 * The hairlines are drawn by each cell and then clipped, rather than by a `gap-px` grid over a
 * coloured ground. The ground version is the obvious one and it is wrong here: a group whose
 * items do not fill the last row — the traffic row is four figures plus the live-visitor panel,
 * five across four columns — leaves empty cells showing the ground as three grey blocks.
 *
 * So every cell carries `border-t border-s`, and the grid is pulled back a pixel at the top and
 * the start so the outermost of those land under the wrapper's own border and disappear. Row 1's
 * top rules and column 1's start rules are clipped; every interior rule stays. It is correct at
 * any column count, for any number of items, with empty cells drawing nothing — and it is
 * correct in RTL with no direction class, because `border-s` and `-ms-px` are both logical.
 */
export function StatGroup({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  /** The widest the row ever gets. Below `sm` it is always one column. */
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <div
        className={cn(
          "-ms-px -mt-px grid [&>*]:border-s [&>*]:border-t",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
          columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One figure, its change, and — only when there is one — a trend verdict with its evidence.
 *
 * Four rules this component exists to keep:
 *
 *   1. **The number is exact.** 3 sessions reads "3" (P5-02). Nothing here rounds, abbreviates
 *      or hides a small number, because a merchant with three sessions is the reader most
 *      likely to be making a decision from this screen.
 *   2. **A percentage with no denominator is not shown.** `delta.percent` is null when the
 *      previous period was zero, and "+100%" for a store's first order is the kind of figure
 *      someone repeats to a partner. The absolute change is shown instead.
 *   3. **A verdict never travels without its evidence.** `trend` is passed as a verdict plus the
 *      sentence that produced it (P5-09); a tile given a verdict and no evidence renders the
 *      verdict only if the caller also hands over the sentence, because the prop is one object.
 *   4. **Colour is a verdict too** — which is the rule the first version broke. With no earlier
 *      period it rendered a green "+2" directly above the words "no earlier figure to compare
 *      with": green says the shop is up, the sentence says there is nothing to be up against,
 *      and a merchant reads the colour. Walking the screens found it exactly as the stock count
 *      was found saying "agrees" and "enter a whole number" at once. With no base the change is
 *      still shown — it is a real number of orders — in muted, with no direction claimed, and
 *      without the trailing "vs the period before", which names a comparison that did not
 *      happen.
 */
export function StatTile({
  label,
  value,
  delta,
  trend,
  hint,
  unmeasured,
  className,
}: {
  label: string;
  /** Already formatted — money as money, counts as counts. */
  value: string;
  delta?: Delta;
  trend?: { verdict: string; evidence: string };
  hint?: string;
  /** True when the figure is unknown for part of the range (D48), not zero. */
  unmeasured?: boolean;
  className?: string;
}) {
  const t = useT();
  // No earlier period means no direction to claim, whatever the sign of the absolute change.
  const comparable = delta ? delta.percent !== null : false;
  const direction = delta && comparable ? Math.sign(delta.absolute) : 0;

  return (
    <div className={cn("flex flex-col gap-1 bg-card p-4", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
        {unmeasured ? <span title={t("reports.unmeasured")}>—</span> : value}
      </span>
      {delta && !unmeasured ? (
        <span
          className={cn(
            "text-xs tabular-nums",
            direction > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : direction < 0
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          {delta.absolute >= 0 ? "+" : ""}
          {delta.absolute}
          {comparable
            ? ` (${delta.percent! >= 0 ? "+" : ""}${delta.percent!.toFixed(1)}%) ${t("reports.delta.vsPrevious")}`
            : ` ${t("reports.delta.noBase")}`}
        </span>
      ) : null}
      {trend ? (
        <span className="text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">{trend.verdict}</strong> — {trend.evidence}
        </span>
      ) : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
