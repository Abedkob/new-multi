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
 * `inRollout` and `hasConsentReceipts` are facts about the store, not guesses. Measurement needs
 * both: the store switched into the rollout by the platform, and a visitor who granted analytics
 * consent. Neither is something the owner can fake, and only one of them is theirs to fix — so
 * the copy says which.
 */
export function NotMeasuring({
  inRollout,
  hasConsentReceipts,
}: {
  inRollout: boolean;
  hasConsentReceipts: boolean;
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
      </ul>
      <p className="max-w-2xl text-xs text-muted-foreground">
        {t("reports.notMeasuring.note")}
      </p>
    </section>
  );
}
