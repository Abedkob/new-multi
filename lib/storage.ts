// Server-only by convention (see lib/domain-check.ts): reads R2 secrets from env and uses Node
// built-ins. Only import from "use server" files, never from lib/validation.ts's import graph.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { fetchRemoteImage, RemoteImageError } from "@/lib/remote-image";

/**
 * Owner-uploaded images. Stored in Cloudflare R2 (S3-compatible) under `<tenantId>/<uuid>.<ext>`
 * and served from R2_PUBLIC_URL. Without R2 configured (development only — lib/env.ts requires
 * it in production) files go to public/uploads/<tenantId>/ on local disk instead.
 *
 * The full public URL is what gets stored in the database, so changing R2_PUBLIC_URL later (e.g.
 * r2.dev -> a custom domain) needs the stored URLs rewritten too.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Raster formats only, identified by their leading bytes — never by `file.type`, which the
 * browser (or an attacker) sets freely. SVG is deliberately not accepted: it can carry script,
 * and a stored SVG opened directly would run in whatever origin serves it.
 */
const UPLOAD_SIGNATURES: { ext: string; mime: string; matches: (b: Buffer) => boolean }[] = [
  { ext: "png", mime: "image/png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", mime: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", mime: "image/gif", matches: (b) => ["GIF87a", "GIF89a"].includes(b.toString("latin1", 0, 6)) },
  { ext: "webp", mime: "image/webp", matches: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];

let client: S3Client | undefined;
function r2() {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

const NOT_AN_IMAGE = "Use a PNG, JPG, WEBP or GIF image.";

export type StoreImageResult = { url: string; error?: never } | { url?: never; error: string };

/** Validates and stores an uploaded image for a tenant; returns its public URL. */
export async function storeImage(tenantId: string, file: File): Promise<StoreImageResult> {
  if (file.size === 0) return { error: "Choose an image file." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Image must be 5MB or smaller." };
  return storeImageBytes(tenantId, Buffer.from(await file.arrayBuffer()));
}

/**
 * True for links that already point at our own storage (or a same-site path like "/demo/x.png"),
 * which never need importing. Compares origins, not string prefixes, so
 * "https://pub-x.r2.dev.evil.com" doesn't pass for "https://pub-x.r2.dev".
 */
export function isOwnImageUrl(link: string): boolean {
  if (link.startsWith("/") && !link.startsWith("//")) return true;
  if (!env.R2_PUBLIC_URL) return false;
  try {
    return new URL(link).origin === new URL(env.R2_PUBLIC_URL).origin;
  } catch {
    return false;
  }
}

/**
 * Copies the image behind an owner-supplied link into our storage and returns the new URL. A link
 * that's already ours comes back unchanged.
 */
export async function importImageFromUrl(tenantId: string, link: string): Promise<StoreImageResult> {
  const trimmed = link.trim();
  if (isOwnImageUrl(trimmed)) return { url: trimmed };
  let bytes: Buffer;
  try {
    bytes = await fetchRemoteImage(trimmed, MAX_UPLOAD_BYTES);
  } catch (err) {
    if (err instanceof RemoteImageError) return { error: err.message };
    console.error("[storage] image import failed", err);
    return { error: "Couldn't download that image." };
  }
  if (bytes.length === 0) return { error: "That link returned an empty file." };
  const stored = await storeImageBytes(tenantId, bytes);
  return stored.error === NOT_AN_IMAGE
    ? { error: "That link isn't a PNG, JPG, WEBP or GIF image." }
    : stored;
}

async function storeImageBytes(tenantId: string, bytes: Buffer): Promise<StoreImageResult> {
  const type = UPLOAD_SIGNATURES.find((s) => s.matches(bytes));
  if (!type) return { error: NOT_AN_IMAGE };

  const filename = `${randomUUID()}.${type.ext}`;

  if (!env.R2_BUCKET) {
    const dir = path.join(process.cwd(), "public", "uploads", tenantId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), bytes);
    return { url: `/uploads/${tenantId}/${filename}` };
  }

  const key = `${tenantId}/${filename}`;
  try {
    await r2().send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: type.mime,
        // Keys are random and never overwritten, so the file can be cached forever.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (err) {
    console.error("[storage] R2 upload failed", err);
    return { error: "Upload failed. Please try again." };
  }
  return { url: `${env.R2_PUBLIC_URL}/${key}` };
}
