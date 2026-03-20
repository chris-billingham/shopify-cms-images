import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';
import { upsertProduct, upsertVariant } from '../../../src/services/product.service.js';
import { linkAssetToProduct } from '../../../src/services/link.service.js';
import {
  createMvRefreshQueue,
  createMvRefreshWorker,
  createMvRefreshQueueEvents,
  createRedisConnection,
} from '../../../src/jobs/mv-refresh.js';

const JWT_SECRET = process.env['JWT_SECRET']!;

let app: FastifyInstance;
let viewerToken: string;
let viewerUserId: string;
let rateLimitToken: string;
let rateLimitUserId: string;

// IDs of all assets inserted in beforeAll — used for cleanup
const insertedAssetIds: string[] = [];

async function insertAsset(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const db = getTestDb();
  const [row] = await db('assets')
    .insert({
      file_name: `search-test-${Date.now()}-${Math.random()}.jpg`,
      asset_type: 'image',
      mime_type: 'image/jpeg',
      file_size_bytes: 1024,
      google_drive_id: `drive-search-${Date.now()}-${Math.random()}`,
      status: 'active',
      tags: JSON.stringify({}),
      ...overrides,
    })
    .returning('*');
  insertedAssetIds.push(row.id as string);
  return row as Record<string, unknown>;
}

async function refreshMv(): Promise<void> {
  await getTestDb().raw('REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv');
}

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();

  const [viewer] = await db('users')
    .insert({ email: 'search-viewer@test.com', name: 'Viewer', role: 'viewer', status: 'active' })
    .returning('id');
  viewerUserId = viewer.id;
  viewerToken = createAccessToken(viewerUserId, 'viewer', JWT_SECRET);

  const [rlUser] = await db('users')
    .insert({ email: 'search-ratelimit@test.com', name: 'RLUser', role: 'viewer', status: 'active' })
    .returning('id');
  rateLimitUserId = rlUser.id;
  rateLimitToken = createAccessToken(rateLimitUserId, 'viewer', JWT_SECRET);

  // ── T1 assets — free text search ─────────────────────────────────────────
  await insertAsset({ file_name: 't1uniquefish.jpg', tags: JSON.stringify({}) });

  const t1ProdAsset = await insertAsset({ file_name: 't1prodlinked.jpg', tags: JSON.stringify({}) });
  const t1Product = await upsertProduct(null, { title: 't1uniqproduct' });
  await linkAssetToProduct(t1ProdAsset['id'] as string, t1Product['id'] as string, null, 'hero', 0);

  await insertAsset({
    file_name: 't1tagonly.jpg',
    tags: JSON.stringify({ t1key: 't1uniqvalue' }),
  });

  // ── T2 assets — relevance ranking (SKU beats file name) ──────────────────
  const t2AssetA = await insertAsset({ file_name: 't2-sku-asset.jpg', tags: JSON.stringify({}) });
  const t2Product = await upsertProduct(null, { title: 'T2 Product' });
  const t2Variant = await upsertVariant(t2Product['id'] as string, null, {
    sku: 't2uniquesku',
    title: 'T2 Variant',
  });
  await linkAssetToProduct(
    t2AssetA['id'] as string,
    t2Product['id'] as string,
    t2Variant['id'] as string,
    'hero',
    0,
  );

  await insertAsset({ file_name: 't2uniquesku-photo.jpg', tags: JSON.stringify({}) });

  // ── T3 assets — tag filtering ─────────────────────────────────────────────
  await insertAsset({ file_name: 't3navypolo.jpg', tags: JSON.stringify({ colour: 't3navy' }) });
  await insertAsset({ file_name: 't3redpolo.jpg', tags: JSON.stringify({ colour: 't3red' }) });
  await insertAsset({ file_name: 't3shirttest.jpg', tags: JSON.stringify({ colour: 't3navy' }) });

  // ── T4 assets — faceted counts ────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    await insertAsset({
      file_name: `t4-image-navy-${i}.jpg`,
      asset_type: 'image',
      mime_type: 'image/jpeg',
      tags: JSON.stringify({ testgroup: 't4facets', colour: 't4navy' }),
    });
  }
  for (let i = 0; i < 3; i++) {
    await insertAsset({
      file_name: `t4-video-red-${i}.mp4`,
      asset_type: 'video',
      mime_type: 'video/mp4',
      tags: JSON.stringify({ testgroup: 't4facets', colour: 't4red' }),
    });
  }

  // ── T5 assets — pagination (60 assets) ───────────────────────────────────
  for (let i = 0; i < 60; i++) {
    await insertAsset({
      file_name: `t5-page-asset-${String(i).padStart(3, '0')}.jpg`,
      tags: JSON.stringify({ testgroup: 't5pagination' }),
    });
  }

  // ── T6 assets — sorting by created_at and file_name ──────────────────────
  const now = Date.now();
  for (const [name, msAgo] of [
    ['t6-alpha-sort.jpg', 3 * 86400 * 1000],
    ['t6-beta-sort.jpg', 2 * 86400 * 1000],
    ['t6-gamma-sort.jpg', 1 * 86400 * 1000],
  ] as [string, number][]) {
    await getTestDb()('assets')
      .insert({
        file_name: name,
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: `drive-t6-${name}-${Math.random()}`,
        status: 'active',
        tags: JSON.stringify({ testgroup: 't6sort' }),
        created_at: new Date(now - msAgo),
        updated_at: new Date(now - msAgo),
      })
      .returning('id')
      .then(([row]) => insertedAssetIds.push(row.id));
  }

  // Refresh MV so all seeded data is searchable
  await refreshMv();
});

