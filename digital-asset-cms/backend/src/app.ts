import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth.js';
import assetsRoutes from './routes/assets.js';
import productsRoutes from './routes/products.js';
import tagsRoutes from './routes/tags.js';
import searchRoutes from './routes/search.js';
import jobsRoutes from './routes/jobs.js';
import shopifyRoutes from './routes/shopify.js';
import { verifyAccessToken } from './services/auth.service.js';
import { handleConnection } from './websocket/handler.js';
import { config } from './config/index.js';

export function buildApp() {
  const app = Fastify({
    logger: process.env['NODE_ENV'] !== 'test',
    trustProxy: true, // enables X-Forwarded-For for rate limiting
  });

  app.register(fastifyCookie);

  app.register(fastifyCors, {
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
  });

  // Multipart support for file uploads (1 GB max — per-MIME limits enforced in service)
  app.register(fastifyMultipart, {
    limits: { fileSize: 1024 * 1024 * 1024 },
  });

  app.register(fastifyWebsocket);

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(assetsRoutes, { prefix: '/api/assets' });
  app.register(productsRoutes, { prefix: '/api/products' });
  app.register(tagsRoutes, { prefix: '/api/tags' });
  app.register(searchRoutes, { prefix: '/api/search' });
  app.register(jobsRoutes, { prefix: '/api/jobs' });
  app.register(shopifyRoutes, { prefix: '/api/shopify' });

  app.get('/api/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  // ── WebSocket endpoint (/api/ws?token=<jwt>) ──────────────────────────────
  // Must be inside a register() context so @fastify/websocket's onRoute hook fires
  app.register(async (instance) => {
    instance.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = (request.query as { token?: string }).token;
      if (!token) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token query parameter' } });
      }
      try {
        const payload = verifyAccessToken(token, config.JWT_SECRET);
        request.user = { user_id: payload.user_id, role: payload.role };
      } catch {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
      }
    });

    instance.get('/api/ws', { websocket: true }, (socket, request) => {
      const token = (request.query as { token: string }).token;
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const tokenExpiresAt = (decoded?.exp ?? 0) * 1000;
      handleConnection(socket, request.user!.user_id, request.user!.role, tokenExpiresAt);
    });
  });

  return app;
}
