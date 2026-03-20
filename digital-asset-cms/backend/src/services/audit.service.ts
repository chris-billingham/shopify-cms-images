import { db } from '../db/connection.js';

export type AuditAction =
  | 'upload'
  | 'tag_change'
  | 'download'
  | 'bulk_download'
  | 'link_product'
  | 'unlink_product'
  | 'push_shopify'
  | 'sync'
  | 'delete'
  | 'version'
  | 'role_change'
  | 'user_deactivate'
  | 'drive_rename'
  | 'drive_moved_out';

// ── Detail schemas per §4.3 ───────────────────────────────────────────────────

export interface UploadDetails {
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  google_drive_id: string;
}

export interface TagChangeEntry {
  key: string;
  old_value: string | null;
  new_value: string | null;
}

export interface TagChangeDetails {
  changes: TagChangeEntry[];
}

export interface DownloadDetails {
  file_name: string;
  source: 'single' | 'bulk';
}

export interface BulkDownloadDetails {
  asset_count: number;
  total_size_bytes: number;
  job_id: string;
}

export interface LinkProductDetails {
  product_id: string;
  variant_id: string | null;
  role: string;
  sort_order: number;
}

export interface UnlinkProductDetails {
  product_id: string;
  variant_id: string | null;
  role: string;
}

export interface PushShopifyDetails {
  product_id: string;
  shopify_product_id: string;
  shopify_image_id: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface SyncDetails {
  direction: 'import' | 'push';
  products_affected: number;
  duration_ms: number;
}

export interface DeleteDetails {
  file_name: string;
  previous_status: string;
  google_drive_id: string;
}

export interface VersionDetails {
  previous_version: number;
  new_version: number;
  previous_drive_id: string;
  new_drive_id: string;
}

export interface RoleChangeDetails {
  target_user_id: string;
  old_role: string;
  new_role: string;
}

export interface UserDeactivateDetails {
  target_user_id: string;
  email: string;
  previous_role: string;
}

export interface DriveRenameDetails {
  google_drive_id: string;
  old_file_name: string;
  new_file_name: string;
}

export interface DriveMovedOutDetails {
  google_drive_id: string;
  file_name: string;
  previous_status: string;
}

export type AuditDetails =
  | UploadDetails
  | TagChangeDetails
  | DownloadDetails
  | BulkDownloadDetails
  | LinkProductDetails
  | UnlinkProductDetails
  | PushShopifyDetails
  | SyncDetails
  | DeleteDetails
  | VersionDetails
  | RoleChangeDetails
  | UserDeactivateDetails
  | DriveRenameDetails
  | DriveMovedOutDetails;

// ── Validation helpers ────────────────────────────────────────────────────────

export function validateDetails(action: AuditAction, details: Record<string, unknown>): { valid: boolean; missing: string[] } {
  const required: Record<AuditAction, string[]> = {
    upload: ['file_name', 'mime_type', 'file_size_bytes', 'google_drive_id'],
    tag_change: ['changes'],
    download: ['file_name', 'source'],
    bulk_download: ['asset_count', 'total_size_bytes', 'job_id'],
    link_product: ['product_id', 'variant_id', 'role', 'sort_order'],
    unlink_product: ['product_id', 'variant_id', 'role'],
    push_shopify: ['product_id', 'shopify_product_id', 'shopify_image_id', 'status'],
    sync: ['direction', 'products_affected', 'duration_ms'],
    delete: ['file_name', 'previous_status', 'google_drive_id'],
    version: ['previous_version', 'new_version', 'previous_drive_id', 'new_drive_id'],
    role_change: ['target_user_id', 'old_role', 'new_role'],
    user_deactivate: ['target_user_id', 'email', 'previous_role'],
    drive_rename: ['google_drive_id', 'old_file_name', 'new_file_name'],
    drive_moved_out: ['google_drive_id', 'file_name', 'previous_status'],
  };

  const keys = required[action] ?? [];
  const missing = keys.filter((k) => !(k in details));
  return { valid: missing.length === 0, missing };
}

// ── Core log function ─────────────────────────────────────────────────────────

export async function log(
  userId: string | null,
  action: AuditAction | string,
  entityType: string | null,
  entityId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  await db('audit_log').insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: JSON.stringify(details),
  });
}
