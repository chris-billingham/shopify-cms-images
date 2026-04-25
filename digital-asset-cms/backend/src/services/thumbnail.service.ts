import { createReadStream, promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const THUMB_DIR = process.env.THUMBNAILS_DIR ?? '/app/thumbnails';
const THUMB_WIDTH = 400;
const RASTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo']);

export function thumbPath(assetId: string): string {
  return path.join(THUMB_DIR, `${assetId}.jpg`);
}

async function generateVideoThumbnail(assetId: string, buffer: Buffer): Promise<string | null> {
  const suffix = Date.now();
  const tmpInput = path.join(tmpdir(), `vin-${assetId}-${suffix}`);
  const tmpOutput = path.join(tmpdir(), `vout-${assetId}-${suffix}.jpg`);

  await fs.writeFile(tmpInput, buffer);

  try {
    // Try 3 seconds in first (better thumbnail), fall back to first frame
    for (const seekTime of ['3', '0']) {
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-ss', seekTime,
          '-i', tmpInput,
          '-frames:v', '1',
          '-vf', `scale=${THUMB_WIDTH}:-2`,
          '-loglevel', 'error',
          tmpOutput,
        ]);
        const thumbBuffer = await fs.readFile(tmpOutput);
        if (thumbBuffer.length === 0) continue;
        await fs.mkdir(THUMB_DIR, { recursive: true });
        await sharp(thumbBuffer).jpeg({ quality: 80 }).toFile(thumbPath(assetId));
        return `/api/assets/${assetId}/thumbnail`;
      } catch {
        // try next seek time
      }
    }
    return null;
  } finally {
    await fs.unlink(tmpInput).catch(() => {});
    await fs.unlink(tmpOutput).catch(() => {});
  }
}

export async function generateThumbnail(assetId: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  if (RASTER_MIMES.has(mimeType)) {
    await fs.mkdir(THUMB_DIR, { recursive: true });
    await sharp(buffer)
      .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbPath(assetId));
    return `/api/assets/${assetId}/thumbnail`;
  }

  if (VIDEO_MIMES.has(mimeType)) {
    return generateVideoThumbnail(assetId, buffer);
  }

  return null;
}

export async function deleteThumbnail(assetId: string): Promise<void> {
  await fs.unlink(thumbPath(assetId)).catch(() => {});
}

export function openThumbnailStream(assetId: string): ReturnType<typeof createReadStream> {
  return createReadStream(thumbPath(assetId));
}
