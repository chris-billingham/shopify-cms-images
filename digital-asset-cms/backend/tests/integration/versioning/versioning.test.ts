import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';
import { driveService } from '../../../src/services/drive.service.js';

// ── Spies ─────────────────────────────────────────────────────────────────────

const uploadSpy = vi.spyOn(driveService, 'uploadFile');
const trashSpy = vi.spyOn(driveService, 'trashFile');

// ── Helpers ───────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env['JWT_SECRET']!;

function buildMultipartBody(
  boundary: string,
  fileName: string,
  mimeType: string,
  fileData: Buffer
): Buffer {
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n');
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);
}

let driveCounter = 0;
function nextDriveId(): string {
  return `ver-drive-${++driveCounter}`;
}

// ── Suite setup ───────────────────────────────────────────────────────────────

let app: FastifyInstance;
let adminUserId: string;
let editorUserId: string;
let adminToken: string;
let editorToken: string;

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();

  const [admin] = await db('users')
    .insert({ email: 'ver-admin@test.com', name: 'Admin', role: 'admin', status: 'active' })
    .returning('id');
  adminUserId = admin.id;
  adminToken = createAccessToken(adminUserId, 'admin', JWT_SECRET);

  const [editor] = await db('users')
    .insert({ email: 'ver-editor@test.com', name: 'Editor', role: 'editor', status: 'active' })
    .returning('id');
  editorUserId = editor.id;
  editorToken = createAccessToken(editorUserId, 'editor', JWT_SECRET);
});

afterAll(async () => {
  const db = getTestDb();
  await db('audit_log').delete().catch(() => {});
  await db('asset_products').delete().catch(() => {});
  await db('assets').delete().catch(() => {});
  await db('products').delete().catch(() => {});
  await db('users').whereIn('id', [adminUserId, editorUserId]).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  uploadSpy.mockResolvedValue({ id: nextDriveId(), webViewLink: 'https://drive.google.com/ver-test' });
  trashSpy.mockResolvedValue(undefined);
});

// ── 7.T1 — Successful version replace ────────────────────────────────────────

describe('7.T1 — Successful version replace', () => {
  it('creates a new version, archives the original, moves links, copies tags, logs audit', async () => {
    const db = getTestDb();

    // Create a product for linking
    const [product] = await db('products')
      .insert({ title: 'Ver Product', status: 'active' })
      .returning('id');

    // Create original asset with tags
    const [origAsset] = await db('assets')
      .insert({
        file_name: 'original.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: `orig-drive-${Date.now()}`,
        status: 'active',
        tags: JSON.stringify({ colour: 'red', season: 'summer' }),
        version: 1,
        uploaded_by: editorUserId,
      })
      .returning('*');

    // Link original asset to product
    await db('asset_products').insert({
      asset_id: origAsset.id,
      product_id: product.id,
      role: 'hero',
      sort_order: 0,
    });

    const newDriveId = nextDriveId();
    uploadSpy.mockResolvedValueOnce({ id: newDriveId, webViewLink: 'https://drive.google.com/new' });

    const boundary = '----VerBoundaryT1';
    const body = buildMultipartBody(boundary, 'replacement.jpg', 'image/jpeg', Buffer.from('new-file-bytes'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/assets/${origAsset.id}/replace`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const newAsset = JSON.parse(res.body) as Record<string, unknown>;

    // New asset has version = 2 and parent_asset_id = original
    expect(newAsset['version']).toBe(2);
    expect(newAsset['parent_asset_id']).toBe(origAsset.id);
    expect(newAsset['status']).toBe('active');
    expect(newAsset['google_drive_id']).toBe(newDriveId);

    // Tags were copied
    const newTags = newAsset['tags'] as Record<string, string>;
    expect(newTags['colour']).toBe('red');
    expect(newTags['season']).toBe('summer');

    // Old asset is now archived
    const oldInDb = await db('assets').where('id', origAsset.id).first();
    expect(oldInDb.status).toBe('archived');

    // Product link moved to new asset
    const links = await db('asset_products').where('product_id', product.id);
    expect(links).toHaveLength(1);
    expect(links[0].asset_id).toBe(newAsset['id']);

    // Audit log has a 'version' entry on the new asset
    const auditEntry = await db('audit_log')
      .where('entity_id', newAsset['id'])
      .where('action', 'version')
      .first();
    expect(auditEntry).toBeDefined();
    const details = auditEntry.details as Record<string, unknown>;
    expect(details['previous_version']).toBe(1);
    expect(details['new_version']).toBe(2);
    expect(details['previous_drive_id']).toBe(origAsset.google_drive_id);
    expect(details['new_drive_id']).toBe(newDriveId);
  });
});

// ── 7.T2 — Transactional rollback ────────────────────────────────────────────

describe('7.T2 — Transactional rollback on DB failure', () => {
  it('rolls back when DB insert fails, leaves original intact, cleans up Drive file', async () => {
    const db = getTestDb();

    // Create original asset
    const origDriveId = `orig-drive-rollback-${Date.now()}`;
    const [origAsset] = await db('assets')
      .insert({
        file_name: 'rollback-test.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 512,
        google_drive_id: origDriveId,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
        uploaded_by: editorUserId,
      })
      .returning('*');

    // Pre-insert a conflicting asset with the drive ID the mock will return,
    // so the transaction's INSERT INTO assets fails with a unique constraint violation.
    const conflictDriveId = `conflict-drive-${Date.now()}`;
    uploadSpy.mockResolvedValueOnce({ id: conflictDriveId, webViewLink: null });

    await db('assets').insert({
      file_name: 'conflict-placeholder.jpg',
      asset_type: 'image',
      mime_type: 'image/jpeg',
      file_size_bytes: 1,
      google_drive_id: conflictDriveId,
      status: 'active',
      tags: JSON.stringify({}),
      version: 1,
    });

    const boundary = '----VerBoundaryT2';
    const body = buildMultipartBody(boundary, 'replacement.jpg', 'image/jpeg', Buffer.from('bytes'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/assets/${origAsset.id}/replace`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body,
    });

    // Should fail (500 or 400/409 — any non-201)
    expect(res.statusCode).not.toBe(201);

    // Original asset is unchanged
    const origInDb = await db('assets').where('id', origAsset.id).first();
    expect(origInDb.status).toBe('active');
    expect(origInDb.google_drive_id).toBe(origDriveId);

    // No new asset was created for this file
    const newAssets = await db('assets').where('google_drive_id', conflictDriveId);
    // Only the pre-inserted conflict placeholder should exist (1 row)
    expect(newAssets).toHaveLength(1);
    expect(newAssets[0].id).not.toBe(origAsset.id);

    // Drive cleanup was attempted for the uploaded (conflict) file
    expect(trashSpy).toHaveBeenCalledWith(conflictDriveId);

    // Cleanup
    await db('asset_products').where('asset_id', origAsset.id).delete().catch(() => {});
    await db('audit_log').where('entity_id', origAsset.id).delete().catch(() => {});
    await db('assets').whereIn('id', [origAsset.id, newAssets[0].id]).delete().catch(() => {});
  });
});

