import { Readable } from 'stream';
import { db } from '../db/connection.js';
import { driveService as _defaultDriveService, type DriveService } from './drive.service.js';
import * as auditService from './audit.service.js';
import { config } from '../config/index.js';

// ── Error types ───────────────────────────────────────────────────────────────

export class AssetValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AssetValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AssetNotFoundError extends Error {
  constructor(id: string) {
    super(`Asset ${id} not found`);
    this.name = 'AssetNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OptimisticLockError extends Error {
  constructor() {
    super('Asset was modified by another request — please retry with the latest updated_at');
    this.name = 'OptimisticLockError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── MIME allowlist per §4.4 ───────────────────────────────────────────────────

type AssetType = 'image' | 'video' | 'text' | 'document' | 'other';

interface MimeEntry {
  category: AssetType;
  maxBytes: () => number;
}

const MIME_MAP: Record<string, MimeEntry> = {
  'image/jpeg':    { category: 'image',    maxBytes: () => config.MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  'image/png':     { category: 'image',    maxBytes: () => config.MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  'image/webp':    { category: 'image',    maxBytes: () => config.MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  'image/gif':     { category: 'image',    maxBytes: () => config.MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  'image/svg+xml': { category: 'image',    maxBytes: () => config.MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  'image/tiff':    { category: 'image',    maxBytes: () => config.MAX_IMAGE_SIZE_MB * 1024 * 1024 },

  'video/mp4':       { category: 'video', maxBytes: () => config.MAX_VIDEO_SIZE_MB * 1024 * 1024 },
  'video/quicktime': { category: 'video', maxBytes: () => config.MAX_VIDEO_SIZE_MB * 1024 * 1024 },
  'video/webm':      { category: 'video', maxBytes: () => config.MAX_VIDEO_SIZE_MB * 1024 * 1024 },
  'video/x-msvideo': { category: 'video', maxBytes: () => config.MAX_VIDEO_SIZE_MB * 1024 * 1024 },

  'text/plain':    { category: 'text', maxBytes: () => config.MAX_TEXT_SIZE_MB * 1024 * 1024 },
  'text/markdown': { category: 'text', maxBytes: () => config.MAX_TEXT_SIZE_MB * 1024 * 1024 },
  'text/html':     { category: 'text', maxBytes: () => config.MAX_TEXT_SIZE_MB * 1024 * 1024 },
  'text/csv':      { category: 'text', maxBytes: () => config.MAX_TEXT_SIZE_MB * 1024 * 1024 },

  'application/pdf': { category: 'document', maxBytes: () => config.MAX_DOCUMENT_SIZE_MB * 1024 * 1024 },
};

export function validateMimeAndSize(mimeType: string, fileSizeBytes: number): { assetType: AssetType } {
  const entry = MIME_MAP[mimeType];
  if (!entry) {
    throw new AssetValidationError(
      'UNSUPPORTED_MIME_TYPE',
      `MIME type "${mimeType}" is not supported. Accepted types: image (JPEG, PNG, WebP, GIF, SVG, TIFF), video (MP4, QuickTime, WebM, AVI), text (plain, Markdown, HTML, CSV), and PDF.`
    );
  }
  const maxBytes = entry.maxBytes();
  if (fileSizeBytes > maxBytes) {
    const maxMb = (maxBytes / 1024 / 1024).toFixed(0);
    throw new AssetValidationError(
      'FILE_TOO_LARGE',
      `File size ${fileSizeBytes} bytes exceeds the ${maxMb} MB limit for ${mimeType}.`
    );
  }
  return { assetType: entry.category };
}

// ── Materialised view refresh ─────────────────────────────────────────────────

export async function refreshSearchView(): Promise<void> {
  await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv');
}

// ── Asset CRUD ────────────────────────────────────────────────────────────────

export interface CreateAssetInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  tags?: Record<string, string>;
}

export async function createAsset(
  input: CreateAssetInput,
  userId: string | null,
  drive: DriveService = _defaultDriveService
): Promise<Record<string, unknown>> {
  const { fileName, mimeType, buffer, tags } = input;
  const fileSizeBytes = buffer.length;

  const { assetType } = validateMimeAndSize(mimeType, fileSizeBytes);

  const stream = Readable.from(buffer);
  const { id: googleDriveId, webViewLink } = await drive.uploadFile(stream, {
    name: fileName,
    mimeType,
    size: fileSizeBytes,
  });

  let asset: Record<string, unknown>;
  try {
    const [row] = await db('assets')
      .insert({
        file_name: fileName,
        asset_type: assetType,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        google_drive_id: googleDriveId,
        google_drive_url: webViewLink || null,
        status: 'active',
        tags: JSON.stringify(tags ?? {}),
        uploaded_by: userId,
      })
      .returning('*');
    asset = row as Record<string, unknown>;
  } catch (err) {
    // Clean up Drive file on DB failure
    await drive.trashFile(googleDriveId).catch(() => {});
    throw err;
  }

  await auditService.log(userId, 'upload', 'asset', asset['id'] as string, {
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    google_drive_id: googleDriveId,
  });

  await refreshSearchView().catch(() => {});

  return asset;
}

export async function getAsset(id: string): Promise<Record<string, unknown>> {
  const asset = await db('assets').where('id', id).first();
  if (!asset) throw new AssetNotFoundError(id);
  return asset as Record<string, unknown>;
}

export interface UpdateAssetInput {
  fileName?: string;
  tags?: Record<string, string>;
}

export async function updateAsset(
  id: string,
  changes: UpdateAssetInput,
  updatedAt: Date | string,
  userId: string | null
): Promise<Record<string, unknown>> {
  const asset = await db('assets').where('id', id).first();
  if (!asset) throw new AssetNotFoundError(id);

  // Optimistic concurrency check — compare timestamps at ms precision
  const existing = new Date(asset.updated_at).getTime();
  const requested = new Date(updatedAt).getTime();
  if (existing !== requested) {
    throw new OptimisticLockError();
  }

  const updateData: Record<string, unknown> = { updated_at: new Date() };

  if (changes.fileName !== undefined) {
    updateData['file_name'] = changes.fileName;
  }

  if (changes.tags !== undefined) {
    const oldTags = (asset.tags ?? {}) as Record<string, string>;
    const newTags = changes.tags;
    updateData['tags'] = JSON.stringify(newTags);

    const tagChanges: Array<{ key: string; old_value: string | null; new_value: string | null }> = [];
    const allKeys = new Set([...Object.keys(oldTags), ...Object.keys(newTags)]);
    for (const key of allKeys) {
      if (oldTags[key] !== newTags[key]) {
        tagChanges.push({ key, old_value: oldTags[key] ?? null, new_value: newTags[key] ?? null });
      }
    }
    if (tagChanges.length > 0) {
      await auditService.log(userId, 'tag_change', 'asset', id, { changes: tagChanges });
    }
  }

  const [updated] = await db('assets').where('id', id).update(updateData).returning('*');
  await refreshSearchView().catch(() => {});

  return updated as Record<string, unknown>;
}

export async function softDeleteAsset(id: string, userId: string | null): Promise<void> {
  const asset = await db('assets').where('id', id).first();
  if (!asset) throw new AssetNotFoundError(id);

  await db('assets').where('id', id).update({ status: 'deleted', updated_at: new Date() });

  await auditService.log(userId, 'delete', 'asset', id, {
    file_name: asset.file_name,
    previous_status: asset.status,
    google_drive_id: asset.google_drive_id,
  });

  await refreshSearchView().catch(() => {});
}

export async function downloadAsset(
  id: string,
  drive: DriveService = _defaultDriveService
): Promise<{ stream: Readable; asset: Record<string, unknown> }> {
  const asset = await db('assets').where('id', id).whereNot('status', 'deleted').first();
  if (!asset) throw new AssetNotFoundError(id);
  const stream = await drive.downloadFile(asset.google_drive_id as string);
  return { stream, asset: asset as Record<string, unknown> };
}

export async function checkDuplicate(
  fileName: string,
  fileSize: number,
  _md5?: string
): Promise<Record<string, unknown> | null> {
  const asset = await db('assets')
    .where('file_name', fileName)
    .where('file_size_bytes', fileSize)
    .whereNot('status', 'deleted')
    .first();
  return asset ? (asset as Record<string, unknown>) : null;
}

export async function listAssets(filters?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<Record<string, unknown>[]> {
  let query = db('assets');
  if (filters?.status !== undefined) {
    query = query.where('status', filters.status);
  } else {
    query = query.whereNot('status', 'deleted');
  }
  if (filters?.limit) query = query.limit(filters.limit);
  if (filters?.offset) query = query.offset(filters.offset);
  return (await query.orderBy('created_at', 'desc')) as Record<string, unknown>[];
}
