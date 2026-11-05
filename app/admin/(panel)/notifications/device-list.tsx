"use client";

import { useState, useTransition } from "react";
import { removeDeviceAction } from "./actions";
import { useT } from "@/lib/i18n/context";

export type DeviceRow = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastSuccessAt: string | null;
  expired: boolean;
};

/**
 * The devices this owner has registered (§11.2).
 *
 * Each row says when it was added and when it last received something, because that is how an
 * owner answers the only question they will ever ask here: "why didn't my phone buzz?" A device
 * the push service has given up on is labelled as needing to be enabled again, rather than
 * quietly listed as if it worked.
 *
 * Removing one device removes one device. It changes no preference and touches no other device
 * (P6-16) — true because the preference row is keyed by user, not by subscription.
 */
export function DeviceList({ devices }: { devices: DeviceRow[] }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (devices.length === 0) {
    return (
      <section className="grid gap-2 rounded-lg border p-4" data-testid="device-list">
        <h2 className="text-sm font-semibold">{t("notifications.devices.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("notifications.devices.none")}</p>
      </section>
    );
  }

  const remove = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await removeDeviceAction(id);
      if (result?.error) setError(t(result.error as "notifications.error.deviceGone"));
    });

  const date = (iso: string) => new Date(iso).toISOString().slice(0, 10);

  return (
    <section className="grid gap-3 rounded-lg border p-4" data-testid="device-list">
      <h2 className="text-sm font-semibold">{t("notifications.devices.heading")}</h2>
      <ul className="grid gap-2">
        {devices.map((device) => (
          <li
            key={device.id}
            data-device={device.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b pb-2 text-sm last:border-0"
          >
            <div className="grid gap-0.5">
              <span className="font-medium">{device.deviceLabel}</span>
              <span className="text-xs text-muted-foreground">
                {t("notifications.devices.added")} {date(device.createdAt)}
                {" · "}
                {device.expired
                  ? t("notifications.devices.expired")
                  : device.lastSuccessAt
                    ? `${t("notifications.devices.lastDelivery")} ${date(device.lastSuccessAt)}`
                    : t("notifications.devices.neverDelivered")}
              </span>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => remove(device.id)}
              className="text-sm underline underline-offset-4 disabled:opacity-60"
            >
              {t("notifications.devices.remove")}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("notifications.devices.note")}</p>
      {error ? (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
