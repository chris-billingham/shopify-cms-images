import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { runJobCleanup } from '../../../src/jobs/job-cleanup.js';
import { runAuditCleanup } from '../../../src/jobs/audit-cleanup.js';
import { runOrphanCleanup } from '../../../src/jobs/orphan-cleanup.js';
import { driveService } from '../../../src/services/drive.service.js';
import { randomUUID } from 'crypto';

// ── Drive spy ─────────────────────────────────────────────────────────────────

const getFileSpy = vi.spyOn(driveService, 'getFile');

// ── State ─────────────────────────────────────────────────────────────────────

let cleanupUserId: string;

beforeAll(async () => {
  await runMigrations();
  const db = getTestDb();
  const [user] = await db('users')
    .insert({ email: 'cleanup-user@test.com', name: 'Cleanup', role: 'admin', status: 'active' })
    .returning('id');
  cleanupUserId = user.id;
});

afterAll(async () => {
  const db = getTestDb();
  await db('audit_log').where('user_id', cleanupUserId).delete();
  await db('users').where('id', cleanupUserId).delete();
  await destroyTestDb();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 6.T4 — Job cleanup ────────────────────────────────────────────────────────

describe('6.T4 — Job cleanup', () => {
  it('deletes completed jobs older than 7 days and failed jobs older than 30 days, keeps recent ones', async () => {
    const db = getTestDb();

    // Completed job 8 days old — should be deleted
    const oldCompletedId = randomUUID();
    const oldCompletedDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db('background_jobs').insert({
      id: oldCompletedId,
      type: 'bulk_download',
      status: 'completed',
      user_id: cleanupUserId,
      progress: 100,
      result: JSON.stringify({}),
      updated_at: oldCompletedDate,
      created_at: oldCompletedDate,
    });

    // Failed job 31 days old — should be deleted
    const oldFailedId = randomUUID();
    const oldFailedDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db('background_jobs').insert({
      id: oldFailedId,
      type: 'bulk_download',
      status: 'failed',
      user_id: cleanupUserId,
      progress: 0,
      result: JSON.stringify({}),
      error: 'Something went wrong',
      updated_at: oldFailedDate,
      created_at: oldFailedDate,
    });

    // Completed job 2 days old — should NOT be deleted
    const recentCompletedId = randomUUID();
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db('background_jobs').insert({
      id: recentCompletedId,
      type: 'bulk_download',
      status: 'completed',
      user_id: cleanupUserId,
      progress: 100,
      result: JSON.stringify({}),
      updated_at: recentDate,
      created_at: recentDate,
    });

    const result = await runJobCleanup();
    expect(result.deleted).toBeGreaterThanOrEqual(2);

    // Old completed should be gone
    const oldCompleted = await db('background_jobs').where('id', oldCompletedId).first();
    expect(oldCompleted).toBeUndefined();

    // Old failed should be gone
    const oldFailed = await db('background_jobs').where('id', oldFailedId).first();
    expect(oldFailed).toBeUndefined();

    // Recent completed should still exist
    const recentCompleted = await db('background_jobs').where('id', recentCompletedId).first();
    expect(recentCompleted).toBeDefined();

    // Cleanup
    await db('background_jobs').where('id', recentCompletedId).delete();
  });
});

// ── 6.T5 — Audit log cleanup ──────────────────────────────────────────────────

describe('6.T5 — Audit log cleanup', () => {
  it('deletes audit entries older than 180 days, keeps recent ones', async () => {
    const db = getTestDb();

    // Entry 181 days old — should be deleted
    const oldEntryDate = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
    const [oldEntry] = await db('audit_log')
      .insert({
        user_id: cleanupUserId,
        action: 'download',
        entity_type: 'asset',
        entity_id: randomUUID(),
        details: JSON.stringify({ file_name: 'old.jpg', source: 'single' }),
        created_at: oldEntryDate,
      })
      .returning('id');

    // Entry 10 days old — should NOT be deleted
    const recentEntryDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const [recentEntry] = await db('audit_log')
      .insert({
        user_id: cleanupUserId,
        action: 'download',
        entity_type: 'asset',
        entity_id: randomUUID(),
        details: JSON.stringify({ file_name: 'recent.jpg', source: 'single' }),
        created_at: recentEntryDate,
      })
      .returning('id');

    const result = await runAuditCleanup();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    // Old entry should be gone
    const old = await db('audit_log').where('id', oldEntry.id).first();
    expect(old).toBeUndefined();

    // Recent entry should still exist
    const recent = await db('audit_log').where('id', recentEntry.id).first();
    expect(recent).toBeDefined();

    // Cleanup
    await db('audit_log').where('id', recentEntry.id).delete();
  });
});

// ── 6.T6 — Orphan cleanup ─────────────────────────────────────────────────────

describe('6.T6 — Orphan cleanup', () => {
  it('logs a discrepancy when an asset has no corresponding Drive file', async () => {
    const db = getTestDb();

    const orphanDriveId = `orphan-drive-${randomUUID()}`;
    const [asset] = await db('assets')
      .insert({
        file_name: 'orphan.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: orphanDriveId,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
        uploaded_by: cleanupUserId,
      })
      .returning('id');

    // Mock Drive to throw for this file (simulating no corresponding Drive file)
    getFileSpy.mockRejectedValue(new Error('File not found'));

    const result = await runOrphanCleanup();
    expect(result.orphans).toBeGreaterThanOrEqual(1);

    // An audit_log entry should have been created
    const logEntry = await db('audit_log')
      .where('action', 'orphan_detected')
      .where('entity_id', asset.id)
      .first();
    expect(logEntry).toBeDefined();
    expect(logEntry.details).toMatchObject({
      google_drive_id: orphanDriveId,
      file_name: 'orphan.jpg',
    });

    // Cleanup
    await db('audit_log').where('entity_id', asset.id).where('action', 'orphan_detected').delete();
    await db('assets').where('id', asset.id).delete();
  });
});
