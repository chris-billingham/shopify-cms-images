import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';

const JWT_SECRET = process.env['JWT_SECRET']!;

let app: FastifyInstance;
let adminUserId: string;
let adminToken: string;

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();
  const [user] = await db('users')
    .insert({ email: 'error-test-admin@test.com', name: 'Error Admin', role: 'admin', status: 'active' })
    .returning('id');
  adminUserId = user.id;
  adminToken = createAccessToken(adminUserId, 'admin', JWT_SECRET);
});

afterAll(async () => {
  const db = getTestDb();
  await db('users').where('id', adminUserId).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

// ── 11.T2 — Error response format ────────────────────────────────────────────

describe('11.T2 — Error response format', () => {
  it('returns ASSET_NOT_FOUND with correct format for a non-existent asset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/assets/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe('ASSET_NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.details).toBeDefined();
    expect(typeof body.error.details).toBe('object');
  });

  it('returns RATE_LIMIT_EXCEEDED with correct format when rate limit is hit', async () => {
    // Use a unique user so this test does not interfere with the CRUD rate limit test
    const db = getTestDb();
    const [rlUser] = await db('users')
      .insert({ email: 'rl-format-test@test.com', name: 'RL Format Test', role: 'admin', status: 'active' })
      .returning('id');
    const rlToken = createAccessToken(rlUser.id, 'admin', JWT_SECRET);

    let lastResponse: ReturnType<typeof app.inject> extends Promise<infer R> ? R : never = null as never;

    // Send 6 bulk requests; 5/min bulk limit → 6th should be 429
    for (let i = 0; i < 6; i++) {
      lastResponse = await app.inject({
        method: 'POST',
        url: '/api/assets/bulk-download',
        headers: {
          authorization: `Bearer ${rlToken}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ asset_ids: [] }),
      });
    }

    // Clean up
    await db('users').where('id', rlUser.id).delete().catch(() => {});

    expect(lastResponse.statusCode).toBe(429);
    const body = lastResponse.json() as { error: { code: string; message: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toBeDefined();
  });
});
