"use client";

import { useT } from "@/lib/i18n/context";

/**
 * What the Overview shows when nothing has been measured at all (§5.9, P5-25).
 *
 * A grid of zeros is the wrong answer here, and it is wrong in a specific, expensive way: it
 * reads as "nobody came to your store". The truth is usually "nothing has been counted yet",
 * which is a different sentence and leads to a different action. So when the period holds no
 * aggregate row whatsoever, the tiles are replaced by this: the two conditions measurement needs,
 * and which of them this store is actually missing.
 *
 * The three are facts about the store, not guesses: the store switched into the rollout by the
 * platform, a visitor who granted analytics consent, and a scheduled update that has actually
 * run. None is something the owner can fake, and only one of them is theirs to fix — so the copy
 * says which.
 *
 * `hasAggregated` was added in Phase 7, after the first two conditions both went green on a real
 * deployment and the report stayed empty anyway. The figures are built from aggregates, and the
 * command that builds them had no entrypoint in the production image — so the panel was naming
 * two satisfied conditions and silently omitting the one that was false. A diagnostic that can
 * be complete and still point the wrong way is worse than no diagnostic.
 */
export function NotMeasuring({
  inRollout,
  hasConsentReceipts,
  hasAggregated,
}: {
  inRollout: boolean;
  hasConsentReceipts: boolean;
  hasAggregated: boolean;
}) {
  const t = useT();
  return (
    <section
      className="grid gap-3 rounded-lg border border-dashed p-6"
      data-testid="not-measuring"
    >
      <h2 className="text-sm font-semibold">{t("reports.notMeasuring.title")}</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("reports.notMeasuring.body")}
      </p>
      <ul className="grid gap-2 text-sm">
        <li>
          <strong>{inRollout ? "✓" : "•"}</strong>{" "}
          {t(inRollout ? "reports.notMeasuring.rolloutOn" : "reports.notMeasuring.rolloutOff")}
        </li>
        <li>
          <strong>{hasConsentReceipts ? "✓" : "•"}</strong>{" "}
          {t(
            hasConsentReceipts
              ? "reports.notMeasuring.consentSeen"
              : "reports.notMeasuring.consentNone",
          )}
        </li>
        <li>
          <strong>{hasAggregated ? "✓" : "•"}</strong>{" "}
          {t(
            hasAggregated
              ? "reports.notMeasuring.aggregatedYes"
              : "reports.notMeasuring.aggregatedNo",
          )}
        </li>
      </ul>
      <p className="max-w-2xl text-xs text-muted-foreground">
        {t("reports.notMeasuring.note")}
      </p>
    </section>
  );
}
