/**
 * Whether push is configured, and the one key the browser is allowed to see (D56).
 *
 * Push is optional everywhere. A deployment with no VAPID keys must behave exactly as it did
 * before Phase 6 (P6-31): the shop sells, the admin works, and the notification screen says push
 * is unavailable instead of offering a button that cannot work. So nothing here throws on a
 * missing key — callers ask `pushConfigured()` and take the other branch.
 *
 * The private key is read in one place, by the sender, and is never returned to a caller that
 * might log it.
 */

import { env } from "@/lib/env";

export function pushConfigured(): boolean {
  return !!(env.PUSH_VAPID_PUBLIC_KEY && env.PUSH_VAPID_PRIVATE_KEY && env.PUSH_VAPID_SUBJECT);
}

/** The application server key a browser needs to subscribe. Public by design. */
export function vapidPublicKey(): string | null {
  return env.PUSH_VAPID_PUBLIC_KEY ?? null;
}

/** For the sender only. Returns null rather than throwing, so a no-op path stays a no-op. */
export function vapidCredentials(): { subject: string; publicKey: string; privateKey: string } | null {
  if (!pushConfigured()) return null;
  return {
    subject: env.PUSH_VAPID_SUBJECT!,
    publicKey: env.PUSH_VAPID_PUBLIC_KEY!,
    privateKey: env.PUSH_VAPID_PRIVATE_KEY!,
  };
}

export const pushTimeoutMs = () => env.PUSH_TIMEOUT_MS;
