import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';
import { driveService } from '../../../src/services/drive.service.js';
import { upsertProduct, upsertVariant } from '../../../src/services/product.service.js';
import { linkAssetToProduct, DuplicateLinkError } from '../../../src/services/link.service.js';
import { Readable } from 'stream';

// Mock Drive service for asset uploads triggered via HTTP
vi.spyOn(driveService, 'uploadFile').mockResolvedValue({ id: 'mock-link-drive-id', webViewLink: '' });
vi.spyOn(driveService, 'trashFile').mockResolvedValue(undefined);
vi.spyOn(driveService, 'downloadFile').mockResolvedValue(Readable.from(Buffer.from('')));

const JWT_SECRET = process.env['JWT_SECRET']!;

let app: FastifyInstance;
let editorToken: string;
let editorUserId: string;

// Helper: insert an asset directly into the DB
async function insertTestAsset(overrides: Record<string, unknown> = {}) {
  const db = getTestDb();
  const [row] = await db('assets')
    .insert({
      file_name: `link-test-${Date.now()}.jpg`,
      asset_type: 'image',
      mime_type: 'image/jpeg',
      file_size_bytes: 1024,
      google_drive_id: `drive-link-${Date.now()}-${Math.random()}`,
      status: 'active',
      tags: JSON.stringify({}),
      ...overrides,
    })
    .returning('*');
  return row as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();
  const [editor] = await db('users')
    .insert({ email: 'links-editor@test.com', name: 'Editor', role: 'editor', status: 'active' })
    .returning('id');
  editorUserId = editor.id;
  editorToken = createAccessToken(editorUserId, 'editor', JWT_SECRET);
});

afterAll(async () => {
  const db = getTestDb();
  await db('asset_products').delete().catch(() => {});
  await db('audit_log').delete().catch(() => {});
  await db('assets').delete().catch(() => {});
  await db('product_variants').delete().catch(() => {});
  await db('products').delete().catch(() => {});
  await db('users').where('id', editorUserId).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

// ── 4.T3 — Asset-product linking ─────────────────────────────────────────────

describe('4.T3 — Asset-product linking', () => {
  it('creates a link, rejects a duplicate with 409, allows different role and variant-level links', async () => {
    const db = getTestDb();
    const asset = await insertTestAsset();
    const assetId = asset['id'] as string;
    const product = await upsertProduct(null, { title: 'Linking Test Product' });
    const productId = product['id'] as string;
    const variant = await upsertVariant(productId, null, { sku: 'LTP-01', title: 'Blue' });
    const variantId = variant['id'] as string;

    // 1. Link with role 'hero' — succeeds (201)
    const heroRes = await app.inject({
      method: 'POST',
      url: `/api/products/${productId}/assets`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ assetId, variantId: null, role: 'hero', sortOrder: 0 }),
    });
    expect(heroRes.statusCode).toBe(201);
    const heroLink = JSON.parse(heroRes.body);
    expect(heroLink.role).toBe('hero');

    // 2. Same asset + product + null variant + same role 'hero' → 409
    const dupRes = await app.inject({
      method: 'POST',
      url: `/api/products/${productId}/assets`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ assetId, variantId: null, role: 'hero', sortOrder: 0 }),
    });
    expect(dupRes.statusCode).toBe(409);
    expect(JSON.parse(dupRes.body).error.code).toBe('DUPLICATE_LINK');

    // 3. Same asset + product + null variant + different role 'gallery' → succeeds
    const galleryRes = await app.inject({
      method: 'POST',
      url: `/api/products/${productId}/assets`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ assetId, variantId: null, role: 'gallery', sortOrder: 1 }),
    });
    expect(galleryRes.statusCode).toBe(201);

    // 4. Same asset + product + specific variant + same role 'hero' → succeeds (variant-level is distinct)
    const variantRes = await app.inject({
      method: 'POST',
      url: `/api/products/${productId}/assets`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ assetId, variantId, role: 'hero', sortOrder: 0 }),
    });
    expect(variantRes.statusCode).toBe(201);

    // Verify 3 links in DB (hero/null, gallery/null, hero/variant)
    const links = await db('asset_products').where('asset_id', assetId);
    expect(links).toHaveLength(3);
  });
});

// ── 4.T4 — Sort order update ──────────────────────────────────────────────────

