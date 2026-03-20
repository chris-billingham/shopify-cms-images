import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get('/api/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  return app;
}
