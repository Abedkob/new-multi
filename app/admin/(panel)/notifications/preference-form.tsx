"use client";

import { useState, useTransition } from "react";
import { saveOwnerPreferencesAction } from "./actions";
import type { OwnerPreferences } from "@/lib/data/notification-preferences";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { useT } from "@/lib/i18n/context";

/**
 * What to be told about (§11.2), and the one setting that changes what leaves the building.
 *
 * The amount toggle is deliberately separated from the six type switches, under its own heading
 * and with its own warning. It is not "another kind of notification" — it changes what is
 * written on a lock screen that anyone nearby can read (D50), and presenting it as the seventh
 * item in a list of feature switches would be the quiet way to get it turned on.
 */

const TYPE_ROWS: { key: keyof OwnerPreferences; label: DictionaryKey; hint: DictionaryKey }[] = [
  { key: "newOrders", label: "notifications.type.newOrders", hint: "notifications.type.newOrders.hint" },
  { key: "weeklySummary", label: "notifications.type.weeklySummary", hint: "notifications.type.weeklySummary.hint" },
  { key: "productAlerts", label: "notifications.type.productAlerts", hint: "notifications.type.productAlerts.hint" },
  { key: "funnelAlerts", label: "notifications.type.funnelAlerts", hint: "notifications.type.funnelAlerts.hint" },
  { key: "searchAlerts", label: "notifications.type.searchAlerts", hint: "notifications.type.searchAlerts.hint" },
  { key: "trafficAlerts", label: "notifications.type.trafficAlerts", hint: "notifications.type.trafficAlerts.hint" },
];

export function PreferenceForm({ initial }: { initial: OwnerPreferences }) {
  const t = useT();
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof OwnerPreferences) => {
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    setSaved(false);
    // Saved immediately, like the section switches in the content editor: a settings page with a
    // Save button is a settings page people leave without pressing it.
    startTransition(async () => {
      await saveOwnerPreferencesAction(next);
      setSaved(true);
    });
  };

  return (
    <section className="grid gap-4 rounded-lg border p-4" data-testid="notification-types">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{t("notifications.types.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("notifications.types.description")}</p>
      </div>

      <ul className="grid gap-3">
        {TYPE_ROWS.map((row) => (
          <li key={row.key} className="flex items-start justify-between gap-4">
            <label className="grid gap-0.5 text-sm" htmlFor={`pref-${row.key}`}>
              <span className="font-medium">{t(row.label)}</span>
              <span className="text-xs text-muted-foreground">{t(row.hint)}</span>
            </label>
            <input
              id={`pref-${row.key}`}
              name={row.key}
              type="checkbox"
              checked={!!values[row.key]}
              disabled={pending}
              onChange={() => toggle(row.key)}
              className="mt-1 size-4"
            />
          </li>
        ))}
      </ul>

      {/* Its own block, its own warning. See the file header. */}
      <div className="grid gap-2 rounded-md bg-muted/50 p-3">
        <div className="flex items-start justify-between gap-4">
          <label className="grid gap-0.5 text-sm" htmlFor="pref-showOrderAmount">
            <span className="font-medium">{t("notifications.amount.label")}</span>
            <span className="text-xs text-muted-foreground">{t("notifications.amount.hint")}</span>
          </label>
          <input
            id="pref-showOrderAmount"
            name="showOrderAmount"
            type="checkbox"
            checked={!!values.showOrderAmount}
            disabled={pending}
            onChange={() => toggle("showOrderAmount")}
            className="mt-1 size-4"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("notifications.amount.privacy")}</p>
      </div>

      <p className="text-xs text-muted-foreground" role="status">
        {pending
          ? t("notifications.types.saving")
          : saved
            ? t("notifications.types.saved")
            : t("notifications.types.auto")}
      </p>
    </section>
  );
}
