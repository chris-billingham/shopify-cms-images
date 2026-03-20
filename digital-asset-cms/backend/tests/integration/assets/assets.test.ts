import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'stream';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';
import { driveService } from '../../../src/services/drive.service.js';

// ── Mock Drive service methods via spies ──────────────────────────────────────
// We spy on the exported driveService object so asset.service.ts (which holds
// the same reference) will call the mocks instead of real Drive APIs.

const uploadSpy = vi.spyOn(driveService, 'uploadFile');
const downloadSpy = vi.spyOn(driveService, 'downloadFile');
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

let driveIdCounter = 0;
function nextDriveId() {
  return `mock-drive-${++driveIdCounter}`;
}

// ── Test suite ────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let adminUserId: string;
let editorUserId: string;
let viewerUserId: string;
let adminToken: string;
let editorToken: string;
let viewerToken: string;

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();

  // Create test users
  const [admin] = await db('users')
    .insert({ email: 'asset-admin@test.com', name: 'Admin', role: 'admin', status: 'active' })
    .returning('id');
  adminUserId = admin.id;
  adminToken = createAccessToken(adminUserId, 'admin', JWT_SECRET);

  const [editor] = await db('users')
    .insert({ email: 'asset-editor@test.com', name: 'Editor', role: 'editor', status: 'active' })
    .returning('id');
  editorUserId = editor.id;
  editorToken = createAccessToken(editorUserId, 'editor', JWT_SECRET);

  const [viewer] = await db('users')
    .insert({ email: 'asset-viewer@test.com', name: 'Viewer', role: 'viewer', status: 'active' })
    .returning('id');
  viewerUserId = viewer.id;
  viewerToken = createAccessToken(viewerUserId, 'viewer', JWT_SECRET);
});

afterAll(async () => {
  const db = getTestDb();
  await db('audit_log').delete().catch(() => {});
  await db('assets').delete().catch(() => {});
  await db('users').whereIn('id', [adminUserId, editorUserId, viewerUserId]).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default Drive mock responses
  uploadSpy.mockResolvedValue({ id: nextDriveId(), webViewLink: 'https://drive.google.com/test' });
  downloadSpy.mockResolvedValue(Readable.from(Buffer.from('file-content')));
  trashSpy.mockResolvedValue(undefined);
});

// ── 3.T4 — Asset creation ─────────────────────────────────────────────────────

describe('3.T4 — Asset creation', () => {
  it('uploads an asset and returns it with correct metadata', async () => {
    const db = getTestDb();
    const boundary = '----TestBoundary4';
    const fileData = Buffer.from('fake-jpeg-bytes');
    const body = buildMultipartBody(boundary, 'hero.jpg', 'image/jpeg', fileData);

    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const asset = JSON.parse(res.body);
    expect(asset.file_name).toBe('hero.jpg');
    expect(asset.mime_type).toBe('image/jpeg');
    expect(asset.asset_type).toBe('image');
    expect(asset.status).toBe('active');
    expect(asset.id).toBeDefined();

    // Assert DB row was created
    const dbAsset = await db('assets').where('id', asset.id).first();
    expect(dbAsset).toBeDefined();
    expect(dbAsset.file_name).toBe('hero.jpg');

    // Assert audit log has an 'upload' entry
    const auditEntry = await db('audit_log')
      .where('entity_id', asset.id)
      .where('action', 'upload')
      .first();
    expect(auditEntry).toBeDefined();
    const details = auditEntry.details as Record<string, unknown>;
    expect(details.file_name).toBe('hero.jpg');
    expect(details.mime_type).toBe('image/jpeg');
    expect(typeof details.file_size_bytes).toBe('number');
    expect(details.google_drive_id).toBeDefined();

    // Assert materialized view was refreshed (asset appears in view)
    const mvRow = await db.raw('SELECT * FROM asset_search_mv WHERE asset_id = ?', [asset.id]);
    expect(mvRow.rows).toHaveLength(1);
    expect(mvRow.rows[0].file_name).toBe('hero.jpg');

    // Cleanup
    await db('audit_log').where('entity_id', asset.id).delete();
    await db('assets').where('id', asset.id).delete();
  });
});