// ── 7.T3 — Version history ────────────────────────────────────────────────────

describe('7.T3 — Version history', () => {
  it('returns all three versions in order after two replacements', async () => {
    const db = getTestDb();

    // Create v1
    const v1DriveId = `hist-drive-v1-${Date.now()}`;
    const [v1] = await db('assets')
      .insert({
        file_name: 'history-test.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: v1DriveId,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
        uploaded_by: editorUserId,
      })
      .returning('*');

    // Replace v1 -> v2
    const v2DriveId = nextDriveId();
    uploadSpy.mockResolvedValueOnce({ id: v2DriveId, webViewLink: null });
    const boundary2 = '----VerBoundaryT3a';
    const body2 = buildMultipartBody(boundary2, 'v2.jpg', 'image/jpeg', Buffer.from('v2-bytes'));
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/assets/${v1.id}/replace`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary2}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body2,
    });
    expect(res2.statusCode).toBe(201);
    const v2 = JSON.parse(res2.body) as Record<string, unknown>;
    expect(v2['version']).toBe(2);

    // Replace v2 -> v3
    const v3DriveId = nextDriveId();
    uploadSpy.mockResolvedValueOnce({ id: v3DriveId, webViewLink: null });
    const boundary3 = '----VerBoundaryT3b';
    const body3 = buildMultipartBody(boundary3, 'v3.jpg', 'image/jpeg', Buffer.from('v3-bytes'));
    const res3 = await app.inject({
      method: 'POST',
      url: `/api/assets/${v2['id']}/replace`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary3}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body3,
    });
    expect(res3.statusCode).toBe(201);
    const v3 = JSON.parse(res3.body) as Record<string, unknown>;
    expect(v3['version']).toBe(3);

    // Call GET /api/assets/:id/versions on v3 (latest)
    const versRes = await app.inject({
      method: 'GET',
      url: `/api/assets/${v3['id']}/versions`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(versRes.statusCode).toBe(200);
    const { versions } = JSON.parse(versRes.body) as { versions: Array<Record<string, unknown>> };

    expect(versions).toHaveLength(3);
    // Ordered by version ASC
    expect(versions[0]!['version']).toBe(1);
    expect(versions[1]!['version']).toBe(2);
    expect(versions[2]!['version']).toBe(3);

    // Correct parent references
    expect(versions[0]!['parent_asset_id']).toBeNull();
    expect(versions[1]!['parent_asset_id']).toBe(v1.id);
    expect(versions[2]!['parent_asset_id']).toBe(v2['id']);
  });
});
