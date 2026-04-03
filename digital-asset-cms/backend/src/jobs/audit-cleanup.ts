import { db } from '../db/connection.js';
import { config } from '../config/index.js';

export async function runAuditCleanup(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - config.AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db('audit_log').where('created_at', '<', cutoff).delete();
  return { deleted: deleted as unknown as number };
}
