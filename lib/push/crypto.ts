/**
 * A push subscription at rest (D56).
 *
 * A subscription's endpoint is a **capability**: whoever holds it can push to that device until
 * it is revoked, without any further credential. Its `p256dh` and `auth` values are the keys the
 * payload is encrypted to. A dump of `PushSubscription` must therefore not be enough to send a
 * merchant anything, which is why all three are stored as ciphertext.
 *
 * The envelope is the same versioned AES-256-GCM shape as `lib/license/crypto.ts`, under its own
 * key (`PUSH_ENCRYPTION_KEY`) so that rotating the licence key does not invalidate every
 * registered device and vice versa.
 *
 * `endpointHash` exists because the ciphertext is not comparable: a browser re-subscribing hands
 * back the same endpoint, and finding the existing row must not mean decrypting the whole table.
 * It is an HMAC under the same key, not a bare SHA-256: an endpoint URL is low-entropy enough
 * that an unkeyed digest would let someone with the table confirm a guessed endpoint.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

function key(): Buffer {
  const encoded = env.PUSH_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("Set PUSH_ENCRYPTION_KEY before registering push subscriptions.");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 32) {
    throw new Error("PUSH_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
}

export function encryptPushSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptPushSecret(envelope: string): string {
  const [version, iv, tag, ciphertext, extra] = envelope.split(":");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined || extra) {
    throw new Error("Unsupported encrypted push secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** The lookup key for an endpoint. Stable for one endpoint, useless without PUSH_ENCRYPTION_KEY. */
export function endpointHash(endpoint: string): string {
  return createHmac("sha256", key()).update(endpoint).digest("base64url");
}

/** True when a subscription can be stored at all: no key, no device. */
export function pushSecretsAvailable(): boolean {
  return !!env.PUSH_ENCRYPTION_KEY;
}
