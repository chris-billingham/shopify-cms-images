import { Queue, Worker, QueueEvents } from 'bullmq';
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
  return new Queue(MV_REFRESH_QUEUE, { connection });
}

export function createMvRefreshWorker(connection: IORedis): Worker {
  return new Worker(MV_REFRESH_QUEUE, processMvRefresh, { connection });
}

export function createMvRefreshQueueEvents(connection: IORedis): QueueEvents {
  return new QueueEvents(MV_REFRESH_QUEUE, { connection });
}

// Registers the 60-second repeating job — call once at app startup
export async function scheduleMvRefresh(queue: Queue): Promise<void> {
  await queue.add('refresh', {}, {
    repeat: { every: 60_000 },
    jobId: 'mv-refresh-repeat',
  });
}
