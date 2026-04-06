import { buildApp } from './app.js';
import { db } from './db/connection.js';
import { seedAdminIfNeeded } from '../scripts/seed-admin.js';

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
}

start();
