import { db } from '../db/connection.js';
import { config } from '../config/index.js';

export async function runJobCleanup(): Promise<{ deleted: number }> {
  const completedCutoff = new Date(Date.now() - config.COMPLETED_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const failedCutoff = new Date(Date.now() - config.FAILED_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deletedCompleted = await db('background_jobs')
    .where('status', 'completed')
    .where('updated_at', '<', completedCutoff)
    .delete();

  const deletedFailed = await db('background_jobs')
    .where('status', 'failed')
    .where('updated_at', '<', failedCutoff)
    .delete();

  return { deleted: (deletedCompleted as unknown as number) + (deletedFailed as unknown as number) };
}
