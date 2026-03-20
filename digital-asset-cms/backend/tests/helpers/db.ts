import knex, { type Knex } from 'knex';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDbConfig: Knex.Config = {
  client: 'postgresql',
  connection: process.env['TEST_DATABASE_URL'] ?? {
    host: 'localhost',
    port: 5433,
    database: 'cms_test',
    user: 'cms_user',
    password: 'password',
  },
  pool: { min: 1, max: 5 },
  migrations: {
    directory: resolve(__dirname, '../../src/db/migrations'),
    extension: 'ts',
  },
};

let testDb: Knex | null = null;

export function getTestDb(): Knex {
  if (!testDb) {
    testDb = knex(testDbConfig);
  }
  return testDb;
}

export async function runMigrations(): Promise<void> {
  const db = getTestDb();
  await db.migrate.latest();
}

export async function rollbackMigrations(): Promise<void> {
  const db = getTestDb();
  await db.migrate.rollback(undefined, true);
}

export async function destroyTestDb(): Promise<void> {
  if (testDb) {
    await testDb.destroy();
    testDb = null;
  }
}

/**
 * Begin a transaction and return a transaction-bound knex instance.
 * Use in beforeEach / afterEach to roll back after each test.
 */
export async function beginTestTransaction(): Promise<Knex.Transaction> {
  const db = getTestDb();
  return db.transaction();
}
