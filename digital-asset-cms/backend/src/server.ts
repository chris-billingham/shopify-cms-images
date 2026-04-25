import { buildApp } from './app.js';
import { db } from './db/connection.js';
import { seedAdminIfNeeded } from '../scripts/seed-admin.js';
import { createJob } from './services/job.service.js';
import { runReconciliation } from './jobs/shopify-reconcile.js';

async function start() {
  // Run database migrations on every startup — idempotent and safe
  await db.migrate.latest();

  // Seed the initial admin if SEED_ADMIN_EMAIL is set and no users exist yet
  const seedResult = await seedAdminIfNeeded();
  if (seedResult.seeded) {
    console.log(`[startup] Admin user seeded: ${seedResult.email}`);
  }

  const app = buildApp();

  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Daily Shopify reconciliation — runs every 24 hours, no user context needed
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const job = await createJob('shopify_reconcile', null);
      await runReconciliation(job.id);
      console.log('[scheduler] Daily Shopify reconciliation completed');
    } catch (err) {
      console.error('[scheduler] Daily Shopify reconciliation failed:', err instanceof Error ? err.message : String(err));
    }
  }, ONE_DAY_MS);
}

start();
