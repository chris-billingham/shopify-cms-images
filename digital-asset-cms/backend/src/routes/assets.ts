import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate, requireRole } from '../middleware/auth.js';
import { streamToBuffer } from '../utils/stream.js';
import { verifyAccessToken } from '../services/auth.service.js';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';
import {
  createAsset,
  getAsset,
  updateAsset,
  renameAsset,
  softDeleteAsset,
  downloadAsset,
  checkDuplicate,
  listAssets,
  replaceAsset,
  getAssetVersions,
  refreshSearchView,
  bulkTagAssets,
  AssetValidationError,
  AssetNotFoundError,
  AssetNameConflictError,
  OptimisticLockError,
} from '../services/asset.service.js';
import { submitShopifyRenamePush, runShopifyRenamePush } from '../jobs/shopify-rename-push.js';
import { openThumbnailStream } from '../services/thumbnail.service.js';
import { driveService } from '../services/drive.service.js';
import * as auditService from '../services/audit.service.js';
import { checkIdempotencyKey, storeIdempotencyResult } from '../utils/idempotency.js';
import { submitBulkDownload, processBulkDownload, BulkDownloadError } from '../jobs/bulk-download.js';
import { rateLimitErrorBuilder, crudRateLimitKey, bulkRateLimitKey, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';

// Cache user active-status for 2 minutes to avoid a DB lookup on every thumbnail/preview request.
const userStatusCache = new Map<string, { active: boolean; expiresAt: number }>();
const USER_STATUS_TTL_MS = 2 * 60 * 1000;

async function isUserActive(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = userStatusCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.active;
  const user = await db('users').where('id', userId).first();
  const active = !!user && user.status === 'active';
  userStatusCache.set(userId, { active, expiresAt: now + USER_STATUS_TTL_MS });
  return active;
}

const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit CRUD: 120 req/min per user (keyed by user_id from JWT, or IP)
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: crudRateLimitKey,
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  // ── GET /api/assets — list assets (non-deleted by default) ─────────────────
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const query = request.query as { status?: string; limit?: string; offset?: string };
    const assets = await listAssets({
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return reply.send({ assets, total: assets.length });
  });

  // ── POST /api/assets/bulk-download — create background ZIP job ────────────
  // Bulk operations: 5 req/min per user via per-route config (overrides the 120/min global)
  fastify.post(
    '/bulk-download',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: bulkRateLimitKey,
          errorResponseBuilder: rateLimitErrorBuilder,
        },
      },
      preHandler: [authenticate, requireRole('editor', 'admin')],
    },
    async (request, reply) => {
      const body = request.body as { asset_ids?: unknown };
      const assetIds = body?.asset_ids;

      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'asset_ids must be a non-empty array' },
        });
      }

      try {
        const { jobId, totalSizeBytes, assetCount } = await submitBulkDownload(
          assetIds as string[],
          request.user!.user_id
        );
        // Fire off processing in the background; caller polls GET /api/jobs/:id
        void processBulkDownload(jobId, assetIds as string[]);
        return reply.status(202).send({ job_id: jobId, asset_count: assetCount, total_size_bytes: totalSizeBytes });
      } catch (err) {
        if (err instanceof BulkDownloadError) {
          return reply.status(400).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── POST /api/assets/bulk-tag — apply tags to multiple assets ────────────
  fastify.post(
    '/bulk-tag',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: bulkRateLimitKey,
          errorResponseBuilder: rateLimitErrorBuilder,
        },
      },
      preHandler: [authenticate, requireRole('editor', 'admin')],
    },
    async (request, reply) => {
      const body = request.body as { asset_ids?: unknown; tags?: unknown; mode?: unknown };
      const { asset_ids: assetIds, tags, mode = 'merge' } = body ?? {};

      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'asset_ids must be a non-empty array' } });
      }
      if (!tags || typeof tags !== 'object' || Array.isArray(tags) || Object.keys(tags as object).length === 0) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'tags must be a non-empty object' } });
      }
      if (mode !== 'merge' && mode !== 'replace') {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'mode must be "merge" or "replace"' } });
      }

      const updated = await bulkTagAssets(assetIds as string[], tags as Record<string, string>, mode, request.user!.user_id);
      return reply.send({ updated });
    }
  );

  // ── GET /api/assets/stats — asset counts (admin only) ────────────────────
  fastify.get('/stats', { preHandler: [authenticate, requireRole('admin')] }, async (_request, reply) => {
    const row = await db('assets')
      .whereNot('status', 'deleted')
      .count('id as active_count')
      .first() as { active_count: string } | undefined;
    return reply.send({ active_count: parseInt(row?.active_count ?? '0', 10) });
  });

  // ── POST /api/assets/reset-library — soft-delete all assets (admin only) ─
  fastify.post(
    '/reset-library',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { trash_drive_files?: boolean } | undefined;
      const trashDriveFiles = body?.trash_drive_files === true;

      // Collect Drive IDs before we wipe them
      const activeAssets = await db('assets')
        .whereNot('status', 'deleted')
        .select('id', 'google_drive_id');

      const resetCount = activeAssets.length;

      await db.transaction(async (trx) => {
        await trx('asset_products').delete();
        await trx('assets')
          .whereNot('status', 'deleted')
          .update({ status: 'deleted', updated_at: new Date() });
      });

      await refreshSearchView().catch(() => {});

      // Optionally trash Drive files — tolerate partial failures
      let driveTrashed = 0;
      let driveErrors = 0;
      if (trashDriveFiles && activeAssets.length > 0) {
        const results = await Promise.allSettled(
          activeAssets
            .filter((a) => a.google_drive_id)
            .map((a) => driveService.trashFile(a.google_drive_id as string))
        );
        for (const r of results) {
          if (r.status === 'fulfilled') driveTrashed++;
          else driveErrors++;
        }
      }

      await auditService.log(request.user!.user_id, 'reset_library', 'system', null, {
        reset_count: resetCount,
        trash_drive_files: trashDriveFiles,
        drive_trashed: driveTrashed,
        drive_errors: driveErrors,
      });

      return reply.send({ reset_count: resetCount, drive_trashed: driveTrashed, drive_errors: driveErrors });
    }
  );

  // ── GET /api/assets/check-duplicate — must come before /:id ───────────────
  fastify.get('/check-duplicate', { preHandler: [authenticate] }, async (request, reply) => {
    const q = request.query as { fileName?: string; fileSize?: string; md5?: string };
    if (!q.fileName || !q.fileSize) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'fileName and fileSize query parameters are required' },
      });
    }
    const result = await checkDuplicate(q.fileName, parseInt(q.fileSize, 10), q.md5);
    return reply.send({ duplicate: result !== null, asset: result });
  });

  // ── GET /api/assets/:id/products — linked products for an asset ───────────
  fastify.get('/:id/products', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const links = await db('asset_products as ap')
      .join('products as p', 'ap.product_id', 'p.id')
      .where('ap.asset_id', id)
      .select(
        'ap.id as link_id',
        'p.id as product_id',
        'p.title',
        'p.shopify_id',
        'ap.role',
        'ap.sort_order',
      );
    return reply.send({ links });
  });

  // ── GET /api/assets/:id ────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const asset = await getAsset(id);
      return reply.send(asset);
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message, details: {} } });
      }
      throw err;
    }
  });

  // ── POST /api/assets — multipart upload ────────────────────────────────────
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      // Idempotency check
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const cached = await checkIdempotencyKey(idempotencyKey);
        if (cached) {
          return reply.status(cached.statusCode).send(cached.body);
        }
      }

      // Parse multipart file
      const part = await request.file().catch(() => null);
      if (!part) {
        return reply.status(400).send({ error: { code: 'NO_FILE', message: 'No file provided in multipart body' } });
      }

      const buffer = await streamToBuffer(part.file);

      // Parse optional tags from form fields
      let tags: Record<string, string> | undefined;
      const tagsStr = (part.fields as Record<string, { value?: string }> | undefined)?.['tags']?.value;
      if (tagsStr) {
        try {
          tags = JSON.parse(tagsStr) as Record<string, string>;
        } catch {
          // ignore malformed tags
        }
      }

      try {
        const asset = await createAsset(
          { fileName: part.filename, mimeType: part.mimetype, buffer, tags },
          request.user!.user_id
        );

        if (idempotencyKey) {
          await storeIdempotencyResult(idempotencyKey, 201, asset);
        }

        return reply.status(201).send(asset);
      } catch (err) {
        if (err instanceof AssetValidationError) {
          return reply.status(400).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── PATCH /api/assets/:id — update metadata / tags ─────────────────────────
  fastify.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        tags?: Record<string, string>;
        fileName?: string;
        altText?: string | null;
        updatedAt: string;
      };

      if (!body.updatedAt) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'updatedAt is required for optimistic concurrency control' },
        });
      }

      try {
        const asset = await updateAsset(
          id,
          { tags: body.tags, fileName: body.fileName, altText: body.altText },
          body.updatedAt,
          request.user!.user_id
        );
        return reply.status(200).send(asset);
      } catch (err) {
        if (err instanceof AssetNotFoundError) {
          return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
        }
        if (err instanceof OptimisticLockError) {
          return reply.status(409).send({ error: { code: 'CONFLICT', message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── POST /api/assets/:id/rename ───────────────────────────────────────────
  fastify.post(
    '/:id/rename',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { newFileName?: string; updatedAt?: string };

      if (!body.newFileName?.trim()) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'newFileName is required' } });
      }
      if (!body.updatedAt) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'updatedAt is required' } });
      }

      try {
        const asset = await renameAsset(id, body.newFileName.trim(), body.updatedAt, request.user!.user_id);

        let shopifyPushQueued = false;
        if (asset['shopify_image_id']) {
          const jobId = await submitShopifyRenamePush(id, request.user!.user_id);
          void runShopifyRenamePush(jobId, id);
          shopifyPushQueued = true;
        }

        return reply.status(200).send({ ...asset, shopifyPushQueued });
      } catch (err) {
        if (err instanceof AssetNotFoundError) {
          return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
        }
        if (err instanceof OptimisticLockError) {
          return reply.status(409).send({ error: { code: 'CONFLICT', message: err.message } });
        }
        if (err instanceof AssetNameConflictError) {
          return reply.status(409).send({ error: { code: 'NAME_CONFLICT', message: err.message } });
        }
        if (err instanceof AssetValidationError) {
          return reply.status(400).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── DELETE /api/assets/:id — soft delete (admin only) ─────────────────────
  fastify.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await softDeleteAsset(id, request.user!.user_id);
        return reply.status(200).send({ success: true });
      } catch (err) {
        if (err instanceof AssetNotFoundError) {
          return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── GET /api/assets/:id/thumbnail — serve cached thumbnail from disk ─────
  // Exempt from route-level rate limit: each page load fires ~50 concurrent requests;
  // JWT token auth is sufficient protection.
  fastify.get('/:id/thumbnail', { config: { rateLimit: false } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'token query param required' } });
    }

    let payload: { user_id: string; role: string };
    try {
      payload = verifyAccessToken(token, config.JWT_SECRET);
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }

    if (!await isUserActive(payload.user_id)) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'User account is deactivated' } });
    }

    const stream = openThumbnailStream(id);
    stream.on('error', () => {
      if (!reply.sent) reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Thumbnail not found' } });
    });
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(stream);
  });

  // ── GET /api/assets/:id/download — stream from Drive ─────────────────────
  fastify.get('/:id/download', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { stream, asset } = await downloadAsset(id);
      reply.header('Content-Disposition', `attachment; filename="${asset['file_name'] as string}"`);
      reply.header('Content-Type', asset['mime_type'] as string);
      return reply.send(stream);
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
      }
      throw err;
    }
  });

  // ── GET /api/assets/:id/preview?token= — inline image stream ─────────────
  // Accepts token as query param so <img src> tags can authenticate.
  fastify.get('/:id/preview', { config: { rateLimit: false } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'token query param required' } });
    }

    let payload: { user_id: string; role: string };
    try {
      payload = verifyAccessToken(token, config.JWT_SECRET);
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }

    if (!await isUserActive(payload.user_id)) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'User account is deactivated' } });
    }

    try {
      const { stream, asset } = await downloadAsset(id);
      reply.header('Content-Type', asset['mime_type'] as string);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(stream);
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
      }
      throw err;
    }
  });

  // ── POST /api/assets/:id/replace — transactional version replace ──────────
  fastify.post(
    '/:id/replace',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const part = await request.file().catch(() => null);
      if (!part) {
        return reply.status(400).send({ error: { code: 'NO_FILE', message: 'No file provided in multipart body' } });
      }

      const buffer = await streamToBuffer(part.file);

      try {
        const newAsset = await replaceAsset(
          id,
          { fileName: part.filename, mimeType: part.mimetype, buffer },
          request.user!.user_id
        );
        return reply.status(201).send(newAsset);
      } catch (err) {
        if (err instanceof AssetNotFoundError) {
          return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
        }
        if (err instanceof AssetValidationError) {
          return reply.status(400).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── GET /api/assets/:id/versions — version history ────────────────────────
  fastify.get('/:id/versions', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const versions = await getAssetVersions(id);
      return reply.send({ versions });
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
      }
      throw err;
    }
  });
};

export default assetsRoutes;