describe('4.T4 — Sort order update', () => {
  it('persists updated sort orders for asset-product links', async () => {
    const db = getTestDb();
    const product = await upsertProduct(null, { title: 'Sort Order Product' });
    const productId = product['id'] as string;

    const assets = await Promise.all([0, 1, 2].map((i) =>
      insertTestAsset({ file_name: `sort-asset-${i}-${Date.now()}.jpg` })
    ));
    const [a0, a1, a2] = assets;

    // Create 3 links with sort_order 0, 1, 2
    const l0 = await linkAssetToProduct(a0['id'] as string, productId, null, 'gallery', 0);
    const l1 = await linkAssetToProduct(a1['id'] as string, productId, null, 'gallery', 1);
    const l2 = await linkAssetToProduct(a2['id'] as string, productId, null, 'gallery', 2);

    // Swap: l1 → sort_order 0, l0 → sort_order 1
    const patchL1 = await app.inject({
      method: 'PATCH',
      url: `/api/products/${productId}/assets/${l1['id']}`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ sortOrder: 0 }),
    });
    expect(patchL1.statusCode).toBe(200);

    const patchL0 = await app.inject({
      method: 'PATCH',
      url: `/api/products/${productId}/assets/${l0['id']}`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ sortOrder: 1 }),
    });
    expect(patchL0.statusCode).toBe(200);

    // Verify new sort orders
    const updatedL1 = await db('asset_products').where('id', l1['id']).first();
    const updatedL0 = await db('asset_products').where('id', l0['id']).first();
    const updatedL2 = await db('asset_products').where('id', l2['id']).first();
    expect(updatedL1.sort_order).toBe(0);
    expect(updatedL0.sort_order).toBe(1);
    expect(updatedL2.sort_order).toBe(2); // unchanged
  });
});

// ── 4.T6 — Product link cascading on asset delete ─────────────────────────────

describe('4.T6 — Product link cascading on asset delete', () => {
  it('link survives soft-delete but is cascade-deleted on hard delete', async () => {
    const db = getTestDb();
    const product = await upsertProduct(null, { title: 'Cascade Link Product' });
    const productId = product['id'] as string;
    const asset = await insertTestAsset();
    const assetId = asset['id'] as string;

    const link = await linkAssetToProduct(assetId, productId, null, 'gallery', 0);
    const linkId = link['id'] as string;

    // Soft-delete the asset — link should still exist
    await db('assets').where('id', assetId).update({ status: 'deleted' });
    const afterSoftDelete = await db('asset_products').where('id', linkId).first();
    expect(afterSoftDelete).toBeDefined();

    // Hard-delete the asset row — link should be cascade-deleted
    await db('assets').where('id', assetId).delete();
    const afterHardDelete = await db('asset_products').where('id', linkId).first();
    expect(afterHardDelete).toBeUndefined();
  });
});

// ── 4.T7 — Materialised view reflects links ───────────────────────────────────

describe('4.T7 — Materialised view reflects links', () => {
  it('asset in MV includes product_titles and skus after linking and refresh', async () => {
    const db = getTestDb();
    const product = await upsertProduct(null, { title: 'Blue Polo Shirt' });
    const productId = product['id'] as string;
    const variant = await upsertVariant(productId, null, { sku: 'BPS-001', title: 'Medium' });
    const variantId = variant['id'] as string;

    const asset = await insertTestAsset({ file_name: 'polo-asset.jpg' });
    const assetId = asset['id'] as string;

    // Link the asset to the product via the variant
    await linkAssetToProduct(assetId, productId, variantId, 'hero', 0);

    // Refresh the materialized view
    await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv');

    const mvRow = await db.raw<{ rows: Array<Record<string, unknown>> }>(
      'SELECT * FROM asset_search_mv WHERE asset_id = ?',
      [assetId]
    );

    expect(mvRow.rows).toHaveLength(1);
    const mv = mvRow.rows[0];
    expect(mv['product_titles']).toContain('Blue Polo Shirt');
    expect(mv['skus']).toContain('BPS-001');
  });
});

// ── Service-level DuplicateLinkError test ────────────────────────────────────

describe('DuplicateLinkError (service level)', () => {
  it('throws DuplicateLinkError when inserting a duplicate link directly', async () => {
    const product = await upsertProduct(null, { title: 'Dup Error Product' });
    const productId = product['id'] as string;
    const asset = await insertTestAsset();
    const assetId = asset['id'] as string;

    await linkAssetToProduct(assetId, productId, null, 'hero', 0);

    await expect(
      linkAssetToProduct(assetId, productId, null, 'hero', 0)
    ).rejects.toBeInstanceOf(DuplicateLinkError);
  });
});
