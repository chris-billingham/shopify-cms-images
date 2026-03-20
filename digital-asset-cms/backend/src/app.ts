import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import authRoutes from './routes/auth.js';
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

  app.register(authRoutes, { prefix: '/api/auth' });

  app.get('/api/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  return app;
}
