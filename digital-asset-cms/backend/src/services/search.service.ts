import { db } from '../db/connection.js';
import { config } from '../config/index.js';

export interface SearchParams {
  q?: string;
  sku?: string;
  category?: string;
  type?: string;
  status?: string;
  product_status?: string;
  tags?: Record<string, string>;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
  facets?: boolean;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface SearchResult {
  assets: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  facets?: {
    asset_type: FacetValue[];
    product_status: FacetValue[];
    tags: Record<string, FacetValue[]>;
  };
}

const ALLOWED_SORT_COLS: Record<string, string> = {
  file_name: 'file_name',
  created_at: 'created_at',
  relevance: 'relevance',
  file_size: 'file_size',
};

export async function searchAssets(params: SearchParams): Promise<SearchResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = (page - 1) * limit;
  const order = params.order === 'asc' ? 'ASC' : 'DESC';
  const tags = params.tags ?? {};

  // Build shared WHERE conditions (without table prefix for base queries)
  const conditions: string[] = [];
  const condBindings: unknown[] = [];

  if (params.type) {
    conditions.push('m.asset_type = ?');
    condBindings.push(params.type);
  }
  if (params.status) {
    conditions.push('m.status = ?');
    condBindings.push(params.status);
  }
  if (params.sku) {
    conditions.push('COALESCE(? = ANY(m.skus), false)');
    condBindings.push(params.sku);
  }
  if (params.category) {
    conditions.push('m.tags @> ?::jsonb');
    condBindings.push(JSON.stringify({ category: params.category }));
  }
  for (const [key, value] of Object.entries(tags)) {
    conditions.push('m.tags @> ?::jsonb');
    condBindings.push(JSON.stringify({ [key]: value }));
  }
  if (params.product_status) {
    if (params.product_status === 'unlinked') {
      conditions.push('NOT EXISTS (SELECT 1 FROM asset_products ap WHERE ap.asset_id = m.asset_id)');
    } else if (params.product_status === 'linked-unpushed') {
      conditions.push(
        'EXISTS (SELECT 1 FROM asset_products ap JOIN products p ON p.id = ap.product_id WHERE ap.asset_id = m.asset_id AND p.shopify_id IS NULL)'
      );
    } else {
      conditions.push(
        'EXISTS (SELECT 1 FROM asset_products ap JOIN products p ON p.id = ap.product_id WHERE ap.asset_id = m.asset_id AND p.shopify_id IS NOT NULL AND p.status = ?)'
      );
      condBindings.push(params.product_status);
    }
  }

  const whereStr = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  let queryStr: string;
  const queryBindings: unknown[] = [];

  if (params.q) {
    const wSku = config.SEARCH_WEIGHT_SKU;
    const wTitle = config.SEARCH_WEIGHT_PRODUCT_TITLE;
    const wTag = config.SEARCH_WEIGHT_TAG_VALUE;

    // Requested sort: relevance (default), created_at, or file_name
    const sortKey = params.sort && ALLOWED_SORT_COLS[params.sort] ? params.sort : 'relevance';
    const sortClause =
      sortKey === 'file_name'
        ? `file_name ${order}`
        : sortKey === 'created_at'
          ? `created_at ${order}`
          : sortKey === 'file_size'
            ? `file_size ${order}`
            : 'relevance DESC';

    queryBindings.push(
      params.q,        // word_similarity(?, search_text)
      params.q, wSku,  // similarity(sku_val, ?) * ?
      params.q, wTitle, // word_similarity(?, pt) * ?
      params.q, wTag,  // word_similarity(?, tag_text) * ?
      ...condBindings,
      params.q,        // ? <% search_text
      limit,
      offset,
    );

    queryStr = `
      WITH scored AS (
        SELECT
          m.asset_id AS id, m.file_name, m.asset_type, m.status, m.tags, m.created_at, m.updated_at,
          m.product_titles, m.skus, m.tag_text, m.search_text,
          a.thumbnail_url, a.file_size_bytes AS file_size, a.version, a.google_drive_id AS drive_file_id, a.mime_type,
          GREATEST(
            word_similarity(?, m.search_text),
            COALESCE((
              SELECT MAX(similarity(sku_val, ?) * ?)
              FROM unnest(m.skus) AS sku_val
            ), 0),
            COALESCE((
              SELECT MAX(word_similarity(?, pt) * ?)
              FROM unnest(m.product_titles) AS pt
            ), 0),
            COALESCE(word_similarity(?, m.tag_text) * ?, 0)
          ) AS relevance
        FROM asset_search_mv m
        JOIN assets a ON a.id = m.asset_id
        WHERE TRUE ${whereStr}
          AND ? <% m.search_text
      )
      SELECT *, COUNT(*) OVER() AS total_count
      FROM scored
      WHERE relevance > 0.1
      ORDER BY ${sortClause}
      LIMIT ? OFFSET ?
    `;
  } else {
    const sortKey = params.sort && ALLOWED_SORT_COLS[params.sort] && params.sort !== 'relevance'
      ? params.sort
      : 'created_at';
    const sortClause = sortKey === 'file_size'
      ? `a.file_size_bytes ${order}`
      : `m.${sortKey} ${order}`;

    queryBindings.push(...condBindings, limit, offset);

    queryStr = `
      SELECT
        m.asset_id AS id, m.file_name, m.asset_type, m.status, m.tags, m.created_at, m.updated_at,
        m.product_titles, m.skus, m.tag_text, m.search_text,
        a.thumbnail_url, a.file_size_bytes AS file_size, a.version, a.google_drive_id AS drive_file_id, a.mime_type,
        COUNT(*) OVER() AS total_count
      FROM asset_search_mv m
      JOIN assets a ON a.id = m.asset_id
      WHERE TRUE ${whereStr}
      ORDER BY ${sortClause}
      LIMIT ? OFFSET ?
    `;
  }

