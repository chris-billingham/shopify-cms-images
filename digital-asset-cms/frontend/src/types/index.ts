export type AssetType = 'image' | 'video' | 'text' | 'document';
export type AssetStatus = 'active' | 'archived';
export type UserRole = 'admin' | 'editor' | 'viewer';

export interface Tag {
  key: string;
  value: string;
}

export interface Asset {
  id: string;
  file_name: string;
  asset_type: AssetType;
  status: AssetStatus;
  drive_file_id: string;
  thumbnail_url?: string;
  file_size: number;
  mime_type: string;
  tags: Record<string, string>;
  alt_text?: string | null;
  shopify_image_id?: string | null;
  shopify_image_deleted?: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  uploaded_by?: string;
}

export interface ProductVariant {
  id: string;
  sku: string;
  title: string;
  price?: string | null;
  shopify_variant_id?: string | null;
  inventory_quantity?: number | null;
}

export interface Product {
  id: string;
  title: string;
  shopify_id?: string;
  vendor?: string;
  category?: string;
  status?: string;
  shopify_tags?: string[];
  variant_count: number;
  total_inventory: number;
  synced_at?: string;
  shopify_created_at?: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facets {
  asset_type?: FacetValue[];
  product_status?: FacetValue[];
  tags?: Record<string, FacetValue[]>;
}

export interface SearchResult {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  facets: Facets;
}

export interface ActiveFilters {
  type?: string;
  product_status?: string;
  tags?: Record<string, string>;
}

export interface AuditEntry {
  id: string;
  action: string;
  user_email: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AssetVersion {
  version: number;
  file_name: string;
  created_at: string;
  uploaded_by: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingAsset?: Asset;
}

// MIME types allowed per the architecture
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/pdf',
];

export const MAX_FILE_SIZES: Record<string, number> = {
  image: 50 * 1024 * 1024,   // 50 MB
  video: 500 * 1024 * 1024,  // 500 MB
  text: 10 * 1024 * 1024,    // 10 MB
  document: 100 * 1024 * 1024, // 100 MB
};

export function getAssetType(mimeType: string): AssetType | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('text/')) return 'text';
  if (mimeType === 'application/pdf') return 'document';
  return null;
}

export interface LinkedAsset {
  id: string;
  asset_id: string;
  file_name: string;
  thumbnail_url?: string;
  asset_type: AssetType;
  sort_order: number;
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  name: string;
  status: JobStatus;
  progress: number; // 0–100
  created_at: string;
  completed_at?: string;
  error?: string;
}

export interface JobProgressPayload {
  jobId: string;
  jobName: string;
  progress: number;
  status: JobStatus;
}

export type WebSocketMessageType = 'job_progress' | 'asset_updated' | 'admin_alert' | 'asset_change' | 'ping' | 'pong';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  payload?: unknown;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  status: 'active' | 'deactivated';
  created_at: string;
}
