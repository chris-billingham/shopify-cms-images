import path from 'path';
import os from 'os';
import fs from 'fs';
import type { Readable } from 'stream';
import archiver from 'archiver';
import { db } from '../db/connection.js';
import { driveService as defaultDriveService, type DriveService } from '../services/drive.service.js';
import { createJob, setJobRunning, updateJobProgress, completeJob, failJob } from '../services/job.service.js';
import { config } from '../config/index.js';

// ── Error type ────────────────────────────────────────────────────────────────

export class BulkDownloadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BulkDownloadError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Submit: validate, estimate, create job ────────────────────────────────────

export async function submitBulkDownload(
  assetIds: string[],
  userId: string
): Promise<{ jobId: string; totalSizeBytes: number; assetCount: number }> {
  const max = config.BULK_DOWNLOAD_MAX_ASSETS;
  if (assetIds.length > max) {
    throw new BulkDownloadError('TOO_MANY_ASSETS', `Maximum ${max} assets per bulk download request`);
  }
  if (assetIds.length === 0) {
    throw new BulkDownloadError('NO_ASSETS', 'At least one asset ID is required');
  }

  const assets = await db('assets')
    .whereIn('id', assetIds)
    .where('status', 'active')
    .select('id', 'file_size_bytes');

  // file_size_bytes is BIGINT → pg returns it as a string; coerce to number
  const totalSizeBytes: number = assets.reduce(
    (sum: number, a: { file_size_bytes: number | string | null }) => sum + Number(a.file_size_bytes ?? 0),
    0
  );

  const maxSizeBytes = config.BULK_DOWNLOAD_MAX_SIZE_GB * 1024 * 1024 * 1024;
  if (totalSizeBytes > maxSizeBytes) {
    throw new BulkDownloadError(
      'SIZE_LIMIT_EXCEEDED',
      `Estimated total size ${(totalSizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB exceeds the ${config.BULK_DOWNLOAD_MAX_SIZE_GB} GB limit`
    );
  }

  const job = await createJob('bulk_download', userId);
  return { jobId: job.id, totalSizeBytes, assetCount: assets.length };
}

// ── Process: stream from Drive, build ZIP, update progress ────────────────────

export async function processBulkDownload(
  jobId: string,
  assetIds: string[],
  driveService: DriveService = defaultDriveService
): Promise<void> {
  await setJobRunning(jobId);

  const timeoutMs = config.BULK_DOWNLOAD_TIMEOUT_HOURS * 60 * 60 * 1000;
  let timedOut = false;
  const timeoutHandle = setTimeout(() => { timedOut = true; }, timeoutMs);

  try {
    const assets = await db('assets')
      .whereIn('id', assetIds)
      .where('status', 'active')
      .select('id', 'file_name', 'google_drive_id');

    const tmpDir = path.join(os.tmpdir(), 'bulk-downloads');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, `${jobId}.zip`);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    const finishPromise = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.on('warning', (err) => {
        if (err.code !== 'ENOENT') reject(err);
      });
    });

    archive.pipe(output);

    let processed = 0;
    for (const asset of assets) {
      if (timedOut) throw new Error('Bulk download timed out after the configured limit');
      const stream = await driveService.downloadFile(asset.google_drive_id);
      archive.append(stream as Readable, { name: asset.file_name });
      processed++;
      await updateJobProgress(jobId, Math.round((processed / assets.length) * 90));
    }

    archive.finalize();
    await finishPromise;

    clearTimeout(timeoutHandle);
    await completeJob(jobId, {
      download_url: `/api/jobs/${jobId}/download`,
      file_count: assets.length,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    await failJob(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ── ZIP cleanup: delete files older than configured retention ─────────────────

export async function cleanupBulkDownloadZips(): Promise<void> {
  const tmpDir = path.join(os.tmpdir(), 'bulk-downloads');
  try {
    const files = await fs.promises.readdir(tmpDir);
    const retentionMs = config.BULK_DOWNLOAD_RETENTION_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.zip')) continue;
      const filePath = path.join(tmpDir, file);
      const stat = await fs.promises.stat(filePath);
      if (now - stat.mtimeMs > retentionMs) {
        await fs.promises.unlink(filePath);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
