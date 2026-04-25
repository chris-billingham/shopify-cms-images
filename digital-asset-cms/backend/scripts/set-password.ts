import { db } from '../src/db/connection.js';
import { hashPassword } from '../src/services/auth.service.js';

// CLI entry point
// Usage: docker compose exec app node dist/scripts/set-password.js --email admin@example.com --password secret
if (process.argv[1]?.endsWith('set-password.ts') || process.argv[1]?.endsWith('set-password.js')) {
  const emailArg = process.argv.indexOf('--email');
  const email = emailArg !== -1 ? process.argv[emailArg + 1] : undefined;

  const passwordArg = process.argv.indexOf('--password');
  const password = passwordArg !== -1 ? process.argv[passwordArg + 1] : undefined;

  if (!email || !password) {
    console.error('Usage: node dist/scripts/set-password.js --email <address> --password <secret>');
    process.exit(1);
  }

  const user = await db('users').where({ email }).first();
  if (!user) {
    console.error(`Error: no user found with email ${email}`);
    await db.destroy();
    process.exit(1);
  }

  const hash = await hashPassword(password);
  await db('users').where({ email }).update({ password_hash: hash });
  console.log(`Password updated for ${email}`);
  await db.destroy();
}
