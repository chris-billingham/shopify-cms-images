import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { upsertProduct, upsertVariant, getProduct, getVariants } from '../../../src/services/product.service.js';

let adminId: string;

beforeAll(async () => {
  await runMigrations();
  const db = getTestDb();
  const [user] = await db('users')
    .insert({ email: 'prod-test-admin@test.com', name: 'Admin', role: 'admin', status: 'active' })
    .returning('id');
  adminId = user.id;
});

afterAll(async () => {
  const db = getTestDb();
  await db('product_variants').delete().catch(() => {});
  await db('products').delete().catch(() => {});
  await db('users').where('id', adminId).delete().catch(() => {});
  await destroyTestDb();
});

// ── 4.T1 — Product upsert ─────────────────────────────────────────────────────

describe('4.T1 — Product upsert', () => {
  it('updates the row on re-upsert with same shopify_id — no duplicate', async () => {
    const db = getTestDb();

    const p1 = await upsertProduct(99001, { title: 'Classic Tee', category: 'Tops' });
    expect(p1['title']).toBe('Classic Tee');

    // Upsert same shopify_id with a new title
    const p2 = await upsertProduct(99001, { title: 'Classic Tee Updated', category: 'Tops' });
    expect(p2['id']).toBe(p1['id']); // same row
    expect(p2['title']).toBe('Classic Tee Updated');

    // Exactly one row in DB
    const rows = await db('products').where('shopify_id', 99001);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Classic Tee Updated');
  });

  it('inserts two products with different shopify_ids without collision', async () => {
    const db = getTestDb();

    await upsertProduct(99002, { title: 'Product A' });
    await upsertProduct(99003, { title: 'Product B' });

    const rows = await db('products').whereIn('shopify_id', [99002, 99003]);
    expect(rows).toHaveLength(2);
  });

  it('inserts a product without shopify_id (manual creation)', async () => {
    const db = getTestDb();
    const p = await upsertProduct(null, { title: 'Manual Product' });
    expect(p['id']).toBeDefined();
    expect(p['shopify_id']).toBeNull();

    const row = await db('products').where('id', p['id']).first();
    expect(row).toBeDefined();
  });
});

// ── 4.T2 — Variant upsert and cascade delete ──────────────────────────────────

describe('4.T2 — Variant upsert and cascade delete', () => {
  it('creates variants and cascade-deletes them when the product is deleted', async () => {
    const db = getTestDb();

    const product = await upsertProduct(null, { title: 'Cascade Test Product' });
    const productId = product['id'] as string;

    await upsertVariant(productId, null, { sku: 'CTP-S', title: 'Small', price: '29.99' });
    await upsertVariant(productId, null, { sku: 'CTP-L', title: 'Large', price: '34.99' });

    const variants = await getVariants(productId);
    expect(variants).toHaveLength(2);

    // Delete the product — should cascade to variants
    await db('products').where('id', productId).delete();

    const remaining = await db('product_variants').where('product_id', productId);
    expect(remaining).toHaveLength(0);
  });

  it('upserts a variant by shopify_variant_id without duplicating', async () => {
    const db = getTestDb();
    const product = await upsertProduct(null, { title: 'Variant Upsert Product' });
    const productId = product['id'] as string;

    const v1 = await upsertVariant(productId, 55001, { sku: 'VUP-01', title: 'Blue' });
    const v2 = await upsertVariant(productId, 55001, { sku: 'VUP-01-UPDATED', title: 'Blue' });

    expect(v2['id']).toBe(v1['id']);
    expect(v2['sku']).toBe('VUP-01-UPDATED');

    const rows = await db('product_variants').where('shopify_variant_id', 55001);
    expect(rows).toHaveLength(1);

    // Cleanup
    await db('products').where('id', productId).delete();
  });

  it('returns product with its variants via getProduct', async () => {
    const product = await upsertProduct(null, { title: 'Product With Variants' });
    const productId = product['id'] as string;

    await upsertVariant(productId, null, { sku: 'V1', title: 'V1' });
    await upsertVariant(productId, null, { sku: 'V2', title: 'V2' });

    const result = await getProduct(productId);
    const variants = result['variants'] as unknown[];
    expect(variants).toHaveLength(2);

    const db = getTestDb();
    await db('products').where('id', productId).delete();
  });
});
