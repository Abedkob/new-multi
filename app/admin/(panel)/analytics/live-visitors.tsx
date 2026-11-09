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
 */
export function LiveVisitors({ presence }: { presence: { available: true; count: number } | { available: false } }) {
  const t = useT();
  return (
    <div className="grid gap-1 rounded-lg border bg-card p-4" data-testid="live-visitors">
      <span className="text-sm text-muted-foreground">{t("reports.live.label")}</span>
      {presence.available ? (
        <span className="text-2xl font-semibold tabular-nums">{presence.count}</span>
      ) : (
        <span className="text-sm text-muted-foreground" data-live="unavailable">
          {t("reports.live.unavailable")}
        </span>
      )}
    </div>
  );
}
