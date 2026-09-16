/**
 * Copies media bytes from local disk into the configured S3/R2 bucket.
 *
 * Switching STORAGE_DRIVER from "local" to "s3" only changes where *new*
 * uploads go and where signed URLs point. Everything already in the library
 * keeps its storage key, but its bytes stay on the machine's disk — so the
 * database looks healthy while every read fails with "The specified key does
 * not exist", and a workflow gets all the way to rendering before finding out.
 *
 * Idempotent: an object already in the bucket is skipped, so this is safe to
 * re-run, and safe to run again after uploading more media locally.
 *
 * Run: npm run migrate:storage        (add --dry-run to see the plan first)
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.join(process.cwd(), 'storage');

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
};

function contentTypeFor(key, fallback) {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? fallback ?? 'application/octet-stream';
}

async function main() {
  const required = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}. This script copies into the bucket those name.`);
    process.exit(1);
  }

  const db = new PrismaClient();
  const client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    // Matches src/lib/storage/s3.ts — newer SDKs add a checksum header that
    // S3-compatible endpoints reject outright.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const assets = await db.mediaAsset.findMany({
    select: { id: true, filename: true, storageKey: true, thumbnailKey: true, mimeType: true },
    orderBy: { createdAt: 'asc' },
  });

  // Thumbnails are separate objects under their own key; a poster frame left
  // behind shows as a broken image in the library rather than a failed render,
  // which is easy to miss.
  const objects = assets.flatMap((asset) => [
    { key: asset.storageKey, mimeType: asset.mimeType, filename: asset.filename },
    ...(asset.thumbnailKey ? [{ key: asset.thumbnailKey, mimeType: null, filename: `${asset.filename} (poster)` }] : []),
  ]);

  let uploaded = 0;
  let skipped = 0;
  let absent = 0;
  let failed = 0;
  let bytes = 0;

  for (const object of objects) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.key }));
      skipped += 1;
      continue;
    } catch {
      // Not in the bucket yet — that is what this script is for.
    }

    const local = path.join(ROOT, object.key);
    try {
      await stat(local);
    } catch {
      console.warn(`  absent locally, nothing to copy: ${object.filename}`);
      absent += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  would upload: ${object.filename}`);
      uploaded += 1;
      continue;
    }

    try {
      const body = await readFile(local);
      await client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: object.key,
        Body: body,
        ContentType: contentTypeFor(object.key, object.mimeType),
      }));
      uploaded += 1;
      bytes += body.byteLength;
      process.stdout.write(`\r  uploaded ${uploaded}…`);
    } catch (error) {
      console.error(`\n  failed: ${object.filename} — ${error instanceof Error ? error.message : error}`);
      failed += 1;
    }
  }

  const mb = (bytes / 1_000_000).toFixed(1);
  console.log(
    `\n${DRY_RUN ? '[dry run] ' : ''}${uploaded} uploaded${DRY_RUN ? '' : ` (${mb} MB)`}, ` +
      `${skipped} already in the bucket, ${absent} absent locally, ${failed} failed`,
  );
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

await main();
