import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';

const JWT_SECRET = process.env['JWT_SECRET']!;

let app: FastifyInstance;
let viewerToken: string;
let viewerUserId: string;
const insertedAssetIds: string[] = [];

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();

  const [viewer] = await db('users')
    .insert({ email: 'tags-viewer@test.com', name: 'Viewer', role: 'viewer', status: 'active' })
    .returning('id');
  viewerUserId = viewer.id;
  viewerToken = createAccessToken(viewerUserId, 'viewer', JWT_SECRET);

  // Seed assets with varied tags for 4.T5
  const assets = [
    { file_name: 'navy-shirt.jpg',    tags: { colour: 'Navy',  season: 'AW26' }, mime_type: 'image/jpeg', asset_type: 'image' },
    { file_name: 'red-polo.jpg',      tags: { colour: 'Red',   season: 'SS27' }, mime_type: 'image/jpeg', asset_type: 'image' },
    { file_name: 'green-jacket.jpg',  tags: { colour: 'Green', season: 'AW26' }, mime_type: 'image/jpeg', asset_type: 'image' },
  ];

  for (const a of assets) {
    const [row] = await db('assets')
      .insert({
        file_name: a.file_name,
        asset_type: a.asset_type,
        mime_type: a.mime_type,
        file_size_bytes: 1024,
        google_drive_id: `drive-tag-${Date.now()}-${Math.random()}`,
        status: 'active',
        tags: JSON.stringify(a.tags),
      })
      .returning('id');
    insertedAssetIds.push(row.id);
  }
});

afterAll(async () => {
  const db = getTestDb();
  await db('assets').whereIn('id', insertedAssetIds).delete().catch(() => {});
  await db('users').where('id', viewerUserId).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

// ── 4.T5 — Tag key and value listing ─────────────────────────────────────────

describe('4.T5 — Tag key and value listing', () => {
  it('GET /api/tags/keys returns all distinct tag keys', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/keys',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.keys).toContain('colour');
    expect(body.keys).toContain('season');
  });

  it('GET /api/tags/values?key=colour returns all distinct colour values', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/values?key=colour',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.values).toContain('Navy');
    expect(body.values).toContain('Red');
    expect(body.values).toContain('Green');
  });

  it('GET /api/tags/values?key=season returns AW26 and SS27', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/values?key=season',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.values).toContain('AW26');
    expect(body.values).toContain('SS27');
  });

  it('GET /api/tags/values returns 400 when key is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/values',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/tags/facets returns counts per key/value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/facets',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.facets.colour).toBeDefined();
    expect(body.facets.colour['Navy']).toBeGreaterThanOrEqual(1);
    expect(body.facets.colour['Red']).toBeGreaterThanOrEqual(1);
    expect(body.facets.season).toBeDefined();
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tags/keys' });
    expect(res.statusCode).toBe(401);
  });
});
