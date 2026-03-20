import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // assets
  await knex.raw('CREATE INDEX idx_assets_status ON assets (status)');
  await knex.raw('CREATE INDEX idx_assets_tags ON assets USING gin (tags)');
  await knex.raw('CREATE INDEX idx_assets_file_name_trgm ON assets USING gin (file_name gin_trgm_ops)');
  await knex.raw('CREATE INDEX idx_assets_parent ON assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL');

  // products
  await knex.raw('CREATE INDEX idx_products_title_trgm ON products USING gin (title gin_trgm_ops)');

  // product_variants
  await knex.raw('CREATE INDEX idx_product_variants_sku ON product_variants (sku)');
  await knex.raw('CREATE INDEX idx_product_variants_product ON product_variants (product_id)');

  // asset_products (B-tree + partial unique)
  await knex.raw('CREATE INDEX idx_asset_products_asset ON asset_products (asset_id)');
  await knex.raw('CREATE INDEX idx_asset_products_product ON asset_products (product_id)');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_ap_unique_with_variant
      ON asset_products (asset_id, product_id, variant_id, role)
      WHERE variant_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_ap_unique_without_variant
      ON asset_products (asset_id, product_id, role)
      WHERE variant_id IS NULL
  `);

  // audit_log
  await knex.raw('CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC)');
  await knex.raw('CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id)');

  // refresh_tokens
  await knex.raw('CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_refresh_tokens_user');
  await knex.raw('DROP INDEX IF EXISTS idx_audit_log_entity');
  await knex.raw('DROP INDEX IF EXISTS idx_audit_log_created');
  await knex.raw('DROP INDEX IF EXISTS idx_ap_unique_without_variant');
  await knex.raw('DROP INDEX IF EXISTS idx_ap_unique_with_variant');
  await knex.raw('DROP INDEX IF EXISTS idx_asset_products_product');
  await knex.raw('DROP INDEX IF EXISTS idx_asset_products_asset');
  await knex.raw('DROP INDEX IF EXISTS idx_product_variants_product');
  await knex.raw('DROP INDEX IF EXISTS idx_product_variants_sku');
  await knex.raw('DROP INDEX IF EXISTS idx_products_title_trgm');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_parent');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_file_name_trgm');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_tags');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_status');
}
