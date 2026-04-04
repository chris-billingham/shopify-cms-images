import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate } from '../middleware/auth.js';
import { verifyAccessToken } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { searchAssets } from '../services/search.service.js';
import { rateLimitErrorBuilder, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit: 30 req/min per authenticated user (keyed by user_id extracted from JWT)
  await fastify.register(fastifyRateLimit, {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const header = request.headers['authorization'];
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        try {
          const payload = verifyAccessToken(header.slice(7), config.JWT_SECRET);
          return `search:user:${payload.user_id}`;
        } catch {
          // fall through to IP-based key
        }
      }
      return `search:ip:${request.ip}`;
    },
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const rawQuery = request.query as Record<string, string | string[]>;

    // Parse tags[key]=value bracket notation from query string
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawQuery)) {
      const match = key.match(/^tags\[(.+)\]$/);
      if (match && typeof value === 'string') {
        tags[match[1]] = value;
      }
    }

    const getString = (k: string): string | undefined =>
      typeof rawQuery[k] === 'string' ? (rawQuery[k] as string) : undefined;

    const result = await searchAssets({
      q: getString('q'),
      sku: getString('sku'),
      category: getString('category'),
      type: getString('type'),
      status: getString('status'),
      sort: getString('sort'),
      order: getString('order'),
      page: rawQuery['page'] ? parseInt(rawQuery['page'] as string, 10) : undefined,
      limit: rawQuery['limit'] ? parseInt(rawQuery['limit'] as string, 10) : undefined,
      facets: rawQuery['facets'] === 'true',
      tags,
    });

    return reply.send(result);
  });
};

export default searchRoutes;
