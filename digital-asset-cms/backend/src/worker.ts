import { createRedisConnection, createMvRefreshWorker, scheduleMvRefresh, createMvRefreshQueue } from './jobs/mv-refresh.js';

console.log('Worker starting...');

const connection = createRedisConnection();
const mvWorker = createMvRefreshWorker(connection);
const mvQueue = createMvRefreshQueue(connection);

mvWorker.on('completed', (job) => {
  console.log(`[mv-refresh] job ${job.id} completed`);
});

mvWorker.on('failed', (job, err) => {
  console.error(`[mv-refresh] job ${job?.id} failed:`, err.message);
});

scheduleMvRefresh(mvQueue).catch((err: Error) => {
  console.error('[worker] Failed to schedule mv-refresh:', err.message);
});

console.log('Worker started');

// Keep process alive — workers handle their own event loops
process.on('SIGTERM', async () => {
  await mvWorker.close();
  await mvQueue.close();
  connection.disconnect();
  process.exit(0);
});
