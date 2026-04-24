import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate, requireRole } from '../middleware/auth.js';
import { rateLimitErrorBuilder, crudRateLimitKey, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';
import { db } from '../db/connection.js';
import {
  getProduct,
  listProducts,
  getVariants,
  ProductNotFoundError,
} from '../services/product.service.js';
import {
  linkAssetToProduct,
  unlinkAsset,
  updateLink,
  DuplicateLinkError,
  LinkNotFoundError,
} from '../services/link.service.js';
import { shopifyService } from '../services/shopify.service.js';

const productsRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit: 120 req/min per user (§5.2)
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: crudRateLimitKey,
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  // ── GET /api/products ──────────────────────────────────────────────────────
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const q = request.query as { q?: string; limit?: string; offset?: string };
    const products = await listProducts({
      q: q.q,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    });
    return reply.send({ products, total: products.length });
  });

  // ── GET /api/products/:id ─────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const product = await getProduct(id);
      return reply.send(product);
    } catch (err) {
      if (err instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: { code: 'PRODUCT_NOT_FOUND', message: err.message } });
      }
      throw err;
    }
  });

  // ── GET /api/products/:id/variants ────────────────────────────────────────
  fastify.get('/:id/variants', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const variants = await getVariants(id);
    return reply.send({ variants });
  });

  // ── GET /api/products/:id/assets — linked assets for a product ─────────────
  fastify.get('/:id/assets', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const assets = await db('asset_products as ap')
      .join('assets as a', 'ap.asset_id', 'a.id')
      .where('ap.product_id', id)
      .whereNot('a.status', 'deleted')
      .orderBy('ap.sort_order', 'asc')
      .select(
        'ap.id as link_id',
        'ap.sort_order',
        'ap.role',
        'a.id as asset_id',
        'a.file_name',
        'a.asset_type',
        'a.thumbnail_url',
        'a.mime_type',
        'a.file_size_bytes as file_size',
        'a.shopify_image_id',
      );
    return reply.send({ assets });
  });

  // ── POST /api/products/:id/assets — link an asset ─────────────────────────
  fastify.post(
    '/:id/assets',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { id: productId } = request.params as { id: string };
      const body = request.body as {
        assetId: string;
        variantId?: string | null;
        role?: string;
        sortOrder?: number;
      };

      if (!body.assetId) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'assetId is required' } });
      }

      try {
        const link = await linkAssetToProduct(
          body.assetId,
          productId,
          body.variantId ?? null,
          body.role ?? 'gallery',
          body.sortOrder ?? 0
        );
        return reply.status(201).send(link);
      } catch (err) {
        if (err instanceof DuplicateLinkError) {
          return reply.status(409).send({ error: { code: 'DUPLICATE_LINK', message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── POST /api/products/:id/assets/reorder ─────────────────────────────────
  fastify.post(
    '/:id/assets/reorder',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { id: productId } = request.params as { id: string };
      const body = request.body as { order: string[] };

      if (!Array.isArray(body.order) || body.order.length === 0) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'order must be a non-empty array of link IDs' } });
      }

      // Update sort_order in DB (1-based positions)
      await Promise.all(
        body.order.map((linkId, index) =>
          db('asset_products').where('id', linkId).update({ sort_order: index + 1 })
        )
      );

      // Sync positions to Shopify if this product has a shopify_id
      const product = await db('products').where('id', productId).first();
      if (product?.shopify_id) {
        const links = await db('asset_products as ap')
          .join('assets as a', 'ap.asset_id', 'a.id')
          .whereIn('ap.id', body.order)
          .select('ap.id as link_id', 'a.shopify_image_id');

        const imageIdByLink = new Map(
          links.map((l) => [l.link_id as string, l.shopify_image_id as string | null])
        );

        for (let i = 0; i < body.order.length; i++) {
          const shopifyImageId = imageIdByLink.get(body.order[i]);
          if (shopifyImageId) {
            await shopifyService.updateImagePosition(product.shopify_id, shopifyImageId, i + 1);
          }
        }
      }

      return reply.status(200).send({ success: true });
    }
  );

  // ── DELETE /api/products/:id/assets/:linkId ────────────────────────────────
  fastify.delete(
    '/:id/assets/:linkId',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { linkId } = request.params as { id: string; linkId: string };
      try {
        await unlinkAsset(linkId);
        return reply.status(200).send({ success: true });
      } catch (err) {
        if (err instanceof LinkNotFoundError) {
          return reply.status(404).send({ error: { code: 'LINK_NOT_FOUND', message: err.message } });
        }
        throw err;
      }
    }
  );

  // ── PATCH /api/products/:id/assets/:linkId ────────────────────────────────
  fastify.patch(
    '/:id/assets/:linkId',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const { linkId } = request.params as { id: string; linkId: string };
      const body = request.body as { role?: string; sortOrder?: number };

      try {
        const updated = await updateLink(linkId, { role: body.role, sortOrder: body.sortOrder });
        return reply.status(200).send(updated);
      } catch (err) {
        if (err instanceof LinkNotFoundError) {
          return reply.status(404).send({ error: { code: 'LINK_NOT_FOUND', message: err.message } });
        }
        throw err;
      }
    }
  );
};

export default productsRoutes;