  const result = await db.raw<{ rows: Array<Record<string, unknown>> }>(queryStr, queryBindings);
  const rows = result.rows;
  const total = rows.length > 0 ? Number(rows[0]['total_count']) : 0;
  const assets = rows.map(({ total_count: _, ...rest }) => rest);

  const response: SearchResult = { assets, total, page, limit };
  if (params.facets) {
    response.facets = await computeFacets(params);
  }

  return response;
}

async function computeFacets(
  params: SearchParams,
): Promise<NonNullable<SearchResult['facets']>> {
  const tags = params.tags ?? {};
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.type) {
    conditions.push('m.asset_type = ?');
    bindings.push(params.type);
  }
  if (params.status) {
    conditions.push('m.status = ?');
    bindings.push(params.status);
  }
  if (params.sku) {
    conditions.push('COALESCE(? = ANY(m.skus), false)');
    bindings.push(params.sku);
  }
  if (params.category) {
    conditions.push('m.tags @> ?::jsonb');
    bindings.push(JSON.stringify({ category: params.category }));
  }
  for (const [key, value] of Object.entries(tags)) {
    conditions.push('m.tags @> ?::jsonb');
    bindings.push(JSON.stringify({ [key]: value }));
  }
  if (params.q) {
    conditions.push('? <% m.search_text');
    bindings.push(params.q);
  }

  const andStr = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  // Single query: CTE materialises the filtered set once; UNION ALL branches
  // compute all three facet groups without extra round trips.
  const result = await db.raw<{
    rows: Array<{ facet_group: string; key: string; subkey: string | null; count: string }>;
  }>(
    `WITH filtered AS (
       SELECT m.asset_id, m.asset_type, m.tags
       FROM asset_search_mv m
       WHERE TRUE ${andStr}
     )
     SELECT 'type'::text AS facet_group, asset_type::text AS key, NULL::text AS subkey,
            COUNT(DISTINCT asset_id)::int AS count
     FROM filtered
     GROUP BY asset_type

     UNION ALL

     SELECT 'ps'::text, 'unlinked', NULL,
            COUNT(DISTINCT f.asset_id)::int
     FROM filtered f
     WHERE NOT EXISTS (SELECT 1 FROM asset_products ap WHERE ap.asset_id = f.asset_id)

     UNION ALL

     SELECT 'ps'::text, 'linked-unpushed', NULL,
            COUNT(DISTINCT f.asset_id)::int
     FROM filtered f
     WHERE EXISTS (
       SELECT 1 FROM asset_products ap
       JOIN products p ON p.id = ap.product_id
       WHERE ap.asset_id = f.asset_id AND p.shopify_id IS NULL
     )

     UNION ALL

     SELECT 'ps'::text, p.status::text, NULL,
            COUNT(DISTINCT f.asset_id)::int
     FROM filtered f
     JOIN asset_products ap ON ap.asset_id = f.asset_id
     JOIN products p ON p.id = ap.product_id
     WHERE p.shopify_id IS NOT NULL
     GROUP BY p.status

     UNION ALL

     SELECT 'tag'::text, kv.key, kv.value,
            COUNT(DISTINCT f.asset_id)::int
     FROM filtered f, jsonb_each_text(f.tags) AS kv(key, value)
     GROUP BY kv.key, kv.value`,
    bindings,
  );

  const assetTypeFacets: FacetValue[] = [];
  const productStatusFacets: FacetValue[] = [];
  const tagFacets: Record<string, FacetValue[]> = {};

  for (const row of result.rows) {
    const count = Number(row.count);
    if (count === 0) continue;
    if (row.facet_group === 'type') {
      assetTypeFacets.push({ value: row.key, count });
    } else if (row.facet_group === 'ps') {
      productStatusFacets.push({ value: row.key, count });
    } else if (row.facet_group === 'tag') {
      if (!tagFacets[row.key]) tagFacets[row.key] = [];
      tagFacets[row.key].push({ value: row.subkey!, count });
    }
  }

  return { asset_type: assetTypeFacets, product_status: productStatusFacets, tags: tagFacets };
}
