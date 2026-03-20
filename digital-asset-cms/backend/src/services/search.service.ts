import { db } from '../db/connection.js';
import { config } from '../config/index.js';

export interface SearchParams {
  q?: string;
  sku?: string;
  category?: string;
  type?: string;
  status?: string;
  tags?: Record<string, string>;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
  facets?: boolean;
}

export interface SearchResult {
  assets: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  facets?: {
    asset_type: Record<string, number>;
    tags: Record<string, Record<string, number>>;
  };
}

const ALLOWED_SORT_COLS: Record<string, string> = {
  file_name: 'file_name',
  created_at: 'created_at',
  relevance: 'relevance',
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
    conditions.push('asset_type = ?');
    condBindings.push(params.type);
  }
  if (params.status) {
    conditions.push('status = ?');
    condBindings.push(params.status);
  }
  if (params.sku) {
    conditions.push('COALESCE(? = ANY(skus), false)');
    condBindings.push(params.sku);
  }
  if (params.category) {
    conditions.push('tags @> ?::jsonb');
    condBindings.push(JSON.stringify({ category: params.category }));
  }
  for (const [key, value] of Object.entries(tags)) {
    conditions.push('tags @> ?::jsonb');
    condBindings.push(JSON.stringify({ [key]: value }));
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
          : 'relevance DESC';

    queryBindings.push(
      params.q,        // similarity(search_text, ?)
      params.q, wSku,  // similarity(sku_val, ?) * ?
      params.q, wTitle, // similarity(pt, ?) * ?
      params.q, wTag,  // similarity(tag_text, ?) * ?
      ...condBindings,
      params.q,        // search_text % ?
      limit,
      offset,
    );

    queryStr = `
      WITH scored AS (
        SELECT
          asset_id, file_name, asset_type, status, tags, created_at, updated_at,
          product_titles, skus, tag_text, search_text,
          GREATEST(
            similarity(search_text, ?),
            COALESCE((
              SELECT MAX(similarity(sku_val, ?) * ?)
              FROM unnest(skus) AS sku_val
            ), 0),
            COALESCE((
              SELECT MAX(similarity(pt, ?) * ?)
              FROM unnest(product_titles) AS pt
            ), 0),
            COALESCE(similarity(tag_text, ?) * ?, 0)
          ) AS relevance
        FROM asset_search_mv
        WHERE TRUE ${whereStr}
          AND search_text % ?
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
    const sortClause = `${sortKey} ${order}`;

    queryBindings.push(...condBindings, limit, offset);

    queryStr = `
      SELECT
        asset_id, file_name, asset_type, status, tags, created_at, updated_at,
        product_titles, skus, tag_text, search_text,
        COUNT(*) OVER() AS total_count
      FROM asset_search_mv
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
    conditions.push('m.search_text % ?');
    bindings.push(params.q);
  }

  const whereStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const [typeResult, tagResult] = await Promise.all([
    db.raw<{ rows: Array<{ asset_type: string; count: number }> }>(
      `SELECT m.asset_type, COUNT(DISTINCT m.asset_id)::int AS count
       FROM asset_search_mv m
       ${whereStr}
       GROUP BY m.asset_type`,
      bindings,
    ),
    db.raw<{ rows: Array<{ key: string; value: string; count: number }> }>(
      `SELECT kv.key, kv.value, COUNT(DISTINCT m.asset_id)::int AS count
       FROM asset_search_mv m, jsonb_each_text(m.tags) AS kv(key, value)
       ${whereStr}
       GROUP BY kv.key, kv.value
       ORDER BY kv.key, kv.value`,
      bindings,
    ),
  ]);

  const assetTypeFacets: Record<string, number> = {};
  for (const row of typeResult.rows) {
    assetTypeFacets[row.asset_type] = Number(row.count);
  }

  const tagFacets: Record<string, Record<string, number>> = {};
  for (const row of tagResult.rows) {
    if (!tagFacets[row.key]) tagFacets[row.key] = {};
    tagFacets[row.key][row.value] = Number(row.count);
  }

  return { asset_type: assetTypeFacets, tags: tagFacets };
}
