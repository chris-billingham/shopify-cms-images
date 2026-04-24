/**
 * Backfill thumbnails for existing active image assets that don't have one.
 * Usage: docker compose exec app node dist/scripts/backfill-thumbnails.js
 */
import { Readable } from 'stream';
import { db } from '../src/db/connection.js';
import { driveService } from '../src/services/drive.service.js';
import { generateThumbnail } from '../src/services/thumbnail.service.js';

const CONCURRENCY = 3;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

async function backfill(): Promise<void> {
  const assets = await db('assets')
    .where('status', 'active')
    .whereNull('thumbnail_url')
    .whereIn('mime_type', ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff'])
    .whereNotNull('google_drive_id')
    .select('id', 'google_drive_id', 'mime_type', 'file_name');

  const total = assets.length;
  console.log(`Found ${total} assets to backfill.`);
  if (total === 0) return;

  let done = 0;
  let succeeded = 0;
  let failed = 0;

  async function processOne(asset: typeof assets[number]): Promise<void> {
    try {
      const stream = await driveService.downloadFile(asset.google_drive_id as string);
      const buffer = await streamToBuffer(stream);
      const url = await generateThumbnail(asset.id as string, buffer, asset.mime_type as string);
      if (url) {
        await db('assets').where('id', asset.id).update({ thumbnail_url: url });
        succeeded++;
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${asset.file_name} (${asset.id}): ${(err as Error).message}`);
    } finally {
      done++;
      process.stdout.write(`\r  ${done}/${total}  (${succeeded} ok, ${failed} failed)`);
    }
  }

  // Process CONCURRENCY at a time
  const queue = [...assets];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const asset = queue.shift()!;
      await processOne(asset);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone. ${succeeded} thumbnails generated, ${failed} failed.`);
}

backfill()
  .then(() => db.destroy())
  .catch((err) => {
    console.error('Fatal:', err);
    db.destroy().finally(() => process.exit(1));
  });
