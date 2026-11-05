"use client";

import Link from "next/link";
import { REPORT_PERIODS } from "@/lib/analytics/range";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * The period selector every report screen uses.
 *
 * Real links with a `?period=` query, not buttons holding state: a period is part of what the
 * owner is looking at, so it belongs in the URL, where it survives a reload, can be sent to
 * someone else, and lets the server fetch exactly one range instead of three.
 *
 * `basePath` is passed in rather than read from `usePathname` so the component can be mounted
 * beside a table whose page owns the route — and so the period never silently jumps tabs.
 */
export function PeriodPicker({
  basePath,
  current,
  ariaLabel,
}: {
  basePath: string;
  current: string;
  ariaLabel: string;
}) {
  const t = useT();
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {REPORT_PERIODS.map((period) => {
        const active = period.id === current;
        return (
          <Link
            key={period.id}
            href={`${basePath}?period=${period.id}`}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            {t(period.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
