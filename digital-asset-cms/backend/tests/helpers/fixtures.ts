import type { Knex } from 'knex';
import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserFixture {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  status: string;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductFixture {
  id: string;
  shopify_id: number | null;
  title: string;
  category: string | null;
  vendor: string | null;
  status: string;
  shopify_tags: string[];
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductVariantFixture {
  id: string;
  product_id: string;
  shopify_variant_id: number | null;
  sku: string | null;
  title: string | null;
  price: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AssetFixture {
  id: string;
  file_name: string;
  asset_type: 'image' | 'video' | 'text' | 'document' | 'other';
  mime_type: string;
  file_size_bytes: number | null;
  google_drive_id: string;
  google_drive_url: string | null;
  thumbnail_url: string | null;
  thumb_expires_at: Date | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: 'active' | 'archived' | 'deleted';
  tags: Record<string, string>;
  version: number;
  parent_asset_id: string | null;
  uploaded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

// ── Factory Functions ─────────────────────────────────────────────────────────

let _userCounter = 0;
export function makeUser(overrides: Partial<UserFixture> = {}): Omit<UserFixture, 'created_at' | 'updated_at'> {
  _userCounter++;
  return {
    id: randomUUID(),
    email: `user${_userCounter}@example.com`,
    name: `Test User ${_userCounter}`,
    role: 'viewer',
    status: 'active',
    avatar_url: null,
    ...overrides,
  };
}

let _productCounter = 0;
export function makeProduct(overrides: Partial<ProductFixture> = {}): Omit<ProductFixture, 'created_at' | 'updated_at' | 'synced_at'> {
  _productCounter++;
  return {
    id: randomUUID(),
    shopify_id: null,
    title: `Test Product ${_productCounter}`,
    category: null,
    vendor: null,
    status: 'active',
    shopify_tags: [],
    ...overrides,
  };
}

let _variantCounter = 0;
export function makeVariant(productId: string, overrides: Partial<ProductVariantFixture> = {}): Omit<ProductVariantFixture, 'created_at' | 'updated_at'> {
  _variantCounter++;
  return {
    id: randomUUID(),
    product_id: productId,
    shopify_variant_id: null,
    sku: `SKU-${_variantCounter}`,
    title: `Variant ${_variantCounter}`,
    price: '9.99',
    ...overrides,
  };
}

let _assetCounter = 0;
export function makeAsset(userId?: string, overrides: Partial<AssetFixture> = {}): Omit<AssetFixture, 'created_at' | 'updated_at'> {
  _assetCounter++;
  return {
    id: randomUUID(),
    file_name: `test-image-${_assetCounter}.jpg`,
    asset_type: 'image',
    mime_type: 'image/jpeg',
    file_size_bytes: 1024 * 100,
    google_drive_id: `drive-id-${_assetCounter}`,
    google_drive_url: null,
    thumbnail_url: null,
    thumb_expires_at: null,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    status: 'active',
    tags: {},
    version: 1,
    parent_asset_id: null,
    uploaded_by: userId ?? null,
    ...overrides,
  };
}

// ── DB Insert Helpers ─────────────────────────────────────────────────────────

export async function createUser(db: Knex, overrides: Partial<UserFixture> = {}): Promise<UserFixture> {
  const user = makeUser(overrides);
  const [row] = await db('users').insert(user).returning('*');
  return row as UserFixture;
}

export async function createProduct(db: Knex, overrides: Partial<ProductFixture> = {}): Promise<ProductFixture> {
  const product = makeProduct(overrides);
  const [row] = await db('products').insert(product).returning('*');
  return row as ProductFixture;
}

export async function createVariant(db: Knex, productId: string, overrides: Partial<ProductVariantFixture> = {}): Promise<ProductVariantFixture> {
  const variant = makeVariant(productId, overrides);
  const [row] = await db('product_variants').insert(variant).returning('*');
  return row as ProductVariantFixture;
}

export async function createAsset(db: Knex, userId?: string, overrides: Partial<AssetFixture> = {}): Promise<AssetFixture> {
  const asset = makeAsset(userId, overrides);
  const [row] = await db('assets').insert(asset).returning('*');
  return row as AssetFixture;
}
