"use client";

import { useState, useSyncExternalStore } from "react";
import { registerDeviceAction, sendTestNotificationAction } from "./actions";
import { useT } from "@/lib/i18n/context";
import {
  notifyPushStateChanged,
  pushStateSnapshot,
  readPushState,
  serverPushStateSnapshot,
  subscribePushState,
  type PushPermission,
} from "./push-state";

/**
 * Push status: is this device installed, has it been allowed, and does it work (§11.2).
 *
 * Two rules shape this component.
 *
 * **Permission is requested only from a direct tap** (P6-17). There is no `requestPermission` in
 * an effect, no "ask on page load", and no retry loop: a browser that is asked without a gesture
 * either refuses outright or — worse — burns the one chance the site gets, after which the owner
 * must dig through browser settings to undo it. The effect below only *reads* the current state.
 *
 * **The state is reported honestly, including when it cannot be fixed here.** On iPhone, Web
 * Push exists only for an app added to the Home Screen; in Safari itself the subscribe call
 * fails, and an Enable button that silently does nothing is the worst possible answer. So when
 * the API is missing the button is replaced by the instructions.
 */

/** A label a person recognises in their own device list. Coarse on purpose (§9.6). */
function describeDevice(): { label: string; deviceClass: string } {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const platform = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iPhone or iPad"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : "this device";
  return { label: `${browser} on ${platform}`, deviceClass: `${browser}/${platform}` };
}

/**
 * base64url (what a VAPID key is) to the bytes the subscribe call wants.
 *
 * Typed as ArrayBuffer rather than Uint8Array because `applicationServerKey` wants a
 * `BufferSource` over a plain ArrayBuffer, and a Uint8Array's buffer may be a SharedArrayBuffer
 * as far as the type system knows.
 */
function applicationServerKey(base64: string): ArrayBuffer {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function PushStatus({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const t = useT();
  // Read from the browser, never copied into state: see ./push-state.ts. Reading only —
  // nothing in this component asks for permission except the click handler below (P6-17).
  const snapshot = useSyncExternalStore(
    subscribePushState,
    pushStateSnapshot,
    serverPushStateSnapshot,
  );
  const { permission, installed } = readPushState(snapshot);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!vapidPublicKey) {
        setError(t("notifications.error.unavailable"));
        return;
      }
      // The gesture that got us here is the only reason this is allowed to ask.
      const granted = (await Notification.requestPermission()) as PushPermission;
      notifyPushStateChanged();
      if (granted !== "granted") {
        setError(t("notifications.status.refused"));
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required by every browser: a push that is not shown to the user is not allowed.
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(vapidPublicKey),
        }));
      const json = subscription.toJSON();
      const device = describeDevice();
      const result = await registerDeviceAction({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        deviceLabel: device.label,
        deviceClass: device.deviceClass,
      });
      if (result.error) setError(t(result.error as "notifications.error.unavailable"));
      else setMessage(t("notifications.status.enabled"));
    } catch {
      // A failure here is almost always iOS-in-Safari or a blocked service worker. Say what to
      // try rather than printing an exception at a shop owner.
      setError(t("notifications.status.failed"));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await sendTestNotificationAction();
    if (result.error) setError(t(result.error as "notifications.error.noDevices"));
    else setMessage(t("notifications.status.testSent"));
    setBusy(false);
  };

  const label =
    permission === "unsupported"
      ? t("notifications.status.unsupported")
      : permission === "granted"
        ? t("notifications.status.granted")
        : permission === "denied"
          ? t("notifications.status.denied")
          : t("notifications.status.notAsked");

  return (
    <section className="grid gap-3 rounded-lg border p-4" data-testid="push-status">
      <h2 className="text-sm font-semibold">{t("notifications.push.heading")}</h2>
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("notifications.push.install")}:</dt>
          <dd data-install={installed ? "yes" : "no"}>
            {installed ? t("notifications.push.installed") : t("notifications.push.notInstalled")}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("notifications.push.permission")}:</dt>
          <dd data-permission={permission}>{label}</dd>
        </div>
      </dl>

      {permission === "unsupported" ? (
        <p className="text-sm text-muted-foreground">{t("notifications.status.unsupportedHelp")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy || permission === "denied"}
            data-testid="enable-notifications"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {t("notifications.push.enable")}
          </button>
          <button
            type="button"
            onClick={test}
            disabled={busy || permission !== "granted"}
            data-testid="send-test-notification"
            className="rounded-md border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {t("notifications.push.test")}
          </button>
        </div>
      )}

      {permission === "denied" ? (
        <p className="text-sm text-muted-foreground">{t("notifications.status.deniedHelp")}</p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-emerald-600">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