afterAll(async () => {
  const db = getTestDb();
  await db('asset_products').delete().catch(() => {});
  await db('audit_log').delete().catch(() => {});
  await db('assets').whereIn('id', insertedAssetIds).delete().catch(() => {});
  await db('product_variants').delete().catch(() => {});
  await db('products').delete().catch(() => {});
  await db('users').whereIn('id', [viewerUserId, rateLimitUserId]).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

// ── 5.T1 — Free text search ──────────────────────────────────────────────────

describe('5.T1 — Free text search', () => {
  it('finds asset by file name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=t1uniquefish',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets.length).toBeGreaterThanOrEqual(1);
    expect(body.assets.some((a: Record<string, unknown>) => a['file_name'] === 't1uniquefish.jpg')).toBe(true);
  });

  it('finds asset by linked product title', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=t1uniqproduct',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets.some((a: Record<string, unknown>) => a['file_name'] === 't1prodlinked.jpg')).toBe(true);
  });

  it('finds asset by tag value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=t1uniqvalue',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets.some((a: Record<string, unknown>) => a['file_name'] === 't1tagonly.jpg')).toBe(true);
  });

  it('returns empty result for no match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=xyznoassetmatchesthisquery999',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ── 5.T2 — Relevance ranking ──────────────────────────────────────────────────

describe('5.T2 — Relevance ranking', () => {
  it('SKU-linked asset ranks above file-name-only match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=t2uniquesku',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets.length).toBeGreaterThanOrEqual(2);

    const skuAssetIdx = body.assets.findIndex(
      (a: Record<string, unknown>) => a['file_name'] === 't2-sku-asset.jpg',
    );
    const fileAssetIdx = body.assets.findIndex(
      (a: Record<string, unknown>) => a['file_name'] === 't2uniquesku-photo.jpg',
    );
    expect(skuAssetIdx).not.toBe(-1);
    expect(fileAssetIdx).not.toBe(-1);
    expect(skuAssetIdx).toBeLessThan(fileAssetIdx);
  });
});

// ── 5.T3 — Tag filtering ──────────────────────────────────────────────────────

describe('5.T3 — Tag filtering', () => {
  it('filters to only Navy assets with tags[colour]=t3navy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[colour]=t3navy',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const fileNames = body.assets.map((a: Record<string, unknown>) => a['file_name']);
    expect(fileNames).toContain('t3navypolo.jpg');
    expect(fileNames).toContain('t3shirttest.jpg');
    expect(fileNames).not.toContain('t3redpolo.jpg');
  });

  it('combines free text and tag filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=t3shirttest&tags[colour]=t3navy',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const fileNames = body.assets.map((a: Record<string, unknown>) => a['file_name']);
    expect(fileNames).toContain('t3shirttest.jpg');
    expect(fileNames).not.toContain('t3redpolo.jpg');
    // t3navypolo.jpg doesn't contain "shirttest" so shouldn't match
    expect(fileNames).not.toContain('t3navypolo.jpg');
  });
});

// ── 5.T4 — Faceted counts ─────────────────────────────────────────────────────

describe('5.T4 — Faceted counts', () => {
  it('returns asset_type and tag facets for the filtered result set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[testgroup]=t4facets&facets=true',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.facets).toBeDefined();
    expect(body.facets.asset_type.image).toBe(5);
    expect(body.facets.asset_type.video).toBe(3);
    expect(body.facets.tags.colour.t4navy).toBe(5);
    expect(body.facets.tags.colour.t4red).toBe(3);
  });

  it('facet counts narrow when a tag filter is applied', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[testgroup]=t4facets&tags[colour]=t4navy&facets=true',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Only navy assets remain after filter — only image type
    expect(body.facets.asset_type.image).toBe(5);
    expect(body.facets.asset_type.video).toBeUndefined();
    expect(body.facets.tags.colour.t4navy).toBe(5);
    expect(body.facets.tags.colour.t4red).toBeUndefined();
  });
});

