/**
 * Which push endpoints this server is willing to talk to.
 *
 * A subscription's endpoint arrives from the browser and the server later POSTs to it. Without a
 * rule, an authenticated owner could register `http://169.254.169.254/latest/meta-data/` or
 * `http://127.0.0.1:6379/` as their "device" and have this platform make requests to its own
 * infrastructure on demand — a blind SSRF with an attacker-chosen host, port and path. The body
 * is encrypted and the response is never returned to them, which makes it blind, not harmless:
 * timing alone maps an internal network, and a POST is enough to poke anything that acts on one.
 *
 * (Found by the automated security review of the commit that added the registration action. The
 * same reasoning already applies to remote images in `lib/storage.ts`, which blocks private
 * address space — this is that rule for a different input.)
 *
 * An allowlist rather than a private-IP block, because the set of real push services is small,
 * public, and fixed by the browsers themselves: a merchant's phone subscribes through Google,
 * Mozilla, Apple or Microsoft and nowhere else. A blocklist would have to keep up with every
 * new way of spelling an internal address (IPv6-mapped, decimal, a hostname that resolves
 * inward); an allowlist is wrong only in the direction of refusing a new push service, which is
 * visible, reported, and a one-line change.
 */

/** The push services browsers actually use. Matched exactly, or as a `.`-anchored suffix. */
const ALLOWED_HOSTS = [
  // Chrome, Edge and every other Chromium browser.
  "fcm.googleapis.com",
  "android.googleapis.com",
  // Firefox.
  "updates.push.services.mozilla.com",
  // Safari, iOS and macOS. Apple uses per-region hosts under this suffix.
  ".push.apple.com",
  // Legacy Edge / Windows.
  ".notify.windows.com",
  ".push.microsoft.com",
  // Mozilla's autopush nodes, which appear under this suffix in some builds.
  ".push.services.mozilla.com",
] as const;

export type EndpointVerdict = { ok: true; host: string } | { ok: false; reason: string };

/**
 * Extra `host:port` pairs, outside production only.
 *
 * `verify:notifications` has to point the sender at a server it controls to prove that a push
 * service which goes dark costs one timeout and nothing else (P6-01) — and that check is the
 * reason D51 can be believed. The alternatives were a test-only flag threaded through the
 * sender, which is production code shaped by a test, or no check at all.
 *
 * **Host AND port**, which it was not at first. A host-only concession for `127.0.0.1` allows
 * every port on it, so the suite's own "127.0.0.1:6379 must be refused" case stopped being true
 * the moment the concession was switched on — the check caught it. Naming the port keeps the
 * hole the size of the one server the suite started.
 *
 * Honoured only when NODE_ENV is not "production", so the rule that matters cannot be relaxed
 * where it matters: a production deployment refuses these even if the variable is set.
 */
function testTargets(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const raw = process.env.PUSH_TEST_ENDPOINT_HOST?.trim().toLowerCase();
  if (!raw) return [];
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function checkPushEndpoint(endpoint: string): EndpointVerdict {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  // https only: a push endpoint is always TLS, and allowing http would let someone point this
  // server at a plaintext internal service even if the host passed the list below.
  if (url.protocol !== "https:") return { ok: false, reason: `protocol ${url.protocol}` };
  // A userinfo section is a classic way to make a URL look like one host and resolve to another.
  if (url.username || url.password) return { ok: false, reason: "credentials in the URL" };

  // A trailing dot is a fully-qualified name and resolves the same, so it must not be a way
  // around an exact comparison.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = ALLOWED_HOSTS.some((entry) =>
    entry.startsWith(".") ? host.endsWith(entry) : host === entry,
  );
  if (!allowed) {
    // https, so an absent port means 443.
    const target = `${host}:${url.port || "443"}`;
    if (testTargets().includes(target)) return { ok: true, host };
    return { ok: false, reason: `host ${target}` };
  }
  return { ok: true, host };
}

export const isAllowedPushEndpoint = (endpoint: string) => checkPushEndpoint(endpoint).ok;

/** For the checks and the error messages: the list, as data. */
export const ALLOWED_PUSH_HOSTS = ALLOWED_HOSTS;
