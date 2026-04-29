import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';

export const MV_REFRESH_QUEUE = 'mv-refresh';

export function createRedisConnection(): IORedis {
  return new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function processMvRefresh(): Promise<void> {
  await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv');
}

export function createMvRefreshQueue(connection: IORedis): Queue {
  // IORedis satisfies ConnectionOptions at runtime; types diverge slightly across package versions
  return new Queue(MV_REFRESH_QUEUE, { connection: connection as unknown as ConnectionOptions });
}

export function createMvRefreshWorker(connection: IORedis): Worker {
  return new Worker(MV_REFRESH_QUEUE, processMvRefresh, { connection: connection as unknown as ConnectionOptions });
}

export function createMvRefreshQueueEvents(connection: IORedis): QueueEvents {
  return new QueueEvents(MV_REFRESH_QUEUE, { connection: connection as unknown as ConnectionOptions });
}

// Registers the 60-second repeating job — call once at app startup
export async function scheduleMvRefresh(queue: Queue): Promise<void> {
  await queue.add('refresh', {}, {
    repeat: { every: 60_000 },
    jobId: 'mv-refresh-repeat',
  });
}
