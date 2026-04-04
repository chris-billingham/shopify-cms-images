import type { FastifyPluginAsync } from 'fastify';
import * as healthSvc from '../services/health.service.js';
import { config } from '../config/index.js';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_request, reply) => {
    const [postgres, redis, google_drive, shopify] = await Promise.all([
      healthSvc.checkPostgresHealth(),
      healthSvc.checkRedisHealth(config.REDIS_URL),
      healthSvc.checkDriveHealth(),
      healthSvc.checkShopifyHealth(),
    ]);

    const statuses = [postgres, redis, google_drive, shopify];
    const overall = statuses.some((s) => s.status === 'unhealthy')
      ? 'unhealthy'
      : statuses.some((s) => s.status === 'degraded')
      ? 'degraded'
      : 'healthy';

    return reply.status(200).send({
      status: overall,
      dependencies: { postgres, redis, google_drive, shopify },
    });
  });
};

export default healthRoutes;
