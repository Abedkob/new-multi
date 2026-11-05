/**
 * The only module that talks to a push service (D51).
 *
 * Everything about its shape follows from one rule: **a push must never cost an order.** It runs
 * inside `after()`, after the checkout transaction has committed, and the container it runs in
 * may be shut down 10–30 seconds later. So:
 *
 *   - One attempt has a hard timeout (`PUSH_TIMEOUT_MS`, 2.5s by default). A push service that
 *     hangs costs that and nothing more.
 *   - Nothing throws. Every outcome — sent, timed out, refused, gone — comes back as a verdict
 *     the caller records. A rejection escaping into `after()` is an unhandled rejection, and in
 *     Next.js that is an `uncaughtException` (Phase 5 learned this the expensive way with Redis).
 *   - A permanently dead endpoint is told apart from a transient failure, because the two lead
 *     to different places: `EXPIRED` is never retried and the device is cleaned up, `FAILED` is
 *     retried by the scheduled stage.
 *
 * With push unconfigured this is a no-op that says so (P6-31).
 */

import webpush, { WebPushError } from "web-push";
import { checkPushEndpoint } from "@/lib/push/endpoint";
import { pushConfigured, pushTimeoutMs, vapidCredentials } from "@/lib/push/keys";
import type { PushPayload } from "@/lib/push/payload";

/** Where a verdict leads: EXPIRED is final, FAILED is retried, SENT is done. */
export type SendVerdict =
  | { state: "SENT" }
  | { state: "FAILED"; errorCategory: "timeout" | "rejected" | "unreachable" | "unknown" }
  | { state: "EXPIRED"; errorCategory: "gone" }
  /** Push is not configured. Not a failure of this delivery — there is nothing to deliver with. */
  | { state: "SKIPPED"; errorCategory: "not-configured" };

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

let configured = false;

function configure(): boolean {
  const credentials = vapidCredentials();
  if (!credentials) return false;
  if (!configured) {
    webpush.setVapidDetails(credentials.subject, credentials.publicKey, credentials.privateKey);
    configured = true;
  }
  return true;
}

/**
 * Classify what a push service said.
 *
 * 404 and 410 are the two codes that mean "this endpoint will never work again" — the browser
 * was uninstalled, the subscription was revoked, the user cleared site data. Anything else is
 * transient as far as this platform can tell, and a transient failure is retried rather than
 * used as grounds to delete a merchant's device.
 */
/** The verdicts a failure can produce: never SENT, never SKIPPED. */
export type FailureVerdict = Exclude<SendVerdict, { state: "SENT" } | { state: "SKIPPED" }>;

export function classifyPushError(error: unknown): FailureVerdict {
  if (error instanceof WebPushError) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      return { state: "EXPIRED", errorCategory: "gone" };
    }
    return { state: "FAILED", errorCategory: "rejected" };
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || /timed out|timeout/i.test(error.message)) {
      return { state: "FAILED", errorCategory: "timeout" };
    }
    // EPROTO belongs here: a push endpoint is always HTTPS, so a host that answers with
    // something that is not TLS is a broken or hijacked endpoint rather than a push refusal.
    // Found while building the hanging-service check, which hit exactly this.
    if (
      /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ECONNRESET|ECONNABORTED|EPROTO|socket hang up/i.test(
        error.message,
      )
    ) {
      return { state: "FAILED", errorCategory: "unreachable" };
    }
  }
  return { state: "FAILED", errorCategory: "unknown" };
}

/**
 * One attempt at one device. Never throws.
 *
 * The timeout is enforced here as well as passed to the library: `web-push`'s own timeout covers
 * the request, and this race covers everything else (DNS, a TLS handshake that stalls, the
 * library itself). The same belt-and-braces reasoning as `lib/redis.ts`, and for the same
 * reason — the caller is a response that has already been sent.
 */
export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
  timeoutMs = pushTimeoutMs(),
): Promise<SendVerdict> {
  if (!pushConfigured() || !configure()) {
    return { state: "SKIPPED", errorCategory: "not-configured" };
  }

  // Re-checked at the point of sending, even though registration already refused anything that
  // is not a push service. This is the line that actually opens the socket, and a row written
  // before that rule existed — or by a future path that forgets — must not be able to turn this
  // sender into a way of making requests from inside the network. EXPIRED, not FAILED: nothing
  // will ever make this endpoint acceptable, so it must not be retried forever.
  const verdict = checkPushEndpoint(target.endpoint);
  if (!verdict.ok) {
    console.error(`[push] refusing endpoint: ${verdict.reason}`);
    return { state: "EXPIRED", errorCategory: "gone" };
  }

  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("push timed out")), timeoutMs).unref?.(),
  );

  try {
    await Promise.race([
      webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, timeout: timeoutMs },
      ),
      timer,
    ]);
    return { state: "SENT" };
  } catch (error) {
    // Logged as a category, never as the provider's body: that body can echo the endpoint, and
    // an endpoint in a log file is the capability this phase encrypts at rest.
    const verdict = classifyPushError(error);
    console.error(`[push] delivery ${verdict.state}: ${verdict.errorCategory}`);
    return verdict;
  }
}
