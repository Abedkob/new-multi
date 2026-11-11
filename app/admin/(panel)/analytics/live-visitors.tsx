"use client";

import { useT } from "@/lib/i18n/context";

/**
 * Visitors active right now — or the sentence that replaces the number (§5.9, P5-27).
 *
 * Presence lives in Redis, and Redis is allowed to be down: the rate limiter fails open and the
 * storefront keeps selling (P2-27). What must not happen is this tile reading **0**. Zero active
 * visitors is a claim about the store; an unreachable Redis is a fact about the platform, and
 * the merchant who sees "0" at the moment their Instagram post lands will believe the first one.
 *
 * So `available: false` renders as "temporarily unavailable" and never as a figure.
 *
 * It sits inside a `StatGroup` beside the other traffic figures and so draws no box of its own —
 * the group owns the border and the dividing rules. It is still not `StatTile`: that component's
 * value is a `string` and the whole point here is a state where there IS no figure, which a
 * caller could only express by passing a sentence as the value and getting it typeset at
 * `text-2xl`. ADMIN_UI.md records folding the two together as an open question; what it needs is
 * `StatTile` gaining this state and `verify:report-states` re-run, not a sentence in a slot
 * built for a number.
 */
export function LiveVisitors({ presence }: { presence: { available: true; count: number } | { available: false } }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 bg-card p-4" data-testid="live-visitors">
      <span className="text-xs font-medium text-muted-foreground">{t("reports.live.label")}</span>
      {presence.available ? (
        <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
          {presence.count}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground" data-live="unavailable">
          {t("reports.live.unavailable")}
        </span>
      )}
    </div>
  );
}
