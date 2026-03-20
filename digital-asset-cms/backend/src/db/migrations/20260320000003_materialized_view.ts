import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE MATERIALIZED VIEW asset_search_mv AS
    SELECT
      a.id AS asset_id,
      a.file_name,
      a.asset_type,
      a.status,
      a.tags,
      a.created_at,
      a.updated_at,
      array_agg(DISTINCT p.title) FILTER (WHERE p.title IS NOT NULL) AS product_titles,
      array_agg(DISTINCT pv.sku) FILTER (WHERE pv.sku IS NOT NULL) AS skus,
      (SELECT string_agg(value, ' ') FROM jsonb_each_text(a.tags)) AS tag_text,
      concat_ws(' ',
        a.file_name,
        array_to_string(array_agg(DISTINCT p.title) FILTER (WHERE p.title IS NOT NULL), ' '),
        array_to_string(array_agg(DISTINCT pv.sku) FILTER (WHERE pv.sku IS NOT NULL), ' '),
        (SELECT string_agg(value, ' ') FROM jsonb_each_text(a.tags))
      ) AS search_text
    FROM assets a
    LEFT JOIN asset_products ap ON a.id = ap.asset_id
    LEFT JOIN products p ON ap.product_id = p.id
    LEFT JOIN product_variants pv ON ap.variant_id = pv.id
    WHERE a.status = 'active'
    GROUP BY a.id
  `);

  await knex.raw('CREATE INDEX idx_search_mv_text_trgm ON asset_search_mv USING gin (search_text gin_trgm_ops)');
  await knex.raw('CREATE INDEX idx_search_mv_tag_text_trgm ON asset_search_mv USING gin (tag_text gin_trgm_ops)');
  await knex.raw('CREATE INDEX idx_search_mv_asset_type ON asset_search_mv (asset_type)');
  await knex.raw('CREATE INDEX idx_search_mv_tags ON asset_search_mv USING gin (tags)');
  await knex.raw('CREATE UNIQUE INDEX idx_search_mv_asset_id ON asset_search_mv (asset_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS asset_search_mv');
}
