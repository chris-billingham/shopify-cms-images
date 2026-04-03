import { Queue } from 'bullmq';
import { config } from '../config/index.js';

const connection = { url: config.REDIS_URL };

// ── Queues ────────────────────────────────────────────────────────────────────

export const bulkDownloadQueue = new Queue('bulk-download', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const cleanupQueue = new Queue('cleanup', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  },
});