// ── 5.T5 — Pagination ────────────────────────────────────────────────────────

describe('5.T5 — Pagination', () => {
  it('page=1&limit=25 returns 25 results and total=60', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[testgroup]=t5pagination&page=1&limit=25',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets).toHaveLength(25);
    expect(body.total).toBe(60);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(25);
  });

  it('page=3&limit=25 returns 10 results', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[testgroup]=t5pagination&page=3&limit=25',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assets).toHaveLength(10);
    expect(body.total).toBe(60);
  });
});

// ── 5.T6 — Sorting ───────────────────────────────────────────────────────────

describe('5.T6 — Sorting', () => {
  it('sort=created_at&order=desc returns newest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[testgroup]=t6sort&sort=created_at&order=desc',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const fileNames = body.assets.map((a: Record<string, unknown>) => a['file_name'] as string);
    expect(fileNames[0]).toBe('t6-gamma-sort.jpg'); // most recent
    expect(fileNames[2]).toBe('t6-alpha-sort.jpg'); // oldest
  });

  it('sort=file_name&order=asc returns alphabetical order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?tags[testgroup]=t6sort&sort=file_name&order=asc',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const fileNames = body.assets.map((a: Record<string, unknown>) => a['file_name'] as string);
    expect(fileNames[0]).toBe('t6-alpha-sort.jpg');
    expect(fileNames[1]).toBe('t6-beta-sort.jpg');
    expect(fileNames[2]).toBe('t6-gamma-sort.jpg');
  });
});

// ── 5.T7 — Search rate limiting ──────────────────────────────────────────────

describe('5.T7 — Search rate limiting', () => {
  it('31st request from same user returns 429', async () => {
    // Send 30 requests that should succeed, then the 31st should be rate-limited
    const requests = Array.from({ length: 30 }, () =>
      app.inject({
        method: 'GET',
        url: '/api/search',
        headers: { authorization: `Bearer ${rateLimitToken}` },
      }),
    );
    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.statusCode !== 429)).toBe(true);

    // 31st request should be rejected
    const final = await app.inject({
      method: 'GET',
      url: '/api/search',
      headers: { authorization: `Bearer ${rateLimitToken}` },
    });
    expect(final.statusCode).toBe(429);
  });
});

// ── 5.T8 — Materialised view consistency via BullMQ ──────────────────────────

describe('5.T8 — Materialised view consistency', () => {
  it('BullMQ refresh job makes a directly-inserted asset searchable', async () => {
    const db = getTestDb();

    // Insert asset directly to DB — bypasses service so MV is NOT refreshed
    const [row] = await db('assets')
      .insert({
        file_name: 't8bullmq-uniquetest.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 512,
        google_drive_id: `drive-t8-${Date.now()}-${Math.random()}`,
        status: 'active',
        tags: JSON.stringify({}),
      })
      .returning('*');
    const assetId = row.id as string;

    try {
      // Verify it's not in the MV yet
      const mvCheck = await db.raw<{ rows: unknown[] }>(
        'SELECT asset_id FROM asset_search_mv WHERE asset_id = ?',
        [assetId],
      );
      expect(mvCheck.rows).toHaveLength(0);

      // Start BullMQ infrastructure with test Redis
      const conn1 = createRedisConnection();
      const conn2 = createRedisConnection();
      const conn3 = createRedisConnection();
      const queue = createMvRefreshQueue(conn1);
      const worker = createMvRefreshWorker(conn2);
      const queueEvents = createMvRefreshQueueEvents(conn3);

      try {
        // Add a one-off refresh job and wait for it to complete
        const job = await queue.add('refresh', {});
        await job.waitUntilFinished(queueEvents, 15_000);

        // Search for the new asset
        const res = await app.inject({
          method: 'GET',
          url: '/api/search?q=t8bullmq',
          headers: { authorization: `Bearer ${viewerToken}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(
          body.assets.some((a: Record<string, unknown>) => a['file_name'] === 't8bullmq-uniquetest.jpg'),
        ).toBe(true);
      } finally {
        await worker.close();
        await queueEvents.close();
        await queue.close();
        await conn1.quit();
        await conn2.quit();
        await conn3.quit();
      }
    } finally {
      await db('assets').where('id', assetId).delete().catch(() => {});
    }
  });
});
