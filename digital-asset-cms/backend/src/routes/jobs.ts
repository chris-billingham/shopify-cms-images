import path from 'path';
import os from 'os';
import fs from 'fs';
import type { FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { authenticate } from '../middleware/auth.js';
import { getJob } from '../services/job.service.js';
import { rateLimitErrorBuilder, crudRateLimitKey, RATE_LIMIT_HEADERS } from '../utils/rate-limit.js';

const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  // Rate limit: 120 req/min per user (§5.2)
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: crudRateLimitKey,
    errorResponseBuilder: rateLimitErrorBuilder,
    addHeaders: RATE_LIMIT_HEADERS,
  });

  // GET /api/jobs/:id — job status, progress, and result
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) {
      return reply.status(404).send({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } });
    }
    return reply.send(job);
  });

  // GET /api/jobs/:id/download — stream the ZIP result file
  fastify.get('/:id/download', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) {
      return reply.status(404).send({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } });
    }
    if (job.status !== 'completed') {
      return reply.status(400).send({ error: { code: 'JOB_NOT_COMPLETE', message: 'Job has not completed yet' } });
    }

    const zipPath = path.join(os.tmpdir(), 'bulk-downloads', `${id}.zip`);
    try {
      await fs.promises.access(zipPath);
    } catch {
      return reply.status(404).send({ error: { code: 'FILE_NOT_FOUND', message: 'Download file not found or has expired' } });
    }

    const stat = await fs.promises.stat(zipPath);
    reply.header('Content-Disposition', `attachment; filename="bulk-download-${id}.zip"`);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', stat.size);
    return reply.send(fs.createReadStream(zipPath));
  });
};

export default jobsRoutes;
