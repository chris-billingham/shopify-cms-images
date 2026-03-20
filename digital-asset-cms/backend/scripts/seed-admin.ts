import { db } from '../src/db/connection.js';

/**
 * Seeds the first admin user if the users table is empty and SEED_ADMIN_EMAIL is set.
 * Per §9.6: this is a one-time operation.
 */
export async function seedAdminIfNeeded(): Promise<{ seeded: boolean; email?: string }> {
  const email = process.env['SEED_ADMIN_EMAIL'];
  if (!email) {
    return { seeded: false };
  }

  const count = await db('users').count('id as n').first();
  const existingCount = Number(count?.n ?? 0);

  if (existingCount > 0) {
    return { seeded: false };
  }

  await db('users').insert({
    email,
    name: email.split('@')[0] ?? 'Admin',
    role: 'admin',
    status: 'active',
  });

  return { seeded: true, email };
}

// CLI entry point
// Usage: docker compose exec app node scripts/seed-admin.js --email admin@example.com
if (process.argv[1]?.endsWith('seed-admin.ts') || process.argv[1]?.endsWith('seed-admin.js')) {
  const emailArg = process.argv.indexOf('--email');
  const email = emailArg !== -1 ? process.argv[emailArg + 1] : process.env['SEED_ADMIN_EMAIL'];

  if (!email) {
    console.error('Error: provide --email <address> or set SEED_ADMIN_EMAIL');
    process.exit(1);
  }

  process.env['SEED_ADMIN_EMAIL'] = email;

  const count = await db('users').count('id as n').first();
  if (Number(count?.n ?? 0) > 0) {
    console.error('Error: users already exist. Refusing to seed to prevent privilege escalation.');
    await db.destroy();
    process.exit(1);
  }

  const result = await seedAdminIfNeeded();
  if (result.seeded) {
    console.log(`Admin user created: ${result.email}`);
  }
  await db.destroy();
}
