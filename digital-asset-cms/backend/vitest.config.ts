import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    passWithNoTests: true,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://cms_user:password@localhost:5433/cms_test',
      REDIS_URL: 'redis://localhost:6380',
      JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long!!',
      GOOGLE_SERVICE_ACCOUNT_KEY: '{"type":"service_account","project_id":"test"}',
      GOOGLE_TEAM_DRIVE_ID: 'test-drive-id',
      SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com',
      SHOPIFY_ADMIN_API_TOKEN: 'test-shopify-token',
      SHOPIFY_WEBHOOK_SECRET: 'test-webhook-secret',
      GOOGLE_OAUTH_CLIENT_ID: 'test-oauth-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-oauth-client-secret',
      APP_URL: 'http://localhost:3000',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      SEED_ADMIN_EMAIL: 'admin@test.example.com',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        // Register tsx so Knex's dynamic import() of .ts migration files works
        execArgv: ['--import', 'tsx'],
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
