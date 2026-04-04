import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { rateLimitErrorBuilder, crudRateLimitKey, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';

const tagsRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit: 120 req/min per user (§5.2)
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: crudRateLimitKey,
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  // ── GET /api/tags/keys — distinct tag keys ─────────────────────────────────
  fastify.get('/keys', { preHandler: [authenticate] }, async (_request, reply) => {
    const rows = await db.raw<{ rows: Array<{ key: string }> }>(`
      SELECT DISTINCT jsonb_object_keys(tags) AS key
      FROM assets
      WHERE status != 'deleted' AND tags != '{}'::jsonb
      ORDER BY key
    `);
    const keys = rows.rows.map((r) => r.key);
    return reply.send({ keys });
  });

  // ── GET /api/tags/values?key=x — distinct values for a key ────────────────
  fastify.get('/values', { preHandler: [authenticate] }, async (request, reply) => {
    const { key } = request.query as { key?: string };
    if (!key) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'key query parameter is required' } });
    }

    const rows = await db.raw<{ rows: Array<{ value: string }> }>(
      `SELECT DISTINCT kv.value
       FROM assets, jsonb_each_text(tags) AS kv(key, value)
       WHERE status != 'deleted' AND kv.key = ?
       ORDER BY kv.value`,
      [key]
    );
    const values = rows.rows.map((r) => r.value);
    return reply.send({ values });
  });

  // ── GET /api/tags/facets — counts per key/value ────────────────────────────
  fastify.get('/facets', { preHandler: [authenticate] }, async (_request, reply) => {
    const rows = await db.raw<{ rows: Array<{ key: string; value: string; count: string }> }>(`
      SELECT kv.key, kv.value, COUNT(DISTINCT a.id)::int AS count
      FROM assets a, jsonb_each_text(a.tags) AS kv(key, value)
      WHERE a.status != 'deleted'
      GROUP BY kv.key, kv.value
      ORDER BY kv.key, kv.value
    `);

    // Nest into { key: { value: count } }
    const facets: Record<string, Record<string, number>> = {};
    for (const row of rows.rows) {
      if (!facets[row.key]) facets[row.key] = {};
      facets[row.key][row.value] = row.count as unknown as number;
    }
    return reply.send({ facets });
  });
};

export default tagsRoutes;
