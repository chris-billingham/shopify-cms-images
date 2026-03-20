import type { FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
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

const productsRoutes: FastifyPluginAsync = async (fastify) => {
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
