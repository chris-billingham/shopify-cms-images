import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  runDriveWatcher,
  watcherState,
  getStoredPageToken,
  storePageToken,
  type DriveChangesApi,
  type DriveChange,
} from '../../../src/jobs/drive-watcher.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import * as wsHandler from '../../../src/websocket/handler.js';

// ── Spy setup ─────────────────────────────────────────────────────────────────

const alertSpy = vi.spyOn(wsHandler, 'emitAdminAlert');

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEAM_DRIVE_ID = 'test-drive-id'; // matches GOOGLE_TEAM_DRIVE_ID in vitest.config.ts

function dummyChange(n: number): DriveChange {
  return { fileId: `non-existent-${n}`, removed: true, file: null };
}

function makeApi(overrides: Partial<DriveChangesApi>): DriveChangesApi {
  return {
    getStartPageToken: async () => 'initial-token',
    listChanges: async () => ({ changes: [], newStartPageToken: 'fresh-token' }),
    ...overrides,
  };
}

// ── Suite setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  const db = getTestDb();
  await db('audit_log').delete().catch(() => {});
  await db('assets').delete().catch(() => {});
  await db('system_settings').delete().catch(() => {});
  await destroyTestDb();
});

beforeEach(async () => {
  const db = getTestDb();
  await db('system_settings').where('key', 'drive_start_page_token').delete().catch(() => {});
  watcherState.consecutiveFailures = 0;
  watcherState.paused = false;
  vi.clearAllMocks();
});

// ── 10.T1 — New file detection ────────────────────────────────────────────────

describe('10.T1 — New file detection', () => {
  it('creates an asset with uploaded_by=null, empty tags, status=active for a new Drive file', async () => {
    const db = getTestDb();
    const driveId = `new-file-drive-${Date.now()}`;

    const api = makeApi({
      listChanges: async () => ({
        changes: [
          {
            fileId: driveId,
            removed: false,
            file: {
              id: driveId,
              name: 'new-drive-photo.jpg',
              mimeType: 'image/jpeg',
              parents: [TEAM_DRIVE_ID],
              trashed: false,
            },
          },
        ],
        newStartPageToken: 'after-t1',
      }),
    });

    await runDriveWatcher({ driveChangesApi: api, teamDriveId: TEAM_DRIVE_ID });

    const asset = await db('assets').where('google_drive_id', driveId).first();
    expect(asset).toBeDefined();
    expect(asset.file_name).toBe('new-drive-photo.jpg');
    expect(asset.asset_type).toBe('image');
    expect(asset.status).toBe('active');
    expect(asset.uploaded_by).toBeNull();
    const tags = typeof asset.tags === 'string' ? JSON.parse(asset.tags) : asset.tags;
    expect(Object.keys(tags)).toHaveLength(0);

    await db('assets').where('google_drive_id', driveId).delete();
  });
});

// ── 10.T2 — File modification (thumbnail invalidation) ───────────────────────

describe('10.T2 — File modification', () => {
  it('invalidates the thumbnail URL when a change is reported for an existing file', async () => {
    const db = getTestDb();
    const driveId = `mod-drive-${Date.now()}`;

    const [asset] = await db('assets')
      .insert({
        file_name: 'mod-test.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: driveId,
        status: 'active',
        thumbnail_url: 'https://old-thumb.example.com/thumb.jpg',
        tags: JSON.stringify({}),
        version: 1,
      })
      .returning('*');

    const api = makeApi({
      listChanges: async () => ({
        changes: [
          {
            fileId: driveId,
            removed: false,
            file: {
              id: driveId,
              name: 'mod-test.jpg', // same name — not a rename
              mimeType: 'image/jpeg',
              md5Checksum: 'new-md5-checksum',
              parents: [TEAM_DRIVE_ID],
              trashed: false,
            },
          },
        ],
        newStartPageToken: 'after-t2',
      }),
    });

    await runDriveWatcher({ driveChangesApi: api, teamDriveId: TEAM_DRIVE_ID });

    const updated = await db('assets').where('google_drive_id', driveId).first();
    expect(updated.thumbnail_url).toBeNull();

    await db('assets').where('id', asset.id).delete();
  });
});

// ── 10.T3 — File rename ───────────────────────────────────────────────────────

describe('10.T3 — File rename', () => {
  it('updates file_name and writes a drive_rename audit log entry', async () => {
    const db = getTestDb();
    const driveId = `rename-drive-${Date.now()}`;

    const [asset] = await db('assets')
      .insert({
        file_name: 'old-name.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 512,
        google_drive_id: driveId,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
      })
      .returning('*');

    const api = makeApi({
      listChanges: async () => ({
        changes: [
          {
            fileId: driveId,
            removed: false,
            file: {
              id: driveId,
              name: 'new-name.jpg',
              mimeType: 'image/jpeg',
              parents: [TEAM_DRIVE_ID],
              trashed: false,
            },
          },
        ],
        newStartPageToken: 'after-t3',
      }),
    });

    await runDriveWatcher({ driveChangesApi: api, teamDriveId: TEAM_DRIVE_ID });

    const updated = await db('assets').where('google_drive_id', driveId).first();
    expect(updated.file_name).toBe('new-name.jpg');

    const auditEntry = await db('audit_log')
      .where('entity_id', asset.id)
      .where('action', 'drive_rename')
      .first();
    expect(auditEntry).toBeDefined();
    const details = typeof auditEntry.details === 'string'
      ? JSON.parse(auditEntry.details)
      : auditEntry.details;
    expect(details.old_file_name).toBe('old-name.jpg');
    expect(details.new_file_name).toBe('new-name.jpg');

    await db('audit_log').where('entity_id', asset.id).delete();
    await db('assets').where('id', asset.id).delete();
  });
});

