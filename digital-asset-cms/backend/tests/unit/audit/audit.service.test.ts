import { describe, it, expect } from 'vitest';
import { validateDetails, type AuditAction } from '../../../src/services/audit.service.js';

// ── 3.T11 — Audit log detail schema validation ─────────────────────────────

describe('3.T11 — Audit log detail schemas', () => {
  // ── upload ───────────────────────────────────────────────────────────────
  describe('upload', () => {
    it('passes for a valid upload details object', () => {
      const details = {
        file_name: 'hero.jpg',
        mime_type: 'image/jpeg',
        file_size_bytes: 102400,
        google_drive_id: 'drive-abc123',
      };
      const { valid, missing } = validateDetails('upload', details);
      expect(valid).toBe(true);
      expect(missing).toHaveLength(0);
    });

    it('fails when required fields are missing', () => {
      const { valid, missing } = validateDetails('upload', { file_name: 'hero.jpg' });
      expect(valid).toBe(false);
      expect(missing).toContain('mime_type');
      expect(missing).toContain('file_size_bytes');
      expect(missing).toContain('google_drive_id');
    });
  });

  // ── tag_change ────────────────────────────────────────────────────────────
  describe('tag_change', () => {
    it('passes for a valid tag_change details object', () => {
      const details = {
        changes: [
          { key: 'colour', old_value: null, new_value: 'Navy' },
          { key: 'season', old_value: 'SS26', new_value: null },
        ],
      };
      const { valid } = validateDetails('tag_change', details);
      expect(valid).toBe(true);
    });

    it('fails when changes field is missing', () => {
      const { valid, missing } = validateDetails('tag_change', {});
      expect(valid).toBe(false);
      expect(missing).toContain('changes');
    });
  });

  // ── download ──────────────────────────────────────────────────────────────
  describe('download', () => {
    it('passes for single download', () => {
      const { valid } = validateDetails('download', { file_name: 'hero.jpg', source: 'single' });
      expect(valid).toBe(true);
    });

    it('passes for bulk download source', () => {
      const { valid } = validateDetails('download', { file_name: 'hero.jpg', source: 'bulk' });
      expect(valid).toBe(true);
    });

    it('fails when source is missing', () => {
      const { valid, missing } = validateDetails('download', { file_name: 'hero.jpg' });
      expect(valid).toBe(false);
      expect(missing).toContain('source');
    });
  });

  // ── bulk_download ─────────────────────────────────────────────────────────
  describe('bulk_download', () => {
    it('passes for a valid bulk_download details object', () => {
      const { valid } = validateDetails('bulk_download', {
        asset_count: 10,
        total_size_bytes: 5000000,
        job_id: 'job-uuid-123',
      });
      expect(valid).toBe(true);
    });

    it('fails when job_id is missing', () => {
      const { valid, missing } = validateDetails('bulk_download', { asset_count: 10, total_size_bytes: 1 });
      expect(valid).toBe(false);
      expect(missing).toContain('job_id');
    });
  });

  // ── link_product ──────────────────────────────────────────────────────────
  describe('link_product', () => {
    it('passes for a valid link_product details object', () => {
      const { valid } = validateDetails('link_product', {
        product_id: 'prod-uuid',
        variant_id: null,
        role: 'hero',
        sort_order: 0,
      });
      expect(valid).toBe(true);
    });

    it('fails when sort_order is missing', () => {
      const { valid, missing } = validateDetails('link_product', {
        product_id: 'prod-uuid',
        variant_id: null,
        role: 'hero',
      });
      expect(valid).toBe(false);
      expect(missing).toContain('sort_order');
    });
  });

  // ── unlink_product ────────────────────────────────────────────────────────
  describe('unlink_product', () => {
    it('passes for a valid unlink_product details object', () => {
      const { valid } = validateDetails('unlink_product', {
        product_id: 'prod-uuid',
        variant_id: null,
        role: 'gallery',
      });
      expect(valid).toBe(true);
    });
  });

  // ── push_shopify ──────────────────────────────────────────────────────────
  describe('push_shopify', () => {
    it('passes for a successful push', () => {
      const { valid } = validateDetails('push_shopify', {
        product_id: 'prod-uuid',
        shopify_product_id: '12345',
        shopify_image_id: '67890',
        status: 'success',
      });
      expect(valid).toBe(true);
    });

    it('fails when status is missing', () => {
      const { valid, missing } = validateDetails('push_shopify', {
        product_id: 'prod-uuid',
        shopify_product_id: '12345',
        shopify_image_id: '67890',
      });
      expect(valid).toBe(false);
      expect(missing).toContain('status');
    });
  });

  // ── sync ──────────────────────────────────────────────────────────────────
  describe('sync', () => {
    it('passes for a valid sync details object', () => {
      const { valid } = validateDetails('sync', {
        direction: 'import',
        products_affected: 42,
        duration_ms: 3500,
      });
      expect(valid).toBe(true);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('passes for a valid delete details object', () => {
      const { valid } = validateDetails('delete', {
        file_name: 'old-image.jpg',
        previous_status: 'active',
        google_drive_id: 'drive-abc',
      });
      expect(valid).toBe(true);
    });

    it('fails when previous_status is missing', () => {
      const { valid, missing } = validateDetails('delete', {
        file_name: 'old-image.jpg',
        google_drive_id: 'drive-abc',
      });
      expect(valid).toBe(false);
      expect(missing).toContain('previous_status');
    });
  });

  // ── version ───────────────────────────────────────────────────────────────
  describe('version', () => {
    it('passes for a valid version details object', () => {
      const { valid } = validateDetails('version', {
        previous_version: 1,
        new_version: 2,
        previous_drive_id: 'drive-old',
        new_drive_id: 'drive-new',
      });
      expect(valid).toBe(true);
    });
  });

  // ── role_change ───────────────────────────────────────────────────────────
  describe('role_change', () => {
    it('passes for a valid role_change details object', () => {
      const { valid } = validateDetails('role_change', {
        target_user_id: 'user-uuid',
        old_role: 'viewer',
        new_role: 'editor',
      });
      expect(valid).toBe(true);
    });
  });

  // ── user_deactivate ───────────────────────────────────────────────────────
  describe('user_deactivate', () => {
    it('passes for a valid user_deactivate details object', () => {
      const { valid } = validateDetails('user_deactivate', {
        target_user_id: 'user-uuid',
        email: 'user@example.com',
        previous_role: 'editor',
      });
      expect(valid).toBe(true);
    });
  });

  // ── drive_rename ──────────────────────────────────────────────────────────
  describe('drive_rename', () => {
    it('passes for a valid drive_rename details object', () => {
      const { valid } = validateDetails('drive_rename', {
        google_drive_id: 'drive-id',
        old_file_name: 'old.jpg',
        new_file_name: 'new.jpg',
      });
      expect(valid).toBe(true);
    });
  });

  // ── drive_moved_out ───────────────────────────────────────────────────────
  describe('drive_moved_out', () => {
    it('passes for a valid drive_moved_out details object', () => {
      const { valid } = validateDetails('drive_moved_out', {
        google_drive_id: 'drive-id',
        file_name: 'image.jpg',
        previous_status: 'active',
      });
      expect(valid).toBe(true);
    });
  });

  // ── Cross-cutting: schema mismatch ────────────────────────────────────────
  it('reports all missing fields in a completely empty details object', () => {
    const actions: AuditAction[] = [
      'upload', 'tag_change', 'download', 'bulk_download', 'link_product',
      'unlink_product', 'push_shopify', 'sync', 'delete', 'version',
      'role_change', 'user_deactivate', 'drive_rename', 'drive_moved_out',
    ];
    for (const action of actions) {
      const { valid, missing } = validateDetails(action, {});
      expect(valid).toBe(false);
      expect(missing.length).toBeGreaterThan(0);
    }
  });
});
