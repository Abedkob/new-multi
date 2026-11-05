"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

/**
 * When these figures were last recomputed (§5.9, P5-28).
 *
 * Aggregation runs on a schedule, so a report is always a little behind, and the honest thing is
 * to say how far rather than to present the numbers as "now". Two states matter:
 *
 *   - **never computed**: the store has no aggregate row in this period at all. That is not
 *     "zero visits" — it is "nothing has been counted yet", and a merchant reading zeros as fact
 *     would conclude their store is dead when measurement simply has not run.
 *   - **computed, and how long ago**: shown in hours once it is more than one, because a figure
 *     from yesterday being presented as today's is the failure this line exists to prevent.
 *
 * The age is computed in the browser from an ISO string rather than rendered on the server:
 * server-rendered "4 minutes ago" is stale the moment it is cached, and this is the one line on
 * the page whose whole job is to be current. It is computed in an effect rather than during
 * render because reading the clock while rendering is not a pure render — and it means the first
 * paint shows the timestamp itself, which is the honest fallback if the effect never runs.
 */
export function FreshnessNote({ lastComputedAt }: { lastComputedAt: string | null }) {
  const t = useT();
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!lastComputedAt) return;
    const tick = () =>
      setMinutes(Math.max(0, Math.round((Date.now() - new Date(lastComputedAt).getTime()) / 60_000)));
    tick();
    // A merchant leaves this page open; an age that stops updating starts lying within the hour.
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [lastComputedAt]);

  if (!lastComputedAt) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="freshness-none">
        {t("reports.freshness.never")}
      </p>
    );
  }

  const text =
    minutes === null
      ? new Date(lastComputedAt).toISOString().replace("T", " ").slice(0, 16)
      : minutes < 60
        ? t("reports.freshness.minutes").replace("{0}", String(minutes))
        : t("reports.freshness.hours").replace("{0}", String(Math.floor(minutes / 60)));

  return (
    <p className="text-xs text-muted-foreground" data-testid="freshness">
      {text}
    </p>
  );
}
