import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import * as healthSvc from '../../../src/services/health.service.js';

// ── Suite setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();
  await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
  await destroyTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 11.T1 — Health endpoint ───────────────────────────────────────────────────

describe('11.T1 — Health endpoint', () => {
  it('returns 200 with all dependencies healthy when all services are up', async () => {
    const app = await getTestApp();

    // Mock external services (Drive and Shopify not available in test env)
    vi.spyOn(healthSvc, 'checkDriveHealth').mockResolvedValue({ status: 'healthy' });
    vi.spyOn(healthSvc, 'checkShopifyHealth').mockResolvedValue({ status: 'healthy' });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      dependencies: { postgres: { status: string }; redis: { status: string }; google_drive: { status: string }; shopify: { status: string } };
    };
    expect(body.status).toBe('healthy');
    expect(body.dependencies.postgres.status).toBe('healthy');
    expect(body.dependencies.redis.status).toBe('healthy');
    expect(body.dependencies.google_drive.status).toBe('healthy');
    expect(body.dependencies.shopify.status).toBe('healthy');
  });

  it('returns degraded status when Redis is unreachable but still responds with 200', async () => {
    const app = await getTestApp();

    vi.spyOn(healthSvc, 'checkRedisHealth').mockResolvedValue({
      status: 'degraded',
      message: 'connect ECONNREFUSED',
    });
    vi.spyOn(healthSvc, 'checkDriveHealth').mockResolvedValue({ status: 'healthy' });
    vi.spyOn(healthSvc, 'checkShopifyHealth').mockResolvedValue({ status: 'healthy' });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    // Still responds (does not crash or time out)
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      dependencies: { redis: { status: string; message?: string } };
    };
    expect(body.status).toBe('degraded');
    expect(body.dependencies.redis.status).toBe('degraded');
  });

  it('includes per-dependency status in the response body', async () => {
    const app = await getTestApp();

    vi.spyOn(healthSvc, 'checkDriveHealth').mockResolvedValue({ status: 'healthy' });
    vi.spyOn(healthSvc, 'checkShopifyHealth').mockResolvedValue({ status: 'healthy' });

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const body = response.json() as { dependencies: Record<string, unknown> };

    expect(body.dependencies).toHaveProperty('postgres');
    expect(body.dependencies).toHaveProperty('redis');
    expect(body.dependencies).toHaveProperty('google_drive');
    expect(body.dependencies).toHaveProperty('shopify');
  });

  it('warns on Drive quota usage above 90%', async () => {
    const app = await getTestApp();

    vi.spyOn(healthSvc, 'checkDriveHealth').mockResolvedValue({
      status: 'healthy',
      quota_warning: true,
    });
    vi.spyOn(healthSvc, 'checkShopifyHealth').mockResolvedValue({ status: 'healthy' });

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const body = response.json() as { dependencies: { google_drive: { quota_warning?: boolean } } };

    expect(body.dependencies.google_drive.quota_warning).toBe(true);
  });
});
