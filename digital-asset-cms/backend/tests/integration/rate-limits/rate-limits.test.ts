import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';

const JWT_SECRET = process.env['JWT_SECRET']!;

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
  await destroyTestDb();
});

// ── 11.T3 — Standard rate limiting ───────────────────────────────────────────

describe('11.T3 — Standard CRUD rate limiting (120/min per user)', () => {
  it('rejects the 121st CRUD request with 429', async () => {
    const db = getTestDb();

    // Use a fresh user so this test has its own rate limit bucket
    const [user] = await db('users')
      .insert({ email: 'crud-rl-test@test.com', name: 'CRUD RL Test', role: 'admin', status: 'active' })
      .returning('id');
    const token = createAccessToken(user.id, 'admin', JWT_SECRET);

    let response!: Awaited<ReturnType<typeof app.inject>>;

    // Send 121 CRUD requests (GET /api/tags/keys is lightweight)
    for (let i = 0; i < 121; i++) {
      response = await app.inject({
        method: 'GET',
        url: '/api/tags/keys',
        headers: { authorization: `Bearer ${token}` },
      });
    }

    await db('users').where('id', user.id).delete().catch(() => {});

    expect(response.statusCode).toBe(429);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    // Assert rate limit headers are present
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('allows the first 120 CRUD requests through', async () => {
    const db = getTestDb();

    const [user] = await db('users')
      .insert({ email: 'crud-rl-ok-test@test.com', name: 'CRUD RL OK Test', role: 'admin', status: 'active' })
      .returning('id');
    const token = createAccessToken(user.id, 'admin', JWT_SECRET);

    let successCount = 0;
    for (let i = 0; i < 120; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tags/keys',
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.statusCode !== 429) successCount++;
    }

    await db('users').where('id', user.id).delete().catch(() => {});

    expect(successCount).toBe(120);
  });
});

describe('11.T3 — Bulk operation rate limiting (5/min per user)', () => {
  it('rejects the 6th bulk operation request with 429', async () => {
    const db = getTestDb();

    const [user] = await db('users')
      .insert({ email: 'bulk-rl-test@test.com', name: 'Bulk RL Test', role: 'admin', status: 'active' })
      .returning('id');
    const token = createAccessToken(user.id, 'admin', JWT_SECRET);

    let response!: Awaited<ReturnType<typeof app.inject>>;

    // Send 6 bulk requests (empty body → 400 for first 5, 429 for 6th)
    for (let i = 0; i < 6; i++) {
      response = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-download',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ asset_ids: [] }),
      });
    }

    await db('users').where('id', user.id).delete().catch(() => {});

    expect(response.statusCode).toBe(429);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('allows the first 5 bulk operations through', async () => {
    const db = getTestDb();

    const [user] = await db('users')
      .insert({ email: 'bulk-rl-ok-test@test.com', name: 'Bulk RL OK Test', role: 'admin', status: 'active' })
      .returning('id');
    const token = createAccessToken(user.id, 'admin', JWT_SECRET);

    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-download',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ asset_ids: [] }),
      });
      results.push(res.statusCode);
    }

    await db('users').where('id', user.id).delete().catch(() => {});

    // All 5 should get past the rate limiter (400 = validation error, not 429)
    expect(results.every((code) => code !== 429)).toBe(true);
  });
});
