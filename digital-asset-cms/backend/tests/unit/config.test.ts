import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

// Inline the schema to test it independently of the module loading side effects
const configSchema = z.object({
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().min(1, 'GOOGLE_SERVICE_ACCOUNT_KEY is required'),
  GOOGLE_TEAM_DRIVE_ID: z.string().min(1, 'GOOGLE_TEAM_DRIVE_ID is required'),
  SHOPIFY_STORE_DOMAIN: z.string().min(1, 'SHOPIFY_STORE_DOMAIN is required'),
  SHOPIFY_ADMIN_API_TOKEN: z.string().min(1, 'SHOPIFY_ADMIN_API_TOKEN is required'),
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1, 'SHOPIFY_WEBHOOK_SECRET is required'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, 'GOOGLE_OAUTH_CLIENT_ID is required'),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1, 'GOOGLE_OAUTH_CLIENT_SECRET is required'),
  APP_URL: z.string().url('APP_URL must be a valid URL'),
  FRONTEND_ORIGIN: z.string().url('FRONTEND_ORIGIN must be a valid URL'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MAX_IMAGE_SIZE_MB: z.coerce.number().positive().default(100),
  MAX_VIDEO_SIZE_MB: z.coerce.number().positive().default(1024),
  MAX_TEXT_SIZE_MB: z.coerce.number().positive().default(10),
  MAX_DOCUMENT_SIZE_MB: z.coerce.number().positive().default(50),
  SEARCH_WEIGHT_SKU: z.coerce.number().positive().default(10),
  SEARCH_WEIGHT_PRODUCT_TITLE: z.coerce.number().positive().default(5),
  SEARCH_WEIGHT_TAG_VALUE: z.coerce.number().positive().default(3),
  SEARCH_WEIGHT_FILE_NAME: z.coerce.number().positive().default(1),
  BULK_DOWNLOAD_MAX_ASSETS: z.coerce.number().positive().default(500),
  BULK_DOWNLOAD_MAX_SIZE_GB: z.coerce.number().positive().default(5),
  BULK_DOWNLOAD_TIMEOUT_HOURS: z.coerce.number().positive().default(2),
  BULK_DOWNLOAD_RETENTION_HOURS: z.coerce.number().positive().default(24),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().positive().default(180),
  COMPLETED_JOB_RETENTION_DAYS: z.coerce.number().positive().default(7),
  FAILED_JOB_RETENTION_DAYS: z.coerce.number().positive().default(30),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const validEnv = {
  GOOGLE_SERVICE_ACCOUNT_KEY: 'dGVzdA==',
  GOOGLE_TEAM_DRIVE_ID: 'drive123',
  SHOPIFY_STORE_DOMAIN: 'test.myshopify.com',
  SHOPIFY_ADMIN_API_TOKEN: 'token123',
  SHOPIFY_WEBHOOK_SECRET: 'secret123',
  DATABASE_URL: 'postgresql://cms_user:password@localhost:5433/cms_test',
  REDIS_URL: 'redis://localhost:6380',
  JWT_SECRET: 'a'.repeat(64),
  GOOGLE_OAUTH_CLIENT_ID: 'client123',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret123',
  APP_URL: 'https://cms.example.com',
  FRONTEND_ORIGIN: 'https://cms.example.com',
  NODE_ENV: 'test' as const,
};

describe('Config schema', () => {
  it('parses successfully with all valid required variables', () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it('applies default value of 180 for AUDIT_LOG_RETENTION_DAYS', () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUDIT_LOG_RETENTION_DAYS).toBe(180);
    }
  });

  it('applies correct defaults for search weights (10/5/3/1)', () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SEARCH_WEIGHT_SKU).toBe(10);
      expect(result.data.SEARCH_WEIGHT_PRODUCT_TITLE).toBe(5);
      expect(result.data.SEARCH_WEIGHT_TAG_VALUE).toBe(3);
      expect(result.data.SEARCH_WEIGHT_FILE_NAME).toBe(1);
    }
  });

  it('overrides defaults when optional values are provided', () => {
    const result = configSchema.safeParse({
      ...validEnv,
      AUDIT_LOG_RETENTION_DAYS: '90',
      SEARCH_WEIGHT_SKU: '20',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUDIT_LOG_RETENTION_DAYS).toBe(90);
      expect(result.data.SEARCH_WEIGHT_SKU).toBe(20);
    }
  });

  it('throws ZodError when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...envWithoutDb } = validEnv;
    const result = configSchema.safeParse(envWithoutDb);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('DATABASE_URL');
    }
  });

  it('throws ZodError when JWT_SECRET is too short', () => {
    const result = configSchema.safeParse({ ...validEnv, JWT_SECRET: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('JWT_SECRET');
    }
  });

  it('throws ZodError when GOOGLE_SERVICE_ACCOUNT_KEY is missing', () => {
    const { GOOGLE_SERVICE_ACCOUNT_KEY: _, ...rest } = validEnv;
    const result = configSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('GOOGLE_SERVICE_ACCOUNT_KEY');
    }
  });

  it('rejects invalid NODE_ENV value', () => {
    const result = configSchema.safeParse({ ...validEnv, NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid APP_URL format', () => {
    const result = configSchema.safeParse({ ...validEnv, APP_URL: 'not-a-url' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('APP_URL');
    }
  });
});