// ── 10.T4 — File moved out ────────────────────────────────────────────────────

describe('10.T4 — File moved out', () => {
  it('archives the asset and writes a drive_moved_out audit log entry', async () => {
    const db = getTestDb();
    const driveId = `moveout-drive-${Date.now()}`;

    const [asset] = await db('assets')
      .insert({
        file_name: 'moved-out.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 512,
        google_drive_id: driveId,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
      })
      .returning('*');

    const api = makeApi({
      listChanges: async () => ({
        changes: [
          {
            fileId: driveId,
            removed: false,
            file: {
              id: driveId,
              name: 'moved-out.jpg',
              mimeType: 'image/jpeg',
              parents: ['some-other-drive-id'], // NOT in team drive
              trashed: false,
            },
          },
        ],
        newStartPageToken: 'after-t4',
      }),
    });

    await runDriveWatcher({ driveChangesApi: api, teamDriveId: TEAM_DRIVE_ID });

    const updated = await db('assets').where('google_drive_id', driveId).first();
    expect(updated.status).toBe('archived');

    const auditEntry = await db('audit_log')
      .where('entity_id', asset.id)
      .where('action', 'drive_moved_out')
      .first();
    expect(auditEntry).toBeDefined();

    await db('audit_log').where('entity_id', asset.id).delete();
    await db('assets').where('id', asset.id).delete();
  });
});

// ── 10.T5 — File moved back in ────────────────────────────────────────────────

describe('10.T5 — File moved back in', () => {
  it('restores an archived asset to active when it reappears in the team drive', async () => {
    const db = getTestDb();
    const driveId = `movein-drive-${Date.now()}`;

    await db('assets').insert({
      file_name: 'moved-back.jpg',
      asset_type: 'image',
      mime_type: 'image/jpeg',
      file_size_bytes: 512,
      google_drive_id: driveId,
      status: 'archived', // previously moved out
      tags: JSON.stringify({}),
      version: 1,
    });

    const api = makeApi({
      listChanges: async () => ({
        changes: [
          {
            fileId: driveId,
            removed: false,
            file: {
              id: driveId,
              name: 'moved-back.jpg',
              mimeType: 'image/jpeg',
              parents: [TEAM_DRIVE_ID], // back in team drive
              trashed: false,
            },
          },
        ],
        newStartPageToken: 'after-t5',
      }),
    });

    await runDriveWatcher({ driveChangesApi: api, teamDriveId: TEAM_DRIVE_ID });

    const updated = await db('assets').where('google_drive_id', driveId).first();
    expect(updated.status).toBe('active');

    await db('assets').where('google_drive_id', driveId).delete();
  });
});

// ── 10.T6 — Checkpoint persistence ───────────────────────────────────────────

describe('10.T6 — Checkpoint persistence', () => {
  it('resumes from the checkpointed token after a mid-poll crash', async () => {
    // Batch 1: succeeds, checkpoints 'checkpoint-token'
    // Batch 2: throws → watcher fails
    const listChanges1 = vi.fn()
      .mockResolvedValueOnce({
        changes: [dummyChange(1), dummyChange(2)],
        nextPageToken: 'checkpoint-token',
      })
      .mockRejectedValueOnce(new Error('simulated crash after checkpoint'));

    const api1 = makeApi({
      getStartPageToken: async () => 'start-token',
      listChanges: listChanges1,
    });

    // Run 1: processes batch 1, saves checkpoint, then crashes on batch 2
    await expect(runDriveWatcher({ driveChangesApi: api1 })).rejects.toThrow('simulated crash');

    // DB should have the checkpoint from batch 1
    const savedToken = await getStoredPageToken();
    expect(savedToken).toBe('checkpoint-token');

    // Run 2: should start from 'checkpoint-token', not from 'start-token'
    const listChanges2 = vi.fn().mockResolvedValueOnce({
      changes: [],
      newStartPageToken: 'fresh-token',
    });

    // Reset failure count so run 2 is not affected by run 1's failure
    watcherState.consecutiveFailures = 0;

    const api2 = makeApi({ listChanges: listChanges2 });
    await runDriveWatcher({ driveChangesApi: api2 });

    // First call to listChanges in run 2 must be with 'checkpoint-token'
    expect(listChanges2).toHaveBeenCalledWith('checkpoint-token', expect.any(Number));
  });
});

// ── 10.T7 — Failure alerting ──────────────────────────────────────────────────

describe('10.T7 — Failure alerting', () => {
  it('emits an admin alert and pauses after 5 consecutive failures', async () => {
    const failingApi = makeApi({
      listChanges: async () => { throw new Error('Drive API unavailable'); },
    });

    // Run the watcher 5 times, each time it fails
    for (let i = 0; i < 5; i++) {
      await expect(runDriveWatcher({ driveChangesApi: failingApi })).rejects.toThrow('Drive API unavailable');
    }

    // Alert must have been emitted exactly once (on the 5th failure)
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]![0]).toMatchObject({ message: expect.stringContaining('paused') });

    // Watcher must be paused
    expect(watcherState.paused).toBe(true);
    expect(watcherState.consecutiveFailures).toBe(5);

    // Subsequent run returns early without calling the API
    const listChanges = vi.fn();
    const api = makeApi({ listChanges });
    await runDriveWatcher({ driveChangesApi: api }); // should not throw (paused)
    expect(listChanges).not.toHaveBeenCalled();
  });
});
