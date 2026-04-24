import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

const THUMB_DIR = process.env.THUMBNAILS_DIR ?? '/app/thumbnails';
const THUMB_WIDTH = 400;
const RASTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff']);

export function thumbPath(assetId: string): string {
  return path.join(THUMB_DIR, `${assetId}.jpg`);
}

export async function generateThumbnail(assetId: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  if (!RASTER_MIMES.has(mimeType)) return null;
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await sharp(buffer)
    .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbPath(assetId));
  return `/api/assets/${assetId}/thumbnail`;
}

export async function deleteThumbnail(assetId: string): Promise<void> {
  await fs.unlink(thumbPath(assetId)).catch(() => {});
}

export function openThumbnailStream(assetId: string): ReturnType<typeof createReadStream> {
  return createReadStream(thumbPath(assetId));
}
