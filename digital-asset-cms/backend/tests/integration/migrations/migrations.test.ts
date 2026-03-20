import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestDb,
  runMigrations,
  rollbackMigrations,
  destroyTestDb,
  beginTestTransaction,
} from '../../helpers/db.js';

const EXPECTED_TABLES = [
  'users',
  'products',
  'product_variants',
  'assets',
  'asset_products',
  'audit_log',
  'refresh_tokens',
  'background_jobs',
];

beforeAll(async () => {
  await rollbackMigrations(); // clean slate in case of prior partial run
  await runMigrations();
});

afterAll(async () => {
  await destroyTestDb();
});

// ── 1.T1 ─────────────────────────────────────────────────────────────────────

describe('1.T1 — Migration execution', () => {
  it('all migrations complete without error and all tables exist', async () => {
    const db = getTestDb();
    const rows = await db('information_schema.tables')
      .where('table_schema', 'public')
      .whereIn('table_name', EXPECTED_TABLES)
      .select('table_name');

    const found = rows.map((r: { table_name: string }) => r.table_name).sort();
    expect(found).toEqual([...EXPECTED_TABLES].sort());
  });
});

// ── 1.T2 ─────────────────────────────────────────────────────────────────────

describe('1.T2 — Column verification', () => {
  async function getColumns(tableName: string) {
    const db = getTestDb();
    const rows = await db('information_schema.columns')
      .where('table_schema', 'public')
      .where('table_name', tableName)
      .select('column_name', 'data_type', 'udt_name', 'is_nullable', 'column_default');
    return Object.fromEntries(
      rows.map((r: { column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null }) => [
        r.column_name,
        { data_type: r.data_type, udt_name: r.udt_name, is_nullable: r.is_nullable, column_default: r.column_default },
      ])
    );
  }

  it('users table has correct columns', async () => {
    const cols = await getColumns('users');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['id'].column_default).toContain('gen_random_uuid');
    expect(cols['email']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['name']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['role']).toMatchObject({ data_type: 'USER-DEFINED', udt_name: 'user_role', is_nullable: 'NO' });
    expect(cols['role'].column_default).toContain('viewer');
    expect(cols['status']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['status'].column_default).toContain('active');
    expect(cols['avatar_url']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['created_at']).toMatchObject({ data_type: 'timestamp with time zone' });
    expect(cols['updated_at']).toMatchObject({ data_type: 'timestamp with time zone' });
  });

  it('products table has correct columns', async () => {
    const cols = await getColumns('products');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['shopify_id']).toMatchObject({ data_type: 'bigint', is_nullable: 'YES' });
    expect(cols['title']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['category']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['vendor']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['status']).toMatchObject({ data_type: 'text' });
    expect(cols['status'].column_default).toContain('active');
    expect(cols['shopify_tags']).toMatchObject({ data_type: 'ARRAY' });
    expect(cols['synced_at']).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
  });

  it('product_variants table has correct columns', async () => {
    const cols = await getColumns('product_variants');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['product_id']).toMatchObject({ data_type: 'uuid' });
    expect(cols['shopify_variant_id']).toMatchObject({ data_type: 'bigint', is_nullable: 'YES' });
    expect(cols['sku']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['title']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['price']).toMatchObject({ data_type: 'numeric', is_nullable: 'YES' });
  });

  it('assets table has correct columns', async () => {
    const cols = await getColumns('assets');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['file_name']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['asset_type']).toMatchObject({ data_type: 'USER-DEFINED', udt_name: 'asset_type', is_nullable: 'NO' });
    expect(cols['asset_type'].column_default).toContain('other');
    expect(cols['mime_type']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['file_size_bytes']).toMatchObject({ data_type: 'bigint', is_nullable: 'YES' });
    expect(cols['google_drive_id']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['google_drive_url']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['thumbnail_url']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['thumb_expires_at']).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    expect(cols['width']).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(cols['height']).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(cols['duration_seconds']).toMatchObject({ data_type: 'real', is_nullable: 'YES' });
    expect(cols['status']).toMatchObject({ data_type: 'USER-DEFINED', udt_name: 'asset_status', is_nullable: 'NO' });
    expect(cols['status'].column_default).toContain('active');
    expect(cols['tags']).toMatchObject({ data_type: 'jsonb' });
    expect(cols['version']).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
    expect(cols['version'].column_default).toContain('1');
    expect(cols['parent_asset_id']).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(cols['uploaded_by']).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
  });

  it('asset_products table has correct columns', async () => {
    const cols = await getColumns('asset_products');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['asset_id']).toMatchObject({ data_type: 'uuid' });
    expect(cols['product_id']).toMatchObject({ data_type: 'uuid' });
    expect(cols['variant_id']).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(cols['role']).toMatchObject({ data_type: 'text' });
    expect(cols['role'].column_default).toContain('gallery');
    expect(cols['sort_order']).toMatchObject({ data_type: 'integer' });
    expect(cols['sort_order'].column_default).toContain('0');
  });

  it('audit_log table has correct columns', async () => {
    const cols = await getColumns('audit_log');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['user_id']).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(cols['action']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['entity_type']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols['entity_id']).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(cols['details']).toMatchObject({ data_type: 'jsonb' });
    expect(cols['created_at']).toMatchObject({ data_type: 'timestamp with time zone' });
  });

  it('refresh_tokens table has correct columns', async () => {
    const cols = await getColumns('refresh_tokens');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['user_id']).toMatchObject({ data_type: 'uuid' });
    expect(cols['token_hash']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['used']).toMatchObject({ data_type: 'boolean' });
    expect(cols['used'].column_default).toContain('false');
    expect(cols['expires_at']).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('background_jobs table has correct columns', async () => {
    const cols = await getColumns('background_jobs');
    expect(cols['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols['type']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['status']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols['status'].column_default).toContain('pending');
    expect(cols['user_id']).toMatchObject({ data_type: 'uuid', is_nullable: 'YES' });
    expect(cols['progress']).toMatchObject({ data_type: 'integer' });
    expect(cols['progress'].column_default).toContain('0');
    expect(cols['result']).toMatchObject({ data_type: 'jsonb' });
    expect(cols['error']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
  });
});

// ── 1.T3 ─────────────────────────────────────────────────────────────────────

describe('1.T3 — Enum verification', () => {
  it('user_role enum has correct values', async () => {
    const db = getTestDb();
    const result = await db.raw(`
      SELECT json_agg(enumlabel ORDER BY enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'user_role'
    `);
    expect(result.rows[0].values).toEqual(['admin', 'editor', 'viewer']);
  });

  it('asset_type enum has correct values', async () => {
    const db = getTestDb();
    const result = await db.raw(`
      SELECT json_agg(enumlabel ORDER BY enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'asset_type'
    `);
    expect(result.rows[0].values).toEqual(['image', 'video', 'text', 'document', 'other']);
  });

  it('asset_status enum has correct values', async () => {
    const db = getTestDb();
    const result = await db.raw(`
      SELECT json_agg(enumlabel ORDER BY enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'asset_status'
    `);
    expect(result.rows[0].values).toEqual(['active', 'archived', 'deleted']);
  });
});

// ── 1.T4 ─────────────────────────────────────────────────────────────────────

describe('1.T4 — Foreign key constraint tests', () => {
  it('product_variants rejects insert with non-existent product_id', async () => {
    const trx = await beginTestTransaction();
    try {
      await expect(
        trx.raw(`INSERT INTO product_variants (product_id, sku) VALUES (gen_random_uuid(), 'X')`)
      ).rejects.toThrow();
    } finally {
      await trx.rollback();
    }
  });

  it('product_variants cascade-deletes when parent product is deleted', async () => {
    const trx = await beginTestTransaction();
    try {
      const [product] = await trx('products').insert({ title: 'FK Test Product' }).returning('id');
      await trx('product_variants').insert({ product_id: product.id, sku: 'FK-001' });
      await trx('product_variants').insert({ product_id: product.id, sku: 'FK-002' });

      const countBefore = await trx('product_variants').where('product_id', product.id).count('id as n');
      expect(Number(countBefore[0].n)).toBe(2);

      await trx('products').where('id', product.id).delete();

      const countAfter = await trx('product_variants').where('product_id', product.id).count('id as n');
      expect(Number(countAfter[0].n)).toBe(0);
    } finally {
      await trx.rollback();
    }
  });

  it('assets cascade-deletes asset_products when asset is deleted', async () => {
    const trx = await beginTestTransaction();
    try {
      const [product] = await trx('products').insert({ title: 'Cascade Test' }).returning('id');
      const [asset] = await trx('assets')
        .insert({ file_name: 'test.jpg', mime_type: 'image/jpeg', google_drive_id: 'drive-fk-test-1' })
        .returning('id');
      await trx('asset_products').insert({ asset_id: asset.id, product_id: product.id });

      await trx('assets').where('id', asset.id).delete();

      const links = await trx('asset_products').where('asset_id', asset.id);
      expect(links).toHaveLength(0);
    } finally {
      await trx.rollback();
    }
  });

  it('assets sets uploaded_by to NULL when user is deleted (SET NULL)', async () => {
    const trx = await beginTestTransaction();
    try {
      const [user] = await trx('users')
        .insert({ email: 'fk-test@example.com', name: 'FK User' })
        .returning('id');
      const [asset] = await trx('assets')
        .insert({ file_name: 'fk-test.jpg', mime_type: 'image/jpeg', google_drive_id: 'drive-fk-test-2', uploaded_by: user.id })
        .returning('*');

      expect(asset.uploaded_by).toBe(user.id);

      await trx('users').where('id', user.id).delete();

      const [updated] = await trx('assets').where('id', asset.id).select('uploaded_by');
      expect(updated.uploaded_by).toBeNull();
    } finally {
      await trx.rollback();
    }
  });

  it('audit_log sets user_id to NULL when user is deleted (SET NULL)', async () => {
    const trx = await beginTestTransaction();
    try {
      const [user] = await trx('users')
        .insert({ email: 'audit-fk@example.com', name: 'Audit FK User' })
        .returning('id');
      const [log] = await trx('audit_log')
        .insert({ user_id: user.id, action: 'upload', entity_type: 'asset', entity_id: null })
        .returning('*');

      expect(log.user_id).toBe(user.id);

      await trx('users').where('id', user.id).delete();

      const [updated] = await trx('audit_log').where('id', log.id).select('user_id');
      expect(updated.user_id).toBeNull();
    } finally {
      await trx.rollback();
    }
  });

  it('asset_products sets variant_id to NULL when variant is deleted (SET NULL)', async () => {
    const trx = await beginTestTransaction();
    try {
      const [product] = await trx('products').insert({ title: 'Variant FK Test' }).returning('id');
      const [variant] = await trx('product_variants')
        .insert({ product_id: product.id, sku: 'VAR-FK-001' })
        .returning('id');
      const [asset] = await trx('assets')
        .insert({ file_name: 'var-fk.jpg', mime_type: 'image/jpeg', google_drive_id: 'drive-fk-test-3' })
        .returning('id');
      const [link] = await trx('asset_products')
        .insert({ asset_id: asset.id, product_id: product.id, variant_id: variant.id })
        .returning('*');

      expect(link.variant_id).toBe(variant.id);

      await trx('product_variants').where('id', variant.id).delete();

      const [updated] = await trx('asset_products').where('id', link.id).select('variant_id');
      expect(updated.variant_id).toBeNull();
    } finally {
      await trx.rollback();
    }
  });

  it('refresh_tokens cascade-deletes when user is deleted', async () => {
    const trx = await beginTestTransaction();
    try {
      const [user] = await trx('users')
        .insert({ email: 'token-fk@example.com', name: 'Token FK User' })
        .returning('id');
      await trx('refresh_tokens').insert({
        user_id: user.id,
        token_hash: 'abc123hash',
        expires_at: new Date(Date.now() + 3600_000),
      });

      await trx('users').where('id', user.id).delete();

      const tokens = await trx('refresh_tokens').where('user_id', user.id);
      expect(tokens).toHaveLength(0);
    } finally {
      await trx.rollback();
    }
  });
});

// ── 1.T5 ─────────────────────────────────────────────────────────────────────

describe('1.T5 — Partial unique index tests', () => {
  it('rejects duplicate (asset_id, product_id, role) with variant_id = NULL', async () => {
    const trx = await beginTestTransaction();
    try {
      const [product] = await trx('products').insert({ title: 'Unique Test Product' }).returning('id');
      const [asset] = await trx('assets')
        .insert({ file_name: 'unique.jpg', mime_type: 'image/jpeg', google_drive_id: 'drive-unique-1' })
        .returning('id');

      await trx('asset_products').insert({
        asset_id: asset.id,
        product_id: product.id,
        variant_id: null,
        role: 'hero',
      });

      await expect(
        trx('asset_products').insert({
          asset_id: asset.id,
          product_id: product.id,
          variant_id: null,
          role: 'hero',
        })
      ).rejects.toThrow();
    } finally {
      await trx.rollback();
    }
  });

  it('allows same (asset_id, product_id, role) with a different non-null variant_id', async () => {
    const trx = await beginTestTransaction();
    try {
      const [product] = await trx('products').insert({ title: 'Variant Unique Product' }).returning('id');
      const [variant] = await trx('product_variants')
        .insert({ product_id: product.id, sku: 'VAR-U-001' })
        .returning('id');
      const [asset] = await trx('assets')
        .insert({ file_name: 'variant-unique.jpg', mime_type: 'image/jpeg', google_drive_id: 'drive-unique-2' })
        .returning('id');

      // Product-level link (variant_id = NULL)
      await trx('asset_products').insert({
        asset_id: asset.id,
        product_id: product.id,
        variant_id: null,
        role: 'hero',
      });

      // Variant-level link for same asset+product+role — allowed (distinct partial index)
      await trx('asset_products').insert({
        asset_id: asset.id,
        product_id: product.id,
        variant_id: variant.id,
        role: 'hero',
      });

      const links = await trx('asset_products').where('asset_id', asset.id);
      expect(links).toHaveLength(2);
    } finally {
      await trx.rollback();
    }
  });

  it('rejects duplicate (asset_id, product_id, variant_id, role) when variant_id is not null', async () => {
    const trx = await beginTestTransaction();
    try {
      const [product] = await trx('products').insert({ title: 'Variant Dup Product' }).returning('id');
      const [variant] = await trx('product_variants')
        .insert({ product_id: product.id, sku: 'VAR-DUP-001' })
        .returning('id');
      const [asset] = await trx('assets')
        .insert({ file_name: 'variant-dup.jpg', mime_type: 'image/jpeg', google_drive_id: 'drive-unique-3' })
        .returning('id');

      await trx('asset_products').insert({
        asset_id: asset.id,
        product_id: product.id,
        variant_id: variant.id,
        role: 'gallery',
      });

      await expect(
        trx('asset_products').insert({
          asset_id: asset.id,
          product_id: product.id,
          variant_id: variant.id,
          role: 'gallery',
        })
      ).rejects.toThrow();
    } finally {
      await trx.rollback();
    }
  });
});

// ── 1.T6 ─────────────────────────────────────────────────────────────────────

describe('1.T6 — Materialised view test', () => {
  it('contains correct fields after refresh', async () => {
    const db = getTestDb();

    // Use a transaction for inserts so we can roll back, but refresh the view
    // within the same transaction so it sees the uncommitted data
    const trx = await beginTestTransaction();
    try {
      const [user] = await trx('users')
        .insert({ email: 'mv-test@example.com', name: 'MV Test User' })
        .returning('id');

      const [product] = await trx('products')
        .insert({ title: 'Blue Polo Shirt' })
        .returning('id');

      const [variant] = await trx('product_variants')
        .insert({ product_id: product.id, sku: 'BPS-001', title: 'Blue / S' })
        .returning('id');

      const [asset] = await trx('assets')
        .insert({
          file_name: 'polo-hero.jpg',
          asset_type: 'image',
          mime_type: 'image/jpeg',
          google_drive_id: 'drive-mv-test-1',
          uploaded_by: user.id,
          tags: JSON.stringify({ colour: 'Navy', season: 'AW26' }),
        })
        .returning('id');

      await trx('asset_products').insert({
        asset_id: asset.id,
        product_id: product.id,
        variant_id: variant.id,
        role: 'hero',
      });

      await trx.raw('REFRESH MATERIALIZED VIEW asset_search_mv');

      const rows = await trx('asset_search_mv').where('asset_id', asset.id);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row.file_name).toBe('polo-hero.jpg');
      expect(row.product_titles).toContain('Blue Polo Shirt');
      expect(row.skus).toContain('BPS-001');
      expect(row.tag_text).toContain('Navy');
      expect(row.tag_text).toContain('AW26');
      expect(row.search_text).toContain('polo-hero.jpg');
      expect(row.search_text).toContain('Blue Polo Shirt');
      expect(row.search_text).toContain('BPS-001');
    } finally {
      await trx.rollback();
    }
  });
});

// ── 1.T7 ─────────────────────────────────────────────────────────────────────

describe('1.T7 — Migration rollback and idempotency', () => {
  it('rollback drops all tables, enums, and the materialised view', async () => {
    await rollbackMigrations();

    const db = getTestDb();

    const tables = await db('information_schema.tables')
      .where('table_schema', 'public')
      .whereIn('table_name', EXPECTED_TABLES)
      .select('table_name');
    expect(tables).toHaveLength(0);

    const viewResult = await db.raw(`
      SELECT COUNT(*) AS n
      FROM pg_matviews
      WHERE schemaname = 'public' AND matviewname = 'asset_search_mv'
    `);
    expect(Number(viewResult.rows[0].n)).toBe(0);

    const enumResult = await db.raw(`
      SELECT COUNT(*) AS n
      FROM pg_type
      WHERE typname IN ('user_role', 'asset_type', 'asset_status') AND typtype = 'e'
    `);
    expect(Number(enumResult.rows[0].n)).toBe(0);
  });

  it('re-running migrations after rollback succeeds (idempotency)', async () => {
    await runMigrations();

    const db = getTestDb();

    const tables = await db('information_schema.tables')
      .where('table_schema', 'public')
      .whereIn('table_name', EXPECTED_TABLES)
      .select('table_name');
    expect(tables).toHaveLength(EXPECTED_TABLES.length);

    const viewResult = await db.raw(`
      SELECT COUNT(*) AS n
      FROM pg_matviews
      WHERE schemaname = 'public' AND matviewname = 'asset_search_mv'
    `);
    expect(Number(viewResult.rows[0].n)).toBe(1);
  });
});
