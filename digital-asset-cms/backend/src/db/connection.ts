import knex from 'knex';
import knexConfig from '../../knexfile.js';

const env = (process.env['NODE_ENV'] as string) ?? 'development';
const environmentConfig = knexConfig[env === 'test' ? 'test' : env === 'production' ? 'production' : 'development'];

if (!environmentConfig) {
  throw new Error(`No knex configuration found for environment: ${env}`);
}

export const db = knex(environmentConfig);
