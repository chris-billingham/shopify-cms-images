import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { emitJobProgress } from '../websocket/handler.js';

export interface BackgroundJob {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  user_id: string | null;
  progress: number;
  result: Record<string, unknown>;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createJob(type: string, userId: string | null): Promise<BackgroundJob> {
  const [job] = await db('background_jobs')
    .insert({
      id: randomUUID(),
      type,
      user_id: userId,
      status: 'pending',
      progress: 0,
      result: JSON.stringify({}),
    })
    .returning('*');
  return job as BackgroundJob;
}

export async function setJobRunning(id: string): Promise<void> {
  await db('background_jobs')
    .where('id', id)
    .update({ status: 'running', updated_at: db.fn.now() });
  const job = await db('background_jobs').where('id', id).select('user_id', 'type', 'progress').first();
  if (job?.user_id) {
    emitJobProgress({ jobId: id, jobName: job.type as string, progress: job.progress as number, status: 'running' }, job.user_id as string);
  }
}

export async function updateJobProgress(id: string, progress: number): Promise<void> {
  await db('background_jobs')
    .where('id', id)
    .update({ progress, updated_at: db.fn.now() });
  const job = await db('background_jobs').where('id', id).select('user_id', 'type').first();
  if (job?.user_id) {
    emitJobProgress({ jobId: id, jobName: job.type as string, progress, status: 'running' }, job.user_id as string);
  }
}

export async function completeJob(id: string, result: Record<string, unknown>): Promise<void> {
  await db('background_jobs')
    .where('id', id)
    .update({ status: 'completed', progress: 100, result: JSON.stringify(result), updated_at: db.fn.now() });
  const job = await db('background_jobs').where('id', id).select('user_id', 'type').first();
  if (job?.user_id) {
    emitJobProgress({ jobId: id, jobName: job.type as string, progress: 100, status: 'completed' }, job.user_id as string);
  }
}

export async function failJob(id: string, error: string): Promise<void> {
  await db('background_jobs')
    .where('id', id)
    .update({ status: 'failed', error, updated_at: db.fn.now() });
  const job = await db('background_jobs').where('id', id).select('user_id', 'type').first();
  if (job?.user_id) {
    emitJobProgress({ jobId: id, jobName: job.type as string, progress: 0, status: 'failed' }, job.user_id as string);
  }
}

export async function getJob(id: string): Promise<BackgroundJob | null> {
  const job = await db('background_jobs').where('id', id).first();
  return (job as BackgroundJob) ?? null;
}
