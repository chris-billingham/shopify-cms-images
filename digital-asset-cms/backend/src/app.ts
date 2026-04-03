import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import authRoutes from './routes/auth.js';
import assetsRoutes from './routes/assets.js';
import productsRoutes from './routes/products.js';
import tagsRoutes from './routes/tags.js';
import searchRoutes from './routes/search.js';
import jobsRoutes from './routes/jobs.js';
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

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(assetsRoutes, { prefix: '/api/assets' });
  app.register(productsRoutes, { prefix: '/api/products' });
  app.register(tagsRoutes, { prefix: '/api/tags' });
  app.register(searchRoutes, { prefix: '/api/search' });
  app.register(jobsRoutes, { prefix: '/api/jobs' });

  app.get('/api/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  return app;
}
