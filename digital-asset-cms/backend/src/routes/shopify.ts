import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate, requireRole } from '../middleware/auth.js';
import { rateLimitErrorBuilder, crudRateLimitKey, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';
import { db } from '../db/connection.js';
import { driveService } from '../services/drive.service.js';
import { createShopifyService, getActiveShopifyCredentials } from '../services/shopify.service.js';
import { upsertProduct } from '../services/product.service.js';
import * as auditService from '../services/audit.service.js';
import {
  submitSyncProducts,
  submitImportImages,
  submitReconciliation,
  runSyncProducts,
  runImportImages,
  runReconciliation,
} from '../jobs/shopify-reconcile.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskSecret(value: string): string {
  return value.length > 4 ? '••••••••' + value.slice(-4) : '••••';
}

const shopifyRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit: 120 req/min per user (§5.2)
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: crudRateLimitKey,
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  // ── GET /api/shopify/settings — admin only ────────────────────────────────
  fastify.get(
    '/settings',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request, reply) => {
      const creds = await getActiveShopifyCredentials();
      const rows = await db('system_settings').whereIn('key', ['shopify_store_domain', 'shopify_admin_api_token', 'shopify_webhook_secret']).select('key', 'value');
      const stored = new Set(rows.filter((r) => r.value).map((r) => r.key as string));

      return reply.send({
        store_domain: creds.storeDomain,
        admin_api_token_hint: maskSecret(creds.apiToken),
        webhook_secret_hint: maskSecret(creds.webhookSecret),
        source: stored.has('shopify_store_domain') ? 'database' : 'environment',
      });
    }
  );

  // ── PUT /api/shopify/settings — admin only ────────────────────────────────
  fastify.put(
    '/settings',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as {
        store_domain?: string;
        admin_api_token?: string;
        webhook_secret?: string;
      };

      const updates: Array<{ key: string; value: string }> = [];
      if (body.store_domain?.trim()) updates.push({ key: 'shopify_store_domain', value: body.store_domain.trim() });
      if (body.admin_api_token?.trim()) updates.push({ key: 'shopify_admin_api_token', value: body.admin_api_token.trim() });
      if (body.webhook_secret?.trim()) updates.push({ key: 'shopify_webhook_secret', value: body.webhook_secret.trim() });

      if (updates.length === 0) {
        return reply.status(400).send({ error: { code: 'NO_UPDATES', message: 'No settings provided' } });
      }

      const now = new Date();
      for (const { key, value } of updates) {
        await db('system_settings')
          .insert({ key, value, updated_at: now })
          .onConflict('key')
          .merge(['value', 'updated_at']);
      }

      await auditService.log(request.user!.user_id, 'update_settings', 'system', 'shopify', {
        updated_keys: updates.map((u) => u.key),
      });

      return reply.send({ ok: true });
    }
  );

  // ── POST /api/shopify/sync-products — background job ─────────────────────
  fastify.post(
    '/sync-products',
    { preHandler: [authenticate, requireRole('editor', 'admin')] },
    async (request, reply) => {
      const jobId = await submitSyncProducts(request.user!.user_id);
      const creds = await getActiveShopifyCredentials();
      void runSyncProducts(jobId, createShopifyService(creds));
      return reply.status(202).send({ job_id: jobId });
    }
  );

  // ── POST /api/shopify/import-images — background job (admin only) ─────────
  fastify.post(
    '/import-images',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { statuses?: string[] };
      const statuses = Array.isArray(body?.statuses) && body.statuses.length > 0
        ? body.statuses
        : ['active'];
      const jobId = await submitImportImages(request.user!.user_id);
      const creds = await getActiveShopifyCredentials();
      void runImportImages(jobId, createShopifyService(creds), undefined, statuses);
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

      // Push to Shopify using current credentials
      const creds = await getActiveShopifyCredentials();
      const shopifyImage = await createShopifyService(creds).pushImage(
        String(link.shopify_id),
        buffer,
        { filename: asset.file_name as string }
      );

      const shopifyImageId = String(shopifyImage.id);

      // Store shopify_image_id on asset and clear any deleted flag
      await db('assets').where('id', assetId).update({ shopify_image_id: shopifyImageId, shopify_image_deleted: false });

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

  // ── POST /api/shopify/push-alt/:assetId — push alt text to Shopify (admin) ─
  fastify.post(
    '/push-alt/:assetId',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };

      const asset = await db('assets').where('id', assetId).whereNot('status', 'deleted').first();
      if (!asset) {
        return reply.status(404).send({ error: { code: 'ASSET_NOT_FOUND', message: `Asset ${assetId} not found` } });
      }

      if (!asset.shopify_image_id) {
        return reply.status(400).send({
          error: { code: 'NO_SHOPIFY_IMAGE', message: 'Asset has no Shopify image ID — push the image to Shopify first' },
        });
      }

      const link = await db('asset_products as ap')
        .join('products as p', 'ap.product_id', 'p.id')
        .where('ap.asset_id', assetId)
        .whereNotNull('p.shopify_id')
        .select('p.shopify_id')
        .first();

      if (!link) {
        return reply.status(400).send({
          error: { code: 'NO_SHOPIFY_PRODUCT', message: 'Asset is not linked to a product with a Shopify ID' },
        });
      }

      const creds = await getActiveShopifyCredentials();
      await createShopifyService(creds).updateImageAlt(
        String(link.shopify_id),
        String(asset.shopify_image_id),
        (asset.alt_text as string | null) ?? null
      );

      await auditService.log(request.user!.user_id, 'push_alt_shopify', 'asset', assetId, {
        shopify_product_id: String(link.shopify_id),
        shopify_image_id: String(asset.shopify_image_id),
        alt_text: asset.alt_text ?? null,
      });

      return reply.send({ success: true });
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

      const creds = await getActiveShopifyCredentials();
      if (!createShopifyService(creds).verifyWebhook(rawBody, hmacHeader)) {
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
      const creds = await getActiveShopifyCredentials();
      void runReconciliation(jobId, createShopifyService(creds));
      return reply.status(202).send({ job_id: jobId });
    }
  );
};

export default shopifyRoutes;
