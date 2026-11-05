"use client";

import { useState, useTransition } from "react";

export type DeviceRow = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastSuccessAt: string | null;
  expired: boolean;
};

export type DeviceListCopy = {
  heading: string;
  none: string;
  added: string;
  lastDelivery: string;
  neverDelivered: string;
  expired: string;
  remove: string;
  note: string;
};

/**
 * The devices one person has registered (§11.2, §11.9).
 *
 * Each row says when it was added and when it last received something, because that is how
 * anyone answers the only question they will ever ask here: "why didn't my phone buzz?" A device
 * the push service has given up on is labelled as needing to be enabled again rather than
 * quietly listed as if it worked.
 *
 * Removing one device removes one device (P6-16). It changes no preference and touches no other
 * device — true because the preference row is keyed by user, not by subscription, so there is no
 * code here that has to remember it.
 */
export function DeviceList({
  devices,
  copy,
  remove,
}: {
  devices: DeviceRow[];
  copy: DeviceListCopy;
  remove: (deviceId: string) => Promise<{ error?: string } | void>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (devices.length === 0) {
    return (
      <section className="grid gap-2 rounded-lg border p-4" data-testid="device-list">
        <h2 className="text-sm font-semibold">{copy.heading}</h2>
        <p className="text-sm text-muted-foreground">{copy.none}</p>
      </section>
    );
  }

  const onRemove = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await remove(id);
      if (result && result.error) setError(result.error);
    });

  const date = (iso: string) => new Date(iso).toISOString().slice(0, 10);

  return (
    <section className="grid gap-3 rounded-lg border p-4" data-testid="device-list">
      <h2 className="text-sm font-semibold">{copy.heading}</h2>
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
                {copy.added} {date(device.createdAt)}
                {" · "}
                {device.expired
                  ? copy.expired
                  : device.lastSuccessAt
                    ? `${copy.lastDelivery} ${date(device.lastSuccessAt)}`
                    : copy.neverDelivered}
              </span>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRemove(device.id)}
              className="text-sm underline underline-offset-4 disabled:opacity-60"
            >
              {copy.remove}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{copy.note}</p>
      {error ? (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
