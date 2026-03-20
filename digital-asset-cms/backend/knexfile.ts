import type { Knex } from 'knex';
import { config as loadEnv } from 'dotenv';

loadEnv();

const knexConfig: Record<string, Knex.Config> = {
  development: {
    client: 'postgresql',
    connection: process.env['DATABASE_URL'] ?? {
      host: 'localhost',
      port: 5432,
      database: 'cms',
      user: 'cms_user',
      password: 'password',
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
  },
  test: {
    client: 'postgresql',
    connection: process.env['TEST_DATABASE_URL'] ?? {
      host: 'localhost',
      port: 5433,
      database: 'cms_test',
      user: 'cms_user',
      password: 'password',
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
  },
  production: {
    client: 'postgresql',
    connection: process.env['DATABASE_URL'],
    pool: {
      min: 2,
      max: 20,
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
  },
};

export default knexConfig;
