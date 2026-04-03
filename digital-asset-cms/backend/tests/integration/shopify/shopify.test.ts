import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { Readable } from 'stream';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';
import * as shopifyServiceModule from '../../../src/services/shopify.service.js';
import * as driveServiceModule from '../../../src/services/drive.service.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env['JWT_SECRET']!;
const WEBHOOK_SECRET = process.env['SHOPIFY_WEBHOOK_SECRET']!;

// ── Helpers ───────────────────────────────────────────────────────────────────

function shopifyHmac(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('base64');
}

async function waitForJob(
  app: FastifyInstance,
  token: string,
  jobId: string,
  maxWaitMs = 5000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${jobId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const job = JSON.parse(res.body) as Record<string, unknown>;
    if (job['status'] === 'completed' || job['status'] === 'failed') {
      return job;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`);
}

// ── Spies ─────────────────────────────────────────────────────────────────────

const fetchProductsSpy = vi.spyOn(shopifyServiceModule.shopifyService, 'fetchProducts');
const fetchProductImagesSpy = vi.spyOn(shopifyServiceModule.shopifyService, 'fetchProductImages');
const fetchImageStreamSpy = vi.spyOn(shopifyServiceModule.shopifyService, 'fetchImageStream');
const pushImageSpy = vi.spyOn(shopifyServiceModule.shopifyService, 'pushImage');
const uploadFileSpy = vi.spyOn(driveServiceModule.driveService, 'uploadFile');
const downloadFileSpy = vi.spyOn(driveServiceModule.driveService, 'downloadFile');

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
    .insert({ email: 'shopify-admin@test.com', name: 'Admin', role: 'admin', status: 'active' })
    .returning('id');
  adminUserId = admin.id;
  adminToken = createAccessToken(adminUserId, 'admin', JWT_SECRET);

  const [editor] = await db('users')
    .insert({ email: 'shopify-editor@test.com', name: 'Editor', role: 'editor', status: 'active' })
    .returning('id');
  editorUserId = editor.id;
  editorToken = createAccessToken(editorUserId, 'editor', JWT_SECRET);
});

afterAll(async () => {
  const db = getTestDb();
  await db('audit_log').delete().catch(() => {});
  await db('asset_products').delete().catch(() => {});
  await db('assets').delete().catch(() => {});
  await db('product_variants').delete().catch(() => {});
  await db('products').delete().catch(() => {});
  await db('background_jobs').delete().catch(() => {});
  await db('users').whereIn('id', [adminUserId, editorUserId]).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  uploadFileSpy.mockResolvedValue({ id: `drv-${Date.now()}`, webViewLink: 'https://drive.google.com/test' });
  downloadFileSpy.mockResolvedValue(Readable.from([Buffer.from('fake-image-bytes')]));
});

// ── 9.T2 — Product metadata sync ─────────────────────────────────────────────

describe('9.T2 — Product metadata sync', () => {
  it('syncs 3 products with variants and sets synced_at', async () => {
    const db = getTestDb();

    fetchProductsSpy.mockResolvedValueOnce({
      products: [
        { id: 101, title: 'Prod A', vendor: 'Vendor1', product_type: 'Category1', tags: 'tag1', status: 'active', variants: [{ id: 1001, sku: 'SKU-A', title: 'Default', price: '10.00' }] },
        { id: 102, title: 'Prod B', vendor: 'Vendor2', product_type: 'Category2', tags: null, status: 'active', variants: [{ id: 1002, sku: 'SKU-B', title: 'Default', price: '20.00' }] },
        { id: 103, title: 'Prod C', vendor: null,      product_type: null,        tags: null, status: 'active', variants: [] },
      ],
      nextCursor: undefined,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/sync-products',
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(202);
    const { job_id: jobId } = JSON.parse(res.body) as { job_id: string };

    const job = await waitForJob(app, editorToken, jobId);
    expect(job['status']).toBe('completed');

    // 3 products upserted
    const products = await db('products').whereIn('shopify_id', [101, 102, 103]);
    expect(products).toHaveLength(3);

    // synced_at is set
    for (const p of products) {
      expect(p.synced_at).not.toBeNull();
    }

    // Variants for products A and B
    const varA = await db('product_variants').where('shopify_variant_id', 1001).first();
    expect(varA).toBeDefined();
    expect(varA.sku).toBe('SKU-A');

    // Cleanup
    await db('product_variants').whereIn('shopify_variant_id', [1001, 1002]).delete();
    await db('products').whereIn('shopify_id', [101, 102, 103]).delete();
  });
});

// ── 9.T3 — Product metadata sync idempotency ─────────────────────────────────

describe('9.T3 — Product metadata sync idempotency', () => {
  it('does not create duplicates and updates on second sync', async () => {
    const db = getTestDb();

    const mockProducts = [
      { id: 201, title: 'Original Title', vendor: null, product_type: null, tags: null, status: 'active', variants: [] },
    ];

    fetchProductsSpy.mockResolvedValue({ products: mockProducts, nextCursor: undefined });

    // First sync
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/shopify/sync-products',
      headers: { authorization: `Bearer ${editorToken}` },
    });
    await waitForJob(app, editorToken, (JSON.parse(res1.body) as { job_id: string }).job_id);

    // Second sync with same data
    fetchProductsSpy.mockResolvedValue({ products: mockProducts, nextCursor: undefined });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/shopify/sync-products',
      headers: { authorization: `Bearer ${editorToken}` },
    });
    await waitForJob(app, editorToken, (JSON.parse(res2.body) as { job_id: string }).job_id);

    const rows = await db('products').where('shopify_id', 201);
    expect(rows).toHaveLength(1);

    // Third sync with updated title
    fetchProductsSpy.mockResolvedValue({
      products: [{ ...mockProducts[0]!, title: 'Updated Title' }],
      nextCursor: undefined,
    });
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/shopify/sync-products',
      headers: { authorization: `Bearer ${editorToken}` },
    });
    await waitForJob(app, editorToken, (JSON.parse(res3.body) as { job_id: string }).job_id);

    const updated = await db('products').where('shopify_id', 201).first();
    expect(updated.title).toBe('Updated Title');

    // Cleanup
    await db('products').where('shopify_id', 201).delete();
  });
});

// ── 9.T4 — Image import ───────────────────────────────────────────────────────

describe('9.T4 — Image import', () => {
  it('imports 3 images with correct roles, sort_order, alt tag, and variant link', async () => {
    const db = getTestDb();

    // Create a CMS product with shopify_id
    const [product] = await db('products')
      .insert({ title: 'Import Test Product', shopify_id: 301, status: 'active', synced_at: new Date() })
      .returning('*');

    // Create a CMS variant linked to shopify_variant_id
    const [variant] = await db('product_variants')
      .insert({ product_id: product.id, shopify_variant_id: 9001, sku: 'VAR-1', title: 'Var 1' })
      .returning('*');

    let driveCounter = 0;
    uploadFileSpy.mockImplementation(async () => ({ id: `drv-img-${++driveCounter}`, webViewLink: null }));

    fetchProductImagesSpy.mockResolvedValueOnce([
      { id: 501, product_id: 301, position: 1, alt: 'Hero image', src: 'https://cdn.shopify.com/img/hero.jpg', variant_ids: [] },
      { id: 502, product_id: 301, position: 2, alt: null, src: 'https://cdn.shopify.com/img/gallery1.jpg', variant_ids: [] },
      { id: 503, product_id: 301, position: 3, alt: null, src: 'https://cdn.shopify.com/img/gallery2.jpg', variant_ids: [9001] },
    ]);

    fetchImageStreamSpy.mockResolvedValue(Readable.from([Buffer.from('fake-img')]));

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/import-images',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(202);
    const { job_id: jobId } = JSON.parse(res.body) as { job_id: string };

    const job = await waitForJob(app, adminToken, jobId);
    expect(job['status']).toBe('completed');
    const result = job['result'] as Record<string, unknown>;
    expect(result['imported']).toBe(3);
    expect(result['skipped']).toBe(0);

    // 3 assets created
    const assets = await db('assets').whereIn('file_name', ['hero.jpg', 'gallery1.jpg', 'gallery2.jpg']);
    expect(assets).toHaveLength(3);

    const hero = assets.find((a: Record<string, unknown>) => a['file_name'] === 'hero.jpg');
    expect(hero?.tags?.alt ?? (JSON.parse(hero?.tags ?? '{}')).alt).toBe('Hero image');

    // Check links
    const links = await db('asset_products').where('product_id', product.id).orderBy('sort_order', 'asc');
    expect(links).toHaveLength(3);
    expect(links[0].role).toBe('hero');
    expect(links[0].sort_order).toBe(1);
    expect(links[1].role).toBe('gallery');
    expect(links[1].sort_order).toBe(2);
    expect(links[2].role).toBe('gallery');
    expect(links[2].sort_order).toBe(3);
    expect(links[2].variant_id).toBe(variant.id);

    // Cleanup
    await db('asset_products').where('product_id', product.id).delete();
    await db('assets').whereIn('file_name', ['hero.jpg', 'gallery1.jpg', 'gallery2.jpg']).delete();
    await db('product_variants').where('id', variant.id).delete();
    await db('products').where('id', product.id).delete();
  });
});

// ── 9.T5 — Image import duplicate skip ───────────────────────────────────────

describe('9.T5 — Image import duplicate skip', () => {
  it('skips images whose file name already exists and imports others', async () => {
    const db = getTestDb();

    const [product] = await db('products')
      .insert({ title: 'Dup Import Product', shopify_id: 302, status: 'active', synced_at: new Date() })
      .returning('*');

    // Pre-existing asset with same file name as the first image
    await db('assets').insert({
      file_name: 'existing.jpg',
      asset_type: 'image',
      mime_type: 'image/jpeg',
      file_size_bytes: 100,
      google_drive_id: `dup-drive-${Date.now()}`,
      status: 'active',
      tags: JSON.stringify({}),
      version: 1,
    });

    fetchProductImagesSpy.mockResolvedValueOnce([
      { id: 601, product_id: 302, position: 1, alt: null, src: 'https://cdn.shopify.com/img/existing.jpg', variant_ids: [] },
      { id: 602, product_id: 302, position: 2, alt: null, src: 'https://cdn.shopify.com/img/new-image.jpg', variant_ids: [] },
    ]);

    fetchImageStreamSpy.mockResolvedValue(Readable.from([Buffer.from('bytes')]));

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/import-images',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(202);
    const { job_id: jobId } = JSON.parse(res.body) as { job_id: string };

    const job = await waitForJob(app, adminToken, jobId);
    expect(job['status']).toBe('completed');
    const result = job['result'] as Record<string, unknown>;
    expect(result['imported']).toBe(1);
    expect(result['skipped']).toBe(1);

    // Cleanup
    await db('asset_products').where('product_id', product.id).delete();
    await db('assets').whereIn('file_name', ['existing.jpg', 'new-image.jpg']).delete();
    await db('products').where('id', product.id).delete();
  });
});

// ── 9.T6 — Push asset to Shopify ─────────────────────────────────────────────

describe('9.T6 — Push asset to Shopify', () => {
  it('pushes asset to Shopify, stores shopify_image_id, logs audit', async () => {
    const db = getTestDb();

    const [product] = await db('products')
      .insert({ title: 'Push Product', shopify_id: 401, status: 'active', synced_at: new Date() })
      .returning('*');

    const [asset] = await db('assets')
      .insert({
        file_name: 'push-test.jpg',
        asset_type: 'image',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        google_drive_id: `push-drive-${Date.now()}`,
        status: 'active',
        tags: JSON.stringify({}),
        version: 1,
      })
      .returning('*');

    await db('asset_products').insert({
      asset_id: asset.id,
      product_id: product.id,
      role: 'hero',
      sort_order: 0,
    });

    downloadFileSpy.mockResolvedValue(Readable.from([Buffer.from('file-bytes')]));
    pushImageSpy.mockResolvedValue({ id: 99999, product_id: 401, position: 1, src: 'https://cdn.shopify.com/img/push.jpg', variant_ids: [] });

    const res = await app.inject({
      method: 'POST',
      url: `/api/shopify/push/${asset.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['shopify_image_id']).toBe('99999');

    // shopify_image_id stored on asset
    const updatedAsset = await db('assets').where('id', asset.id).first();
    expect(updatedAsset.shopify_image_id).toBe('99999');

    // Audit log entry
    const auditEntry = await db('audit_log')
      .where('entity_id', asset.id)
      .where('action', 'push_shopify')
      .first();
    expect(auditEntry).toBeDefined();
    const details = auditEntry.details as Record<string, unknown>;
    expect(details['shopify_image_id']).toBe('99999');
    expect(details['status']).toBe('success');

    // Editor cannot push
    const resEditor = await app.inject({
      method: 'POST',
      url: `/api/shopify/push/${asset.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(resEditor.statusCode).toBe(403);

    // Cleanup
    await db('audit_log').where('entity_id', asset.id).delete();
    await db('asset_products').where('asset_id', asset.id).delete();
    await db('assets').where('id', asset.id).delete();
    await db('products').where('id', product.id).delete();
  });
});

// ── 9.T7 — Webhook verification and handling ──────────────────────────────────

describe('9.T7 — Webhook verification', () => {
  it('returns 401 for an invalid HMAC', async () => {
    const body = JSON.stringify({ id: 999, title: 'Test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': 'invalid-hmac',
        'x-shopify-topic': 'products/create',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for a valid HMAC', async () => {
    const body = JSON.stringify({ id: 1000, title: 'Webhook Product', variants: [] });
    const hmac = shopifyHmac(body);

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-topic': 'products/create',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    const db = getTestDb();
    const product = await db('products').where('shopify_id', 1000).first();
    expect(product).toBeDefined();
    expect(product.title).toBe('Webhook Product');

    await db('products').where('shopify_id', 1000).delete();
  });

  it('handles products/create webhook — product appears in DB', async () => {
    const db = getTestDb();
    const body = JSON.stringify({ id: 2001, title: 'Created via Webhook', vendor: 'TestVendor', product_type: 'Category', tags: '', variants: [] });
    const hmac = shopifyHmac(body);

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/webhooks',
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': 'products/create' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    const product = await db('products').where('shopify_id', 2001).first();
    expect(product).toBeDefined();
    expect(product.title).toBe('Created via Webhook');
    expect(product.vendor).toBe('TestVendor');

    await db('products').where('shopify_id', 2001).delete();
  });

  it('handles products/delete webhook — product is soft-deleted', async () => {
    const db = getTestDb();

    // Create a product to delete
    await db('products').insert({ title: 'To Be Deleted', shopify_id: 3001, status: 'active' });

    const body = JSON.stringify({ id: 3001 });
    const hmac = shopifyHmac(body);

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/webhooks',
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': 'products/delete' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    const product = await db('products').where('shopify_id', 3001).first();
    expect(product.status).toBe('deleted');

    await db('products').where('shopify_id', 3001).delete();
  });
});

// ── 9.T8 — Reconciliation ─────────────────────────────────────────────────────

describe('9.T8 — Reconciliation', () => {
  it('creates missing CMS product and flags orphaned product', async () => {
    const db = getTestDb();

    // Orphaned: exists in CMS with shopify_id=5001, but NOT in Shopify mock
    await db('products').insert({ title: 'Orphaned Product', shopify_id: 5001, status: 'active' });

    // Shopify has product with id=5002 — NOT in CMS → should be created
    fetchProductsSpy.mockResolvedValueOnce({
      products: [
        { id: 5002, title: 'New from Shopify', vendor: null, product_type: null, tags: null, status: 'active', variants: [] },
      ],
      nextCursor: undefined,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/shopify/reconcile',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(202);
    const { job_id: jobId } = JSON.parse(res.body) as { job_id: string };

    const job = await waitForJob(app, adminToken, jobId);
    expect(job['status']).toBe('completed');
    const result = job['result'] as Record<string, unknown>;
    expect(result['created']).toBe(1);
    expect(result['orphaned']).toBe(1);

    // New product created
    const created = await db('products').where('shopify_id', 5002).first();
    expect(created).toBeDefined();
    expect(created.title).toBe('New from Shopify');

    // Orphaned product flagged
    const orphaned = await db('products').where('shopify_id', 5001).first();
    expect(orphaned.status).toBe('orphaned');

    // Cleanup
    await db('products').whereIn('shopify_id', [5001, 5002]).delete();
  });
});
