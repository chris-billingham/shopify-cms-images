import { z } from 'zod';
import { config as loadEnv } from 'dotenv';

loadEnv();

const configSchema = z.object({
  // Google Drive (REQUIRED)
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().min(1, 'GOOGLE_SERVICE_ACCOUNT_KEY is required'),
  GOOGLE_TEAM_DRIVE_ID: z.string().min(1, 'GOOGLE_TEAM_DRIVE_ID is required'),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),

  // Shopify (REQUIRED)
  SHOPIFY_STORE_DOMAIN: z.string().min(1, 'SHOPIFY_STORE_DOMAIN is required'),
  SHOPIFY_ADMIN_API_TOKEN: z.string().min(1, 'SHOPIFY_ADMIN_API_TOKEN is required'),
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1, 'SHOPIFY_WEBHOOK_SECRET is required'),

  // Database (REQUIRED)
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // Redis (REQUIRED)
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Auth (REQUIRED)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, 'GOOGLE_OAUTH_CLIENT_ID is required'),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1, 'GOOGLE_OAUTH_CLIENT_SECRET is required'),

  // App (REQUIRED)
  APP_URL: z.string().url('APP_URL must be a valid URL'),
  FRONTEND_ORIGIN: z.string().url('FRONTEND_ORIGIN must be a valid URL'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // File Limits (OPTIONAL)
  MAX_IMAGE_SIZE_MB: z.coerce.number().positive().default(100),
  MAX_VIDEO_SIZE_MB: z.coerce.number().positive().default(1024),
  MAX_TEXT_SIZE_MB: z.coerce.number().positive().default(10),
  MAX_DOCUMENT_SIZE_MB: z.coerce.number().positive().default(50),

  // Search Weights (OPTIONAL)
  SEARCH_WEIGHT_SKU: z.coerce.number().positive().default(10),
  SEARCH_WEIGHT_PRODUCT_TITLE: z.coerce.number().positive().default(5),
  SEARCH_WEIGHT_TAG_VALUE: z.coerce.number().positive().default(3),
  SEARCH_WEIGHT_FILE_NAME: z.coerce.number().positive().default(1),

  // Bulk Download Limits (OPTIONAL)
  BULK_DOWNLOAD_MAX_ASSETS: z.coerce.number().positive().default(500),
  BULK_DOWNLOAD_MAX_SIZE_GB: z.coerce.number().positive().default(5),
  BULK_DOWNLOAD_TIMEOUT_HOURS: z.coerce.number().positive().default(2),
  BULK_DOWNLOAD_RETENTION_HOURS: z.coerce.number().positive().default(24),

  // Retention Policies (OPTIONAL)
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().positive().default(180),
  COMPLETED_JOB_RETENTION_DAYS: z.coerce.number().positive().default(7),
  FAILED_JOB_RETENTION_DAYS: z.coerce.number().positive().default(30),

  // Initial Admin Seeding (OPTIONAL)
  SEED_ADMIN_EMAIL: z.string().email().optional(),

  // Monitoring (OPTIONAL)
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

export const config = loadConfig();
