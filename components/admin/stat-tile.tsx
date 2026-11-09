"use client";

import type { Delta } from "@/lib/analytics/compare";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * One figure, its change, and — only when there is one — a trend verdict with its evidence.
 *
 * Three rules this component exists to keep:
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
 */
export function StatTile({
  label,
  value,
  delta,
  trend,
  hint,
  unmeasured,
}: {
  label: string;
  /** Already formatted — money as money, counts as counts. */
  value: string;
  delta?: Delta;
  trend?: { verdict: string; evidence: string };
  hint?: string;
  /** True when the figure is unknown for part of the range (D48), not zero. */
  unmeasured?: boolean;
}) {
  const t = useT();
  const direction = delta ? Math.sign(delta.absolute) : 0;

  return (
    // `bg-card`, because the page shell is `bg-muted/40` and a panel with no surface of its own
    // shows the grey through it (ADMIN_UI.md §3).
    <div className="grid gap-1 rounded-lg border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {unmeasured ? <span title={t("reports.unmeasured")}>—</span> : value}
      </span>
      {delta && !unmeasured ? (
        <span
          className={cn(
            "text-xs tabular-nums",
            direction > 0 ? "text-emerald-600" : direction < 0 ? "text-amber-600" : "text-muted-foreground",
          )}
        >
          {delta.absolute >= 0 ? "+" : ""}
          {delta.absolute}
          {delta.percent === null
            ? ` ${t("reports.delta.noBase")}`
            : ` (${delta.percent >= 0 ? "+" : ""}${delta.percent.toFixed(1)}%)`}{" "}
          {t("reports.delta.vsPrevious")}
        </span>
      ) : null}
      {trend ? (
        <span className="text-xs text-muted-foreground">
          <strong>{trend.verdict}</strong> — {trend.evidence}
        </span>
      ) : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