// ── 3.T5 — MIME type validation ──────────────────────────────────────────────

describe('3.T5 — MIME type validation', () => {
  it('rejects a file with an unsupported MIME type', async () => {
    const boundary = '----TestBoundary5a';
    const body = buildMultipartBody(boundary, 'malware.exe', 'application/x-executable', Buffer.from('ELF'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    const body2 = JSON.parse(res.body);
    expect(body2.error.code).toBe('UNSUPPORTED_MIME_TYPE');
    expect(uploadSpy).not.toHaveBeenCalled(); // Drive should never be called
  });

  it('rejects an image/jpeg that exceeds the configured size limit', async () => {
    // MAX_IMAGE_SIZE_MB is 100 by default; we create a buffer of 100MB + 1 byte
    const oversizeBuffer = Buffer.alloc(100 * 1024 * 1024 + 1, 0xff);
    const boundary = '----TestBoundary5b';
    const body = buildMultipartBody(boundary, 'huge.jpg', 'image/jpeg', oversizeBuffer);

    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    const respBody = JSON.parse(res.body);
    expect(respBody.error.code).toBe('FILE_TOO_LARGE');
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

// ── 3.T6 — Optimistic concurrency ────────────────────────────────────────────

describe('3.T6 — Asset update with optimistic concurrency', () => {
  it('returns 200 on PATCH with correct updated_at, then 409 with stale updated_at', async () => {
    const db = getTestDb();

    // Create a test asset directly in DB
    const [asset] = await db('assets')
      .insert({
        file_name: 'concurrency-test.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: `drive-concurrency-${Date.now()}`,
        status: 'active',
        tags: JSON.stringify({}),
        uploaded_by: editorUserId,
      })
      .returning('*');

    const updatedAt = asset.updated_at;

    // First PATCH with correct updated_at — should succeed
    const res1 = await app.inject({
      method: 'PATCH',
      url: `/api/assets/${asset.id}`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${editorToken}`,
      },
      body: JSON.stringify({ tags: { colour: 'Navy' }, updatedAt }),
    });
    expect(res1.statusCode).toBe(200);

    // Second PATCH with the original (now stale) updated_at — should conflict
    const res2 = await app.inject({
      method: 'PATCH',
      url: `/api/assets/${asset.id}`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${editorToken}`,
      },
      body: JSON.stringify({ tags: { colour: 'Red' }, updatedAt }),
    });
    expect(res2.statusCode).toBe(409);
    const conflict = JSON.parse(res2.body);
    expect(conflict.error.code).toBe('CONFLICT');

    // Cleanup
    await db('audit_log').where('entity_id', asset.id).delete().catch(() => {});
    await db('assets').where('id', asset.id).delete();
  });
});

// ── 3.T7 — Soft delete ────────────────────────────────────────────────────────

describe('3.T7 — Soft delete', () => {
  it('marks an asset as deleted, logs it, and excludes it from the default list', async () => {
    const db = getTestDb();

    const [asset] = await db('assets')
      .insert({
        file_name: 'to-delete.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 512,
        google_drive_id: `drive-delete-${Date.now()}`,
        status: 'active',
        tags: JSON.stringify({}),
        uploaded_by: adminUserId,
      })
      .returning('*');

    // Delete as admin
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/assets/${asset.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.statusCode).toBe(200);

    // Asset status should now be 'deleted' in DB
    const dbAsset = await db('assets').where('id', asset.id).first();
    expect(dbAsset.status).toBe('deleted');

    // Audit log should have a 'delete' entry
    const auditEntry = await db('audit_log')
      .where('entity_id', asset.id)
      .where('action', 'delete')
      .first();
    expect(auditEntry).toBeDefined();

    // GET /api/assets (default filter) should NOT return the deleted asset
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/assets',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    const ids = (listBody.assets as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(asset.id);

    // Cleanup
    await db('audit_log').where('entity_id', asset.id).delete().catch(() => {});
    await db('assets').where('id', asset.id).delete();
  });
});

// ── 3.T8 — Duplicate detection ───────────────────────────────────────────────

describe('3.T8 — Duplicate detection', () => {
  it('returns the existing asset for matching fileName + fileSize, null for different values', async () => {
    const db = getTestDb();

    const [asset] = await db('assets')
      .insert({
        file_name: 'duplicate-check.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 8192,
        google_drive_id: `drive-dup-${Date.now()}`,
        status: 'active',
        tags: JSON.stringify({}),
      })
      .returning('*');

    // Matching fileName + fileSize
    const matchRes = await app.inject({
      method: 'GET',
      url: '/api/assets/check-duplicate?fileName=duplicate-check.jpg&fileSize=8192&md5=someHash',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(matchRes.statusCode).toBe(200);
    const matchBody = JSON.parse(matchRes.body);
    expect(matchBody.duplicate).toBe(true);
    expect(matchBody.asset.id).toBe(asset.id);

    // Non-matching values
    const noMatchRes = await app.inject({
      method: 'GET',
      url: '/api/assets/check-duplicate?fileName=different-name.jpg&fileSize=8192',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(noMatchRes.statusCode).toBe(200);
    const noMatchBody = JSON.parse(noMatchRes.body);
    expect(noMatchBody.duplicate).toBe(false);
    expect(noMatchBody.asset).toBeNull();

    // Cleanup
    await db('assets').where('id', asset.id).delete();
  });
});

// ── 3.T9 — Idempotency ───────────────────────────────────────────────────────

describe('3.T9 — Idempotency', () => {
  it('returns the same 201 response for a repeated upload with the same Idempotency-Key', async () => {
    const db = getTestDb();
    const boundary = '----TestBoundary9';
    const fileData = Buffer.from('idempotency-test-bytes');
    const body = buildMultipartBody(boundary, 'idem-test.jpg', 'image/jpeg', fileData);
    const idempotencyKey = `test-idem-key-${Date.now()}`;

    // First request
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload: body,
    });
    expect(res1.statusCode).toBe(201);
    const asset1 = JSON.parse(res1.body);

    // Second request with same key — should return identical cached response
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${editorToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload: body,
    });
    expect(res2.statusCode).toBe(201);
    const asset2 = JSON.parse(res2.body);

    // Same asset ID — no duplicate record created
    expect(asset2.id).toBe(asset1.id);

    // Only one DB row
    const rows = await db('assets').where('file_name', 'idem-test.jpg');
    expect(rows.filter((r: { id: string }) => r.id === asset1.id)).toHaveLength(1);

    // Drive uploadFile called only once
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    // Cleanup
    await db('audit_log').where('entity_id', asset1.id).delete().catch(() => {});
    await db('assets').where('id', asset1.id).delete();
  });
});

// ── 3.T10 — Role enforcement ──────────────────────────────────────────────────

describe('3.T10 — Role enforcement', () => {
  let assetId: string;

  beforeAll(async () => {
    const db = getTestDb();
    const [asset] = await db('assets')
      .insert({
        file_name: 'role-test.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 256,
        google_drive_id: `drive-role-${Date.now()}`,
        status: 'active',
        tags: JSON.stringify({}),
        uploaded_by: adminUserId,
      })
      .returning('id');
    assetId = asset.id;
  });

  afterAll(async () => {
    const db = getTestDb();
    await db('audit_log').where('entity_id', assetId).delete().catch(() => {});
    await db('assets').where('id', assetId).delete().catch(() => {});
  });

  it('viewer cannot upload (POST) — expects 403', async () => {
    const boundary = '----TestBoundary10a';
    const body = buildMultipartBody(boundary, 'test.jpg', 'image/jpeg', Buffer.from('data'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${viewerToken}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('viewer cannot delete — expects 403', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/assets/${assetId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('editor cannot delete — expects 403 (delete requires admin)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/assets/${assetId}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin can delete — expects 200', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/assets/${assetId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
