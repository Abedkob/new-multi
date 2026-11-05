"use client";

import { useState, useSyncExternalStore } from "react";
import {
  notifyPushStateChanged,
  pushStateSnapshot,
  readPushState,
  serverPushStateSnapshot,
  subscribePushState,
  type PushPermission,
} from "./push-state";

/**
 * Push status: is this device installed, has it been allowed, and does it work (§11.2, §11.9).
 *
 * Shared by the merchant's screen and the platform console's, which is why every string arrives
 * as a prop: the merchant's dashboard is bilingual and the platform console is English-only, and
 * a component that reached for `useT()` could not serve both without dragging Arabic into an
 * internal operations screen. The *behaviour* is what must be shared — the permission rule
 * below, the honest reporting of state — and that is what is in here.
 *
 * **Permission is requested only from a direct tap** (P6-17). There is no `requestPermission` in
 * an effect, no "ask on page load", and no retry: a browser asked without a gesture either
 * refuses outright or burns the one chance the site gets, after which the owner must dig through
 * browser settings to undo it. The store below only *reads* the current state.
 *
 * On iPhone, Web Push exists only for an app added to the Home Screen; in Safari itself the
 * subscribe call fails. So when the API is missing the button is replaced by an explanation
 * rather than left there to do nothing.
 */

export type PushStatusCopy = {
  heading: string;
  install: string;
  installed: string;
  notInstalled: string;
  permission: string;
  granted: string;
  denied: string;
  notAsked: string;
  unsupported: string;
  unsupportedHelp: string;
  deniedHelp: string;
  enable: string;
  test: string;
  refused: string;
  enabled: string;
  failed: string;
  testSent: string;
};

export type RegisterDevice = (input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  deviceClass: string;
}) => Promise<{ error?: string } | void>;

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

export function PushStatus({
  vapidPublicKey,
  copy,
  register,
  sendTest,
}: {
  vapidPublicKey: string | null;
  copy: PushStatusCopy;
  register: RegisterDevice;
  sendTest: () => Promise<{ error?: string } | void>;
}) {
  // Read from the browser, never copied into state: see ./push-state.ts.
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
        setError(copy.failed);
        return;
      }
      // The tap that got us here is the only reason this is allowed to ask (P6-17).
      const granted = (await Notification.requestPermission()) as PushPermission;
      notifyPushStateChanged();
      if (granted !== "granted") {
        setError(copy.refused);
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
      const result = await register({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        deviceLabel: device.label,
        deviceClass: device.deviceClass,
      });
      if (result && result.error) setError(result.error);
      else setMessage(copy.enabled);
    } catch {
      // Almost always iOS-in-Safari or a blocked service worker. Say what to try rather than
      // printing an exception at a shop owner.
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await sendTest();
    if (result && result.error) setError(result.error);
    else setMessage(copy.testSent);
    setBusy(false);
  };

  const label =
    permission === "unsupported"
      ? copy.unsupported
      : permission === "granted"
        ? copy.granted
        : permission === "denied"
          ? copy.denied
          : copy.notAsked;

  return (
    <section className="grid gap-3 rounded-lg border p-4" data-testid="push-status">
      <h2 className="text-sm font-semibold">{copy.heading}</h2>
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.install}:</dt>
          <dd data-install={installed ? "yes" : "no"}>
            {installed ? copy.installed : copy.notInstalled}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.permission}:</dt>
          <dd data-permission={permission}>{label}</dd>
        </div>
      </dl>

      {permission === "unsupported" ? (
        <p className="text-sm text-muted-foreground">{copy.unsupportedHelp}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy || permission === "denied"}
            data-testid="enable-notifications"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {copy.enable}
          </button>
          <button
            type="button"
            onClick={test}
            disabled={busy || permission !== "granted"}
            data-testid="send-test-notification"
            className="rounded-md border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {copy.test}
          </button>
        </div>
      )}

      {permission === "denied" ? (
        <p className="text-sm text-muted-foreground">{copy.deniedHelp}</p>
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
