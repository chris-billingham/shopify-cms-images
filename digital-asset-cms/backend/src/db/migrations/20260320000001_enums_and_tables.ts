import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  await knex.raw(`CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer')`);
  await knex.raw(`CREATE TYPE asset_type AS ENUM ('image', 'video', 'text', 'document', 'other')`);
  await knex.raw(`CREATE TYPE asset_status AS ENUM ('active', 'archived', 'deleted')`);

  // ── Users ──
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('email').unique().notNullable();
    table.text('name').notNullable();
    table.specificType('role', 'user_role').notNullable().defaultTo('viewer');
    table.text('status').notNullable().defaultTo('active');
    table.text('avatar_url').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // ── Products ──
  await knex.schema.createTable('products', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.bigInteger('shopify_id').unique().nullable();
    table.text('title').notNullable();
    table.text('category').nullable();
    table.text('vendor').nullable();
    table.text('status').defaultTo('active');
    table.specificType('shopify_tags', 'text[]').defaultTo(knex.raw("'{}'"));
    table.timestamp('synced_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // ── Product Variants ──
  await knex.schema.createTable('product_variants', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('product_id').references('id').inTable('products').onDelete('CASCADE');
    table.bigInteger('shopify_variant_id').unique().nullable();
    table.text('sku').nullable();
    table.text('title').nullable();
    table.decimal('price', 10, 2).nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // ── Assets ──
  await knex.schema.createTable('assets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('file_name').notNullable();
    table.specificType('asset_type', 'asset_type').notNullable().defaultTo('other');
    table.text('mime_type').notNullable();
    table.bigInteger('file_size_bytes').nullable();
    table.text('google_drive_id').unique().notNullable();
    table.text('google_drive_url').nullable();
    table.text('thumbnail_url').nullable();
    table.timestamp('thumb_expires_at', { useTz: true }).nullable();
    table.integer('width').nullable();
    table.integer('height').nullable();
    table.specificType('duration_seconds', 'real').nullable();
    table.specificType('status', 'asset_status').notNullable().defaultTo('active');
    table.specificType('tags', 'jsonb').defaultTo(knex.raw("'{}'"));
    table.integer('version').notNullable().defaultTo(1);
    table.uuid('parent_asset_id').references('id').inTable('assets').nullable();
    table.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // ── Asset–Product Links ──
  await knex.schema.createTable('asset_products', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('asset_id').references('id').inTable('assets').onDelete('CASCADE');
    table.uuid('product_id').references('id').inTable('products').onDelete('CASCADE');
    table.uuid('variant_id').references('id').inTable('product_variants').onDelete('SET NULL').nullable();
    table.text('role').defaultTo('gallery');
    table.integer('sort_order').defaultTo(0);
    // Uniqueness enforced via partial indexes in migration 2
  });

  // ── Audit Log ──
  await knex.schema.createTable('audit_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.text('action').notNullable();
    table.text('entity_type').nullable();
    table.uuid('entity_id').nullable();
    table.specificType('details', 'jsonb').defaultTo(knex.raw("'{}'"));
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // ── Refresh Tokens ──
  await knex.schema.createTable('refresh_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.text('token_hash').unique().notNullable();
    table.boolean('used').defaultTo(false);
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // ── Background Jobs ──
  await knex.schema.createTable('background_jobs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('type').notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.uuid('user_id').references('id').inTable('users').nullable();
    table.integer('progress').defaultTo(0);
    table.specificType('result', 'jsonb').defaultTo(knex.raw("'{}'"));
    table.text('error').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('background_jobs');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('asset_products');
  await knex.schema.dropTableIfExists('assets');
  await knex.schema.dropTableIfExists('product_variants');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('users');

  await knex.raw('DROP TYPE IF EXISTS asset_status');
  await knex.raw('DROP TYPE IF EXISTS asset_type');
  await knex.raw('DROP TYPE IF EXISTS user_role');
}
