"use client";

/**
 * This device's push state, read from the browser rather than kept in React state.
 *
 * Permission and install state are **external** facts: the browser owns them, they can change
 * while the tab is in the background (someone revokes the permission in settings, or installs
 * the app), and nothing in React can be their source of truth. So they are read through
 * `useSyncExternalStore` instead of copied into state inside an effect — which React 19 rightly
 * refuses, and which would also go stale the moment the owner changed it elsewhere.
 *
 * The snapshot is a single string so it can be compared by value: `useSyncExternalStore` calls
 * `getSnapshot` on every render and must get a stable result, which an object literal is not.
 */

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

const SERVER_SNAPSHOT = "unsupported|no";

const listeners = new Set<() => void>();

export function subscribePushState(listener: () => void): () => void {
  listeners.add(listener);
  // Coming back to the tab is when a change made in browser settings becomes visible.
  const onVisible = () => listener();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
    listeners.delete(listener);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}

/** Called after the owner grants permission, so the screen reflects it without a reload. */
export function notifyPushStateChanged() {
  for (const listener of listeners) listener();
}

export function pushStateSnapshot(): string {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (!supported) return SERVER_SNAPSHOT;
  const permission = Notification.permission as PushPermission;
  const installed =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for an app opened from the Home Screen, which is the only place
    // Web Push works on an iPhone at all.
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
  return `${permission}|${installed ? "yes" : "no"}`;
}

export const serverPushStateSnapshot = () => SERVER_SNAPSHOT;

export function readPushState(snapshot: string): { permission: PushPermission; installed: boolean } {
  const [permission, installed] = snapshot.split("|");
  return { permission: permission as PushPermission, installed: installed === "yes" };
}
