import { db } from '../db/connection.js';
import { refreshSearchView } from './asset.service.js';

// ── Error types ───────────────────────────────────────────────────────────────

export class DuplicateLinkError extends Error {
  constructor() {
    super('A link with these properties already exists for this asset/product/role combination');
    this.name = 'DuplicateLinkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LinkNotFoundError extends Error {
  constructor(id: string) {
    super(`Link ${id} not found`);
    this.name = 'LinkNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === '23505'
  );
}

// ── Link operations ───────────────────────────────────────────────────────────

export async function linkAssetToProduct(
  assetId: string,
  productId: string,
  variantId: string | null,
  role: string,
  sortOrder: number
): Promise<Record<string, unknown>> {
  try {
    const [row] = await db('asset_products')
      .insert({ asset_id: assetId, product_id: productId, variant_id: variantId, role, sort_order: sortOrder })
      .returning('*');
    await refreshSearchView().catch(() => {});
    return row as Record<string, unknown>;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateLinkError();
    throw err;
  }
}

export async function unlinkAsset(linkId: string): Promise<void> {
  const deleted = await db('asset_products').where('id', linkId).delete();
  if (deleted === 0) throw new LinkNotFoundError(linkId);
  await refreshSearchView().catch(() => {});
}

export async function updateLink(
  linkId: string,
  changes: { role?: string; sortOrder?: number }
): Promise<Record<string, unknown>> {
  const link = await db('asset_products').where('id', linkId).first();
  if (!link) throw new LinkNotFoundError(linkId);

  const updateData: Record<string, unknown> = {};
  if (changes.role !== undefined) updateData['role'] = changes.role;
  if (changes.sortOrder !== undefined) updateData['sort_order'] = changes.sortOrder;

  const [updated] = await db('asset_products').where('id', linkId).update(updateData).returning('*');
  return updated as Record<string, unknown>;
}

export async function getLinksForProduct(productId: string): Promise<Record<string, unknown>[]> {
  return (await db('asset_products')
    .where('product_id', productId)
    .orderBy('sort_order', 'asc')) as Record<string, unknown>[];
}

export async function getLinksForAsset(assetId: string): Promise<Record<string, unknown>[]> {
  return (await db('asset_products')
    .where('asset_id', assetId)
    .orderBy('sort_order', 'asc')) as Record<string, unknown>[];
}
