"use client";

import { useT } from "@/lib/i18n/context";

/**
 * How to get notifications on an iPhone or iPad (§11.2, P6-18).
 *
 * This is not a nicety. On iOS, Web Push exists **only** for a web app added to the Home Screen:
 * in Safari itself the subscribe call fails, and without these five steps an owner taps "Enable
 * notifications", sees an error, and concludes the feature is broken. Android and desktop need
 * none of it, which is exactly why it would be forgotten by whoever is testing on a laptop.
 *
 * Always visible rather than shown only to iOS user agents: a merchant setting up on their
 * laptop for a phone in their pocket needs to be able to read it there.
 */
export function IphoneGuide() {
  const t = useT();
  const steps = [
    "notifications.iphone.step1",
    "notifications.iphone.step2",
    "notifications.iphone.step3",
    "notifications.iphone.step4",
    "notifications.iphone.step5",
  ] as const;

  return (
    <section className="grid gap-2 rounded-lg border p-4" data-testid="iphone-guide">
      <h2 className="text-sm font-semibold">{t("notifications.iphone.heading")}</h2>
      <p className="text-sm text-muted-foreground">{t("notifications.iphone.why")}</p>
      <ol className="ms-4 grid list-decimal gap-1 text-sm">
        {steps.map((step) => (
          <li key={step}>{t(step)}</li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{t("notifications.iphone.note")}</p>
    </section>
  );
}
