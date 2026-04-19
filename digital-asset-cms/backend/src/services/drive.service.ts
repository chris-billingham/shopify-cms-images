import Bottleneck from 'bottleneck';
import { google, type drive_v3 } from 'googleapis';
import type { Readable } from 'stream';
import { withRetry, NonRetryableError, HttpError, type RetryOptions } from '../utils/retry.js';
import { config } from '../config/index.js';

// ── Error types ───────────────────────────────────────────────────────────────

export class DriveStorageFullError extends NonRetryableError {
  readonly code = 'DRIVE_STORAGE_FULL' as const;

  constructor() {
    super('Google Drive storage quota exceeded — contact your Drive administrator to free space or increase the quota');
    this.name = 'DriveStorageFullError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  md5Checksum?: string;
  thumbnailLink?: string;
  size?: string;
  webViewLink?: string;
}

export interface ListFilesOptions {
  pageToken?: string;
  pageSize?: number;
  q?: string;
}

export interface ListFilesResult {
  files: DriveFile[];
  nextPageToken?: string;
}

// ── Default rate limiter: 120 req / 100 s (Drive quota is 12,000 / 100 s) ────

const defaultLimiter = new Bottleneck({
  maxConcurrent: 10,
  reservoir: 120,
  reservoirRefreshAmount: 120,
  reservoirRefreshInterval: 100_000,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStorageQuotaExceeded(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { errors?: Array<{ reason?: string }> };
    return e.errors?.some((r) => r.reason === 'storageQuotaExceeded') ?? false;
  }
  return false;
}

function normaliseError(err: unknown): Error {
  if (err instanceof DriveStorageFullError || err instanceof HttpError || err instanceof NonRetryableError) {
    return err;
  }
  if (err && typeof err === 'object') {
    const e = err as { code?: number | string; status?: number; message?: string };
    const raw = typeof e.code === 'number' ? e.code : e.status;
    if (typeof raw === 'number' && raw >= 400) {
      return new HttpError(raw, e.message ?? 'Drive API error');
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createDriveService(options?: {
  driveClient?: drive_v3.Drive;
  limiter?: Bottleneck;
  teamDriveId?: string;
  retryOptions?: RetryOptions;
}) {
  const limiter = options?.limiter ?? defaultLimiter;
  const teamDriveId = options?.teamDriveId ?? config.GOOGLE_TEAM_DRIVE_ID;
  const uploadParentId = config.GOOGLE_DRIVE_FOLDER_ID ?? teamDriveId;
  const retryOpts = options?.retryOptions ?? {};

  let _drive: drive_v3.Drive | null = null;
  function getDrive(): drive_v3.Drive {
    if (options?.driveClient) return options.driveClient;
    if (_drive) return _drive;
    const credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    _drive = google.drive({ version: 'v3', auth });
    return _drive;
  }

  async function uploadFile(
    stream: Readable,
    metadata: { name: string; mimeType: string; size?: number }
  ): Promise<{ id: string; webViewLink: string }> {
    return limiter.schedule(() =>
      withRetry(async () => {
        const drive = getDrive();
        try {
          const res = await drive.files.create({
            requestBody: {
              name: metadata.name,
              mimeType: metadata.mimeType,
              parents: [uploadParentId],
            },
            media: { mimeType: metadata.mimeType, body: stream },
            fields: 'id,webViewLink',
            supportsAllDrives: true,
          });
          return { id: res.data.id!, webViewLink: res.data.webViewLink ?? '' };
        } catch (err) {
          if (isStorageQuotaExceeded(err)) throw new DriveStorageFullError();
          throw normaliseError(err);
        }
      }, retryOpts)
    );
  }

  async function downloadFile(driveId: string): Promise<Readable> {
    return limiter.schedule(() =>
      withRetry(async () => {
        const drive = getDrive();
        try {
          const res = await drive.files.get(
            { fileId: driveId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
          );
          return res.data as unknown as Readable;
        } catch (err) {
          throw normaliseError(err);
        }
      }, retryOpts)
    );
  }

  async function getFile(driveId: string): Promise<DriveFile> {
    return limiter.schedule(() =>
      withRetry(async () => {
        const drive = getDrive();
        try {
          const res = await drive.files.get({
            fileId: driveId,
            fields: 'id,name,mimeType,md5Checksum,thumbnailLink,size,webViewLink',
            supportsAllDrives: true,
          });
          return res.data as DriveFile;
        } catch (err) {
          throw normaliseError(err);
        }
      }, retryOpts)
    );
  }

  async function trashFile(driveId: string): Promise<void> {
    return limiter.schedule(() =>
      withRetry(async () => {
        const drive = getDrive();
        try {
          await drive.files.update({
            fileId: driveId,
            requestBody: { trashed: true },
            supportsAllDrives: true,
          });
        } catch (err) {
          throw normaliseError(err);
        }
      }, retryOpts)
    );
  }

  async function getChecksum(driveId: string): Promise<string | null> {
    const file = await getFile(driveId);
    return file.md5Checksum ?? null;
  }

  async function getThumbnailUrl(driveId: string): Promise<string | null> {
    const file = await getFile(driveId);
    return file.thumbnailLink ?? null;
  }

  async function listFiles(opts: ListFilesOptions): Promise<ListFilesResult> {
    return limiter.schedule(() =>
      withRetry(async () => {
        const drive = getDrive();
        try {
          const res = await drive.files.list({
            corpora: 'drive',
            driveId: teamDriveId,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,thumbnailLink,size)',
            pageToken: opts.pageToken,
            pageSize: opts.pageSize ?? 100,
            q: opts.q,
          });
          return {
            files: (res.data.files as DriveFile[]) ?? [],
            nextPageToken: res.data.nextPageToken ?? undefined,
          };
        } catch (err) {
          throw normaliseError(err);
        }
      }, retryOpts)
    );
  }

  return { uploadFile, downloadFile, getFile, trashFile, getChecksum, getThumbnailUrl, listFiles };
}

export type DriveService = ReturnType<typeof createDriveService>;

export const driveService = createDriveService();
