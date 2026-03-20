import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  createAsset,
  getAsset,
  updateAsset,
  softDeleteAsset,
  downloadAsset,
  checkDuplicate,
  listAssets,
  AssetValidationError,
  AssetNotFoundError,
  OptimisticLockError,
} from '../services/asset.service.js';
import { checkIdempotencyKey, storeIdempotencyResult } from '../utils/idempotency.js';

const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit CRUD: 120 req/min per user (keyed by Authorization header user_id or IP)
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
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

  // ── GET /api/assets/:id ────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const asset = await getAsset(id);
      return reply.send(asset);
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: err.message } });
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

      // Collect file bytes
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

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
          { tags: body.tags, fileName: body.fileName },
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
};

export default assetsRoutes;
