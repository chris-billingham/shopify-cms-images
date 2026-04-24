import { db } from '../db/connection.js';

// ── Error types ───────────────────────────────────────────────────────────────

export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Product ${id} not found`);
    this.name = 'ProductNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpsertProductData {
  title: string;
  category?: string | null;
  vendor?: string | null;
  status?: string;
  shopifyTags?: string[];
  shopifyCreatedAt?: string | null;
}

export interface UpsertVariantData {
  sku?: string | null;
  title?: string | null;
  price?: string | null;
  inventory_quantity?: number | null;
}

// ── Product operations ────────────────────────────────────────────────────────

export async function upsertProduct(
  shopifyId: number | null,
  data: UpsertProductData
): Promise<Record<string, unknown>> {
  const insertData = {
    shopify_id: shopifyId,
    title: data.title,
    category: data.category ?? null,
    vendor: data.vendor ?? null,
    status: data.status ?? 'active',
    shopify_tags: data.shopifyTags ?? [],
    shopify_created_at: data.shopifyCreatedAt ?? null,
    synced_at: shopifyId !== null ? new Date() : null,
    updated_at: new Date(),
  };

  if (shopifyId !== null) {
    const [row] = await db('products')
      .insert(insertData)
      .onConflict('shopify_id')
      .merge(['title', 'category', 'vendor', 'status', 'shopify_tags', 'synced_at', 'updated_at'])
      .returning('*');
    return row as Record<string, unknown>;
  }

  // No shopify_id — straight insert
  const [row] = await db('products').insert(insertData).returning('*');
  return row as Record<string, unknown>;
}

export async function getProduct(id: string): Promise<Record<string, unknown>> {
  const product = await db('products').where('id', id).first();
  if (!product) throw new ProductNotFoundError(id);

  const variants = await db('product_variants').where('product_id', id).orderBy('created_at', 'asc');
  const links = await db('asset_products').where('product_id', id).orderBy('sort_order', 'asc');

  return { ...product, variants, links } as Record<string, unknown>;
}

export async function listProducts(filters?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<Record<string, unknown>[]> {
  let query = db('products')
    .leftJoin('product_variants as pv', 'products.id', 'pv.product_id')
    .groupBy('products.id')
    .select('products.*', db.raw('COUNT(pv.id)::int AS variant_count'))
    .orderBy('products.created_at', 'desc');

  if (filters?.q) {
    query = query.whereRaw('products.title ILIKE ?', [`%${filters.q}%`]);
  }
  if (filters?.limit) query = query.limit(filters.limit);
  if (filters?.offset) query = query.offset(filters.offset);

  return (await query) as Record<string, unknown>[];
}

// ── Variant operations ────────────────────────────────────────────────────────

export async function upsertVariant(
  productId: string,
  shopifyVariantId: number | null,
  data: UpsertVariantData
): Promise<Record<string, unknown>> {
  const insertData = {
    product_id: productId,
    shopify_variant_id: shopifyVariantId,
    sku: data.sku ?? null,
    title: data.title ?? null,
    price: data.price ?? null,
    inventory_quantity: data.inventory_quantity ?? null,
    updated_at: new Date(),
  };

  if (shopifyVariantId !== null) {
    const [row] = await db('product_variants')
      .insert(insertData)
      .onConflict('shopify_variant_id')
      .merge(['product_id', 'sku', 'title', 'price', 'inventory_quantity', 'updated_at'])
      .returning('*');
    return row as Record<string, unknown>;
  }

  const [row] = await db('product_variants').insert(insertData).returning('*');
  return row as Record<string, unknown>;
}

export async function getVariants(productId: string): Promise<Record<string, unknown>[]> {
  return (await db('product_variants')
    .where('product_id', productId)
    .orderBy('created_at', 'asc')) as Record<string, unknown>[];
}
