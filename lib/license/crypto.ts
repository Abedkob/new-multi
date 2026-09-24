import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

function encryptionKey() {
  const encoded = env.LICENSE_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Set LICENSE_ENCRYPTION_KEY before activating store licenses.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("LICENSE_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

/** Versioned AES-256-GCM envelope: version, IV, auth tag and ciphertext are Base64 encoded. */
export function encryptLicenseSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptLicenseSecret(envelope: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split(":");
  if (version !== "v1" || !encodedIv || !encodedTag || encodedCiphertext === undefined || extra) {
    throw new Error("Unsupported encrypted license secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
