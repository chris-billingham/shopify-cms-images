import { google } from 'googleapis';
import { db } from '../db/connection.js';
import * as auditService from '../services/audit.service.js';
import { refreshSearchView } from '../services/asset.service.js';
import { emitAdminAlert } from '../websocket/handler.js';
import { config } from '../config/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriveChangeFile {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string | null;
  parents?: string[];
  trashed?: boolean | null;
  size?: string | null;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file: DriveChangeFile | null;
}

export interface DriveChangesResult {
  changes: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export interface DriveChangesApi {
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string, pageSize: number): Promise<DriveChangesResult>;
}

// ── Mutable config (injectable for tests) ────────────────────────────────────

export const watcherConfig = { MAX_CONSECUTIVE_FAILURES: 5 };

export const watcherState = { consecutiveFailures: 0, paused: false };

// ── Persistence ───────────────────────────────────────────────────────────────

const TOKEN_KEY = 'drive_start_page_token';

export async function getStoredPageToken(): Promise<string | null> {
  const row = await db('system_settings').where('key', TOKEN_KEY).first();
  return (row?.value as string) ?? null;
}

export async function storePageToken(token: string): Promise<void> {
  await db('system_settings')
    .insert({ key: TOKEN_KEY, value: token, updated_at: new Date() })
    .onConflict('key')
    .merge(['value', 'updated_at']);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectAssetType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('text/')) return 'text';
  if (mimeType === 'application/pdf') return 'document';
  return 'other';
}

// ── Change processing ─────────────────────────────────────────────────────────

async function processChange(change: DriveChange, teamDriveId: string): Promise<void> {
  const { fileId, removed, file } = change;

  // ── Permanently removed from view ──────────────────────────────────────────
  if (removed && !file) {
    const existing = await db('assets').where('google_drive_id', fileId).first();
    if (existing) {
      await db('assets')
        .where('google_drive_id', fileId)
        .update({ status: 'deleted', updated_at: new Date() });
    }
    return;
  }

  if (!file) return;

  // ── Trashed ───────────────────────────────────────────────────────────────
  if (file.trashed) {
    const existing = await db('assets').where('google_drive_id', fileId).first();
    if (existing && existing.status !== 'archived') {
      await db('assets')
        .where('google_drive_id', fileId)
        .update({ status: 'archived', updated_at: new Date() });
      await auditService.log(null, 'drive_moved_out', 'asset', existing.id as string, {
        google_drive_id: fileId,
        file_name: existing.file_name as string,
        previous_status: existing.status as string,
      });
    }
    return;
  }

  // Determine whether this file is in the monitored drive
  const inTeamDrive = !teamDriveId || !file.parents || file.parents.includes(teamDriveId);

  const existing = await db('assets').where('google_drive_id', fileId).first();

  // ── New file ───────────────────────────────────────────────────────────────
  if (!existing) {
    if (inTeamDrive) {
      const assetType = detectAssetType(file.mimeType);
      await db('assets').insert({
        file_name: file.name,
        asset_type: assetType,
        mime_type: file.mimeType,
        file_size_bytes: file.size ? parseInt(file.size, 10) : null,
        google_drive_id: fileId,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
        uploaded_by: null,
      });
    }
    return;
  }

  // ── Moved out of team drive ────────────────────────────────────────────────
  if (!inTeamDrive) {
    if (existing.status === 'active') {
      await db('assets')
        .where('google_drive_id', fileId)
        .update({ status: 'archived', updated_at: new Date() });
      await auditService.log(null, 'drive_moved_out', 'asset', existing.id as string, {
        google_drive_id: fileId,
        file_name: existing.file_name as string,
        previous_status: existing.status as string,
      });
    }
    return;
  }

  // ── Moved back in (archived → active) ─────────────────────────────────────
  if (existing.status === 'archived') {
    await db('assets')
      .where('google_drive_id', fileId)
      .update({ status: 'active', updated_at: new Date() });
    return;
  }

  // ── Rename ─────────────────────────────────────────────────────────────────
  if (file.name !== existing.file_name) {
    const oldName = existing.file_name as string;
    await db('assets')
      .where('google_drive_id', fileId)
      .update({ file_name: file.name, updated_at: new Date() });
    await auditService.log(null, 'drive_rename', 'asset', existing.id as string, {
      google_drive_id: fileId,
      old_file_name: oldName,
      new_file_name: file.name,
    });
  }

  // ── Thumbnail invalidation (any content change to an active file) ──────────
  if (existing.thumbnail_url) {
    await db('assets')
      .where('google_drive_id', fileId)
      .update({ thumbnail_url: null, thumb_expires_at: null, updated_at: new Date() });
  }
}

// ── Default Drive Changes API (production) ────────────────────────────────────

function createDefaultDriveChangesApi(): DriveChangesApi {
  const teamDriveId = config.GOOGLE_TEAM_DRIVE_ID;

  let _drive: ReturnType<typeof google.drive> | null = null;
  function getDrive() {
    if (_drive) return _drive;
    const credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    _drive = google.drive({ version: 'v3', auth });
    return _drive;
  }

  return {
    async getStartPageToken(): Promise<string> {
      const drive = getDrive();
      const res = await drive.changes.getStartPageToken({
        supportsAllDrives: true,
        driveId: teamDriveId,
      });
      return res.data.startPageToken!;
    },
    async listChanges(pageToken: string, pageSize: number): Promise<DriveChangesResult> {
      const drive = getDrive();
      const res = await drive.changes.list({
        pageToken,
        pageSize,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        driveId: teamDriveId,
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,md5Checksum,parents,trashed,size))',
      });
      return {
        changes: (res.data.changes ?? []) as DriveChange[],
        nextPageToken: res.data.nextPageToken ?? undefined,
        newStartPageToken: res.data.newStartPageToken ?? undefined,
      };
    },
  };
}

// ── Main watcher ──────────────────────────────────────────────────────────────

export async function runDriveWatcher(options?: {
  driveChangesApi?: DriveChangesApi;
  batchSize?: number;
  teamDriveId?: string;
}): Promise<void> {
  if (watcherState.paused) return;

  const api = options?.driveChangesApi ?? createDefaultDriveChangesApi();
  const batchSize = options?.batchSize ?? 100;
  const teamDriveId = options?.teamDriveId ?? config.GOOGLE_TEAM_DRIVE_ID;

  try {
    // Get or initialise the start page token
    let token = await getStoredPageToken();
    if (!token) {
      token = await api.getStartPageToken();
      await storePageToken(token);
    }

    // Process changes page by page with checkpointing
    let hasMore = true;
    while (hasMore) {
      const result = await api.listChanges(token, batchSize);

      for (const change of result.changes) {
        await processChange(change, teamDriveId);
      }

      if (result.nextPageToken) {
        // Checkpoint before starting the next batch
        token = result.nextPageToken;
        await storePageToken(token);
      } else {
        // End of changes — record the new start page token for the next poll
        if (result.newStartPageToken) {
          await storePageToken(result.newStartPageToken);
        }
        hasMore = false;
      }
    }

    await refreshSearchView().catch(() => {});
    watcherState.consecutiveFailures = 0;
  } catch (err) {
    watcherState.consecutiveFailures++;
    if (watcherState.consecutiveFailures >= watcherConfig.MAX_CONSECUTIVE_FAILURES) {
      watcherState.paused = true;
      emitAdminAlert({
        message: `Drive watcher paused after ${watcherState.consecutiveFailures} consecutive failures. Last error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    throw err;
  }
}
