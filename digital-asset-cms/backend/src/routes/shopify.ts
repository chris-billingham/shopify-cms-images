import type { FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { driveService } from '../services/drive.service.js';
import { shopifyService } from '../services/shopify.service.js';
import { upsertProduct } from '../services/product.service.js';
import * as auditService from '../services/audit.service.js';
import { getJob } from '../services/job.service.js';
import {
  submitSyncProducts,
  submitImportImages,
  submitReconciliation,
  runSyncProducts,
  runImportImages,
  runReconciliation,
} from '../jobs/shopify-reconcile.js';

const shopifyRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /api/shopify/sync-products — background job ─────────────────────
  fastify.post(
    '/sync-products',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const jobId = await submitSyncProducts(request.user!.user_id);
      void runSyncProducts(jobId);
      return reply.status(202).send({ job_id: jobId });
    }
  );

  // ── POST /api/shopify/import-images — background job (admin only) ─────────
  fastify.post(
    '/import-images',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const jobId = await submitImportImages(request.user!.user_id);
      void runImportImages(jobId);
      return reply.status(202).send({ job_id: jobId });
    }
  );

  // ── POST /api/shopify/push/:assetId — stream asset to Shopify (admin) ────
  fastify.post(
    '/push/:assetId',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };

      const asset = await db('assets').where('id', assetId).whereNot('status', 'deleted').first();
      if (!asset) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: `Asset ${assetId} not found` } });
      }

      // Find a linked product that has a shopify_id
      const link = await db('asset_products as ap')
        .join('products as p', 'ap.product_id', 'p.id')
        .where('ap.asset_id', assetId)
        .whereNotNull('p.shopify_id')
        .select('ap.product_id', 'p.shopify_id', 'ap.id as link_id')
        .first();

      if (!link) {
        return reply.status(400).send({
          error: { code: 'NO_SHOPIFY_PRODUCT', message: 'Asset is not linked to a product with a Shopify ID' },
        });
      }

      // Download from Drive
      const stream = await driveService.downloadFile(asset.google_drive_id as string);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      // Push to Shopify
      const shopifyImage = await shopifyService.pushImage(
        String(link.shopify_id),
        buffer,
        { filename: asset.file_name as string }
      );

      const shopifyImageId = String(shopifyImage.id);

      // Store shopify_image_id on asset
      await db('assets').where('id', assetId).update({ shopify_image_id: shopifyImageId });

      // Audit log
      await auditService.log(request.user!.user_id, 'push_shopify', 'asset', assetId, {
        product_id: link.product_id as string,
        shopify_product_id: String(link.shopify_id),
        shopify_image_id: shopifyImageId,
        status: 'success',
      });

      return reply.send({ success: true, shopify_image_id: shopifyImageId });
    }
  );

  // ── POST /api/shopify/webhooks — HMAC-verified, no auth middleware ─────────
  // Must be in a scoped plugin to override the JSON content type parser
  await fastify.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body as Buffer);
      }
    );

    webhookScope.post('/webhooks', async (request, reply) => {
      const rawBody = request.body as Buffer;
      const hmacHeader = (request.headers['x-shopify-hmac-sha256'] as string | undefined) ?? '';
      const topic = (request.headers['x-shopify-topic'] as string | undefined) ?? '';

      if (!shopifyService.verifyWebhook(rawBody, hmacHeader)) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid HMAC signature' } });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString()) as Record<string, unknown>;
      } catch {
        return reply.status(400).send({ error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON body' } });
      }

      if (topic === 'products/create' || topic === 'products/update') {
        const shopifyId = payload['id'] as number;
        const tags = typeof payload['tags'] === 'string' ? payload['tags'] : '';
        await upsertProduct(shopifyId, {
          title: (payload['title'] as string) ?? 'Untitled',
          vendor: (payload['vendor'] as string | null) ?? null,
          category: (payload['product_type'] as string | null) ?? null,
          status: 'active',
          shopifyTags: tags ? tags.split(', ').filter(Boolean) : [],
        });
      } else if (topic === 'products/delete') {
        const shopifyId = payload['id'] as number;
        await db('products').where('shopify_id', shopifyId).update({ status: 'deleted' });
      }

      return reply.status(200).send({ ok: true });
    });
  });

  // ── GET /api/shopify/status ───────────────────────────────────────────────
  fastify.get('/status', { preHandler: [authenticate] }, async (_request, reply) => {
    const lastSync = await db('products')
      .whereNotNull('synced_at')
      .orderBy('synced_at', 'desc')
      .select('synced_at')
      .first();

    const recentJobs = await db('background_jobs')
      .whereIn('type', ['shopify_sync_products', 'shopify_import_images', 'shopify_reconcile'])
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('id', 'type', 'status', 'created_at', 'updated_at');

    return reply.send({
      last_sync_at: lastSync?.synced_at ?? null,
      recent_jobs: recentJobs,
    });
  });

  // ── POST /api/shopify/reconcile — background job (admin only) ─────────────
  fastify.post(
    '/reconcile',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const jobId = await submitReconciliation(request.user!.user_id);
      void runReconciliation(jobId);
      return reply.status(202).send({ job_id: jobId });
    }
  );
};

export default shopifyRoutes;
