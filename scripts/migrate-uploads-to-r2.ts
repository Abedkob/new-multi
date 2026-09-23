/**
 * Moves owner images to R2 and rewrites the stored URLs (pnpm uploads:migrate).
 *
 *   pnpm uploads:migrate
 *     Uploads every file under public/uploads/ to R2 (same `<tenantId>/<file>` key), then rewrites
 *     URLs starting with "/uploads/" to R2_PUBLIC_URL. Safe to re-run.
 *
 *   pnpm uploads:migrate --rewrite-from=https://pub-xxxx.r2.dev
 *     Only rewrites URLs: for after switching R2_PUBLIC_URL (e.g. r2.dev -> a custom domain).
 *     The files are already in the bucket; only the origin in the database changes.
 *
 * Add --dry-run to print what would change without touching R2 or the database.
 */
import "dotenv/config";
import "./_owner";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// Every column that holds an owner image URL. TenantContent.value holds all content, not just
// images, but only values starting with the old prefix are touched.
const COLUMNS: [table: string, column: string][] = [
  ["Product", "imageUrl"],
  ["ProductVariant", "imageUrl"],
  ["ProductImage", "url"],
  ["Category", "imageUrl"],
  ["TenantContent", "value"],
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rewriteFrom = args.find((a) => a.startsWith("--rewrite-from="))?.split("=")[1];

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Fill in the R2_* variables in .env first.`);
  return v;
}

async function uploadLocalFiles() {
  const root = path.join(process.cwd(), "public", "uploads");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
  const bucket = required("R2_BUCKET");

  let tenants: string[];
  try {
    tenants = await readdir(root);
  } catch {
    console.log("No public/uploads/ directory; nothing to upload.");
    return;
  }
  for (const tenantId of tenants) {
    for (const file of await readdir(path.join(root, tenantId))) {
      const key = `${tenantId}/${file}`;
      const contentType = MIME[path.extname(file).slice(1).toLowerCase()];
      if (!contentType) {
        // Only raster types are allowed now; anything else (e.g. an old SVG) stays behind.
        console.log(`skip  ${key} (not a PNG/JPG/GIF/WEBP)`);
        continue;
      }
      console.log(`${dryRun ? "would upload" : "upload"}  ${key}`);
      if (dryRun) continue;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await readFile(path.join(root, tenantId, file)),
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }
  }
}

async function rewriteUrls(from: string, to: string) {
  for (const [table, column] of COLUMNS) {
    const t = `"${table}"`;
    const c = `"${column}"`;
    const where = `left(${c}, length($1)) = $1`;
    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM ${t} WHERE ${where}`,
      from,
    );
    console.log(`${dryRun ? "would rewrite" : "rewrite"}  ${table}.${column}: ${count} row(s)`);
    if (dryRun || count === BigInt(0)) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE ${t} SET ${c} = $2 || substr(${c}, length($1) + 1) WHERE ${where}`,
      from,
      to,
    );
  }
}

async function main() {
  const publicUrl = required("R2_PUBLIC_URL").replace(/\/$/, "");
  if (rewriteFrom) {
    await rewriteUrls(`${rewriteFrom.replace(/\/$/, "")}/`, `${publicUrl}/`);
  } else {
    await uploadLocalFiles();
    await rewriteUrls("/uploads/", `${publicUrl}/`);
  }
  console.log(dryRun ? "Dry run: nothing changed." : "Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
