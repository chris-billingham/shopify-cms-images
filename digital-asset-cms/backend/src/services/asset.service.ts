import { Readable } from 'stream';
import { db } from '../db/connection.js';
import { driveService as _defaultDriveService, type DriveService } from './drive.service.js';
import * as auditService from './audit.service.js';
import { getSetting, DRIVE_FOLDER_KEY } from './settings.service.js';
import { config } from '../config/index.js';
import { generateThumbnail, deleteThumbnail } from './thumbnail.service.js';

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

export class AssetNameConflictError extends Error {
  constructor(name: string) {
    super(`An asset named "${name}" already exists`);
    this.name = 'AssetNameConflictError';
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
  const activeFolderId = await getSetting(DRIVE_FOLDER_KEY) ?? config.GOOGLE_DRIVE_FOLDER_ID;
  const { id: googleDriveId, webViewLink } = await drive.uploadFile(stream, {
    name: fileName,
    mimeType,
    size: fileSizeBytes,
  }, activeFolderId ?? undefined);

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

  // Generate thumbnail for raster images — non-fatal if it fails
  const assetId = asset['id'] as string;
  const thumbnailUrl = await generateThumbnail(assetId, buffer, mimeType).catch(() => null);
  if (thumbnailUrl) {
    await db('assets').where('id', assetId).update({ thumbnail_url: thumbnailUrl });
    asset = { ...asset, thumbnail_url: thumbnailUrl };
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
  altText?: string | null;
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

  if (changes.altText !== undefined) {
    updateData['alt_text'] = changes.altText;
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
  await deleteThumbnail(id);

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

export interface ReplaceAssetInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export async function replaceAsset(
  id: string,
  input: ReplaceAssetInput,
  userId: string | null,
  drive: DriveService = _defaultDriveService
): Promise<Record<string, unknown>> {
  const oldAsset = await db('assets').where('id', id).whereNot('status', 'deleted').first();
  if (!oldAsset) throw new AssetNotFoundError(id);

  const { fileName, mimeType, buffer } = input;
  const fileSizeBytes = buffer.length;
  const { assetType } = validateMimeAndSize(mimeType, fileSizeBytes);

  const stream = Readable.from(buffer);
  const activeFolderId = await getSetting(DRIVE_FOLDER_KEY) ?? config.GOOGLE_DRIVE_FOLDER_ID;
  const { id: newDriveId, webViewLink } = await drive.uploadFile(stream, {
    name: fileName,
    mimeType,
    size: fileSizeBytes,
  }, activeFolderId ?? undefined);

  let newAsset: Record<string, unknown>;
  try {
    await db.transaction(async (trx) => {
      const [inserted] = await trx('assets')
        .insert({
          file_name: fileName,
          asset_type: assetType,
          mime_type: mimeType,
          file_size_bytes: fileSizeBytes,
          google_drive_id: newDriveId,
          google_drive_url: webViewLink || null,
          status: 'active',
          tags: JSON.stringify(oldAsset.tags ?? {}),
          version: (oldAsset.version as number) + 1,
          parent_asset_id: oldAsset.id,
          uploaded_by: userId,
        })
        .returning('*');
      newAsset = inserted as Record<string, unknown>;

      await trx('asset_products')
        .where('asset_id', oldAsset.id)
        .update({ asset_id: newAsset['id'] });

      await trx('assets')
        .where('id', oldAsset.id)
        .update({ status: 'archived', updated_at: new Date() });

      await trx('audit_log').insert({
        user_id: userId,
        action: 'version',
        entity_type: 'asset',
        entity_id: newAsset['id'],
        details: JSON.stringify({
          previous_version: oldAsset.version,
          new_version: newAsset['version'],
          previous_drive_id: oldAsset.google_drive_id,
          new_drive_id: newDriveId,
        }),
      });
    });
  } catch (err) {
    await drive.trashFile(newDriveId).catch(() => {});
    throw err;
  }

  // Thumbnail for new asset; clear stale thumbnail for archived one
  await deleteThumbnail(id);
  const newAssetId = newAsset!['id'] as string;
  const thumbnailUrl = await generateThumbnail(newAssetId, buffer, mimeType).catch(() => null);
  if (thumbnailUrl) {
    await db('assets').where('id', newAssetId).update({ thumbnail_url: thumbnailUrl });
    newAsset = { ...newAsset!, thumbnail_url: thumbnailUrl };
  }

  await refreshSearchView().catch(() => {});
  return newAsset!;
}

export async function bulkTagAssets(
  ids: string[],
  tags: Record<string, string>,
  mode: 'merge' | 'replace',
  userId: string | null
): Promise<number> {
  let updated = 0;
  for (const id of ids) {
    const asset = await db('assets').where('id', id).whereNot('status', 'deleted').first();
    if (!asset) continue;
    const currentTags = (asset.tags ?? {}) as Record<string, string>;
    const newTags = mode === 'merge' ? { ...currentTags, ...tags } : tags;
    await db('assets').where('id', id).update({ tags: JSON.stringify(newTags), updated_at: new Date() });
    await auditService.log(userId, 'tag_change', 'asset', id, { mode, applied_tags: tags });
    updated++;
  }
  if (updated > 0) await refreshSearchView().catch(() => {});
  return updated;
}

export async function renameAsset(
  id: string,
  newFileName: string,
  updatedAt: Date | string,
  userId: string | null,
  drive: typeof _defaultDriveService = _defaultDriveService
): Promise<Record<string, unknown>> {
  const asset = await db('assets').where('id', id).whereNot('status', 'deleted').first();
  if (!asset) throw new AssetNotFoundError(id);

  const existing = new Date(asset.updated_at).getTime();
  const requested = new Date(updatedAt).getTime();
  if (existing !== requested) throw new OptimisticLockError();

  // Validate extension unchanged
  const oldExt = (asset.file_name as string).slice((asset.file_name as string).lastIndexOf('.'));
  const newExt = newFileName.slice(newFileName.lastIndexOf('.'));
  if (oldExt.toLowerCase() !== newExt.toLowerCase()) {
    throw new AssetValidationError('EXTENSION_CHANGE', 'File extension cannot be changed');
  }

  // Case-insensitive uniqueness check
  const conflict = await db('assets')
    .whereNot('id', id)
    .whereNot('status', 'deleted')
    .whereRaw('LOWER(file_name) = LOWER(?)', [newFileName])
    .first();
  if (conflict) throw new AssetNameConflictError(newFileName);

  const oldFileName = asset.file_name as string;

  const [updated] = await db('assets')
    .where('id', id)
    .update({ file_name: newFileName, updated_at: new Date() })
    .returning('*');

  try {
    await drive.renameFile(asset.google_drive_id as string, newFileName);
  } catch (err) {
    // Roll back DB on Drive failure
    await db('assets').where('id', id).update({ file_name: oldFileName, updated_at: asset.updated_at });
    throw err;
  }

  await auditService.log(userId, 'rename', 'asset', id, { old_name: oldFileName, new_name: newFileName });
  await refreshSearchView().catch(() => {});

  return updated as Record<string, unknown>;
}

export async function getAssetVersions(id: string): Promise<Record<string, unknown>[]> {
  const asset = await db('assets').where('id', id).first();
  if (!asset) throw new AssetNotFoundError(id);

  const result = await db.raw<{ rows: Record<string, unknown>[] }>(
    `WITH RECURSIVE versions AS (
       SELECT * FROM assets WHERE id = ?
       UNION ALL
       SELECT a.* FROM assets a
       JOIN versions v ON a.id = v.parent_asset_id
     )
     SELECT * FROM versions ORDER BY version ASC`,
    [id]
  );

  return result.rows;
}
