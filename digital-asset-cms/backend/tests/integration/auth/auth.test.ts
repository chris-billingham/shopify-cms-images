import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  getTestDb,
  runMigrations,
  rollbackMigrations,
  destroyTestDb,
} from '../../helpers/db.js';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { hashPassword, createAccessToken } from '../../../src/services/auth.service.js';
import { seedAdminIfNeeded } from '../../../scripts/seed-admin.js';

// Shared fixtures created once for the suite
let app: FastifyInstance;
let testUserId: string;

const TEST_EMAIL = 'auth-test@example.com';
const TEST_PASSWORD = 'test-password-123';
const JWT_SECRET = process.env['JWT_SECRET']!;

// Helper to extract the refresh token from a Set-Cookie header
function extractRefreshCookie(headers: Record<string, string | string[] | undefined>): string {
  const setCookie = headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '';
  const match = cookieStr.match(/refresh_token=([^;]+)/);
  if (!match?.[1]) throw new Error('refresh_token cookie not found in Set-Cookie header');
  return match[1];
}

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  // Create a shared test user with a known password
  const db = getTestDb();
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const [user] = await db('users')
    .insert({
      email: TEST_EMAIL,
      name: 'Auth Test User',
      role: 'editor',
      status: 'active',
      password_hash: passwordHash,
    })
    .returning('id');
  testUserId = user.id;
});

afterAll(async () => {
  const db = getTestDb();
  // Clean up all test data
  await db('refresh_tokens').where('user_id', testUserId).delete().catch(() => {});
  await db('users').where('id', testUserId).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

// ── 2.T3 — Login flow ────────────────────────────────────────────────────────

describe('2.T3 — Login flow', () => {
  it('returns 200 with access token and sets refresh cookie on correct credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.0.0.3' },
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.split('.')).toHaveLength(3);

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toMatch(/refresh_token=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
  });

  it('returns 401 for an incorrect password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.0.0.3' },
      body: { email: TEST_EMAIL, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 with deactivated message for a deactivated user', async () => {
    const db = getTestDb();
    // Create a deactivated user
    const [deactivated] = await db('users')
      .insert({
        email: 'deactivated@example.com',
        name: 'Deactivated User',
        role: 'viewer',
        status: 'deactivated',
        password_hash: await hashPassword('some-password'),
      })
      .returning('id');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.0.0.3' },
      body: { email: 'deactivated@example.com', password: 'some-password' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('ACCOUNT_DEACTIVATED');
    expect(body.error.message).toMatch(/deactivated/i);

    await db('users').where('id', deactivated.id).delete();
  });
});

// ── 2.T4 — Refresh token rotation ────────────────────────────────────────────

describe('2.T4 — Refresh token rotation', () => {
  it('issues new tokens on valid refresh, and old token becomes invalid (theft detection)', async () => {
    // Step 1: Login to get initial tokens
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.0.0.4' },
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const originalCookie = extractRefreshCookie(loginRes.headers as Record<string, string | string[]>);

    // Step 2: Use the refresh token — should get new tokens
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        'x-forwarded-for': '10.0.0.4',
        cookie: `refresh_token=${originalCookie}`,
      },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshBody = JSON.parse(refreshRes.body);
    expect(typeof refreshBody.accessToken).toBe('string');
    const newCookie = extractRefreshCookie(refreshRes.headers as Record<string, string | string[]>);
    expect(newCookie).not.toBe(originalCookie);

    // Step 3: Replay the OLD refresh token — should trigger theft detection and 401
    const theftRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        'x-forwarded-for': '10.0.0.4',
        cookie: `refresh_token=${originalCookie}`,
      },
    });
    expect(theftRes.statusCode).toBe(401);
    const theftBody = JSON.parse(theftRes.body);
    expect(theftBody.error.message).toMatch(/reuse detected|invalidated/i);

    // Step 4: The NEW token should also be invalidated after theft detection
    const newTokenRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        'x-forwarded-for': '10.0.0.4',
        cookie: `refresh_token=${newCookie}`,
      },
    });
    expect(newTokenRes.statusCode).toBe(401);
  });
});

// ── 2.T5 — Auth middleware ────────────────────────────────────────────────────

describe('2.T5 — Auth middleware', () => {
  // A fresh app instance with test routes pre-registered before ready()
  let middlewareApp: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../../src/app.js');
    const { authenticate, requireRole } = await import('../../../src/middleware/auth.js');

    middlewareApp = buildApp();
    middlewareApp.get(
      '/api/test/protected',
      { preHandler: [authenticate] },
      async (request) => ({ userId: request.user?.user_id })
    );
    middlewareApp.get(
      '/api/test/admin-only',
      { preHandler: [authenticate, requireRole('admin')] },
      async () => ({ ok: true })
    );
    await middlewareApp.ready();
  });

  afterAll(async () => {
    await middlewareApp.close();
  });

  it('returns 401 with no token', async () => {
    const res = await middlewareApp.inject({ method: 'GET', url: '/api/test/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await middlewareApp.inject({
      method: 'GET',
      url: '/api/test/protected',
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with a valid token', async () => {
    const token = createAccessToken(testUserId, 'editor', JWT_SECRET);
    const res = await middlewareApp.inject({
      method: 'GET',
      url: '/api/test/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).userId).toBe(testUserId);
  });

  it('returns 401 when the user has been deactivated in the DB', async () => {
    const db = getTestDb();
    const [u] = await db('users')
      .insert({ email: 'middleware-deactivated@example.com', name: 'MW Test', role: 'viewer', status: 'active' })
      .returning('id');

    const token = createAccessToken(u.id, 'viewer', JWT_SECRET);
    await db('users').where('id', u.id).update({ status: 'deactivated' });

    const res = await middlewareApp.inject({
      method: 'GET',
      url: '/api/test/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);

    await db('users').where('id', u.id).delete();
  });

  it('returns 403 when a viewer token is used on an admin-only route', async () => {
    const db = getTestDb();
    const [u] = await db('users')
      .insert({ email: 'viewer-role@example.com', name: 'Viewer', role: 'viewer', status: 'active' })
      .returning('id');

    const token = createAccessToken(u.id, 'viewer', JWT_SECRET);
    const res = await middlewareApp.inject({
      method: 'GET',
      url: '/api/test/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);

    await db('users').where('id', u.id).delete();
  });
});

// ── 2.T6 — Admin seeding ─────────────────────────────────────────────────────

describe('2.T6 — Admin seeding', () => {
  const SEED_EMAIL = process.env['SEED_ADMIN_EMAIL']!;

  beforeAll(async () => {
    // Ensure no users exist so seeding can run
    const db = getTestDb();
    await db('refresh_tokens').delete();
    await db('users').delete();
  });

  afterAll(async () => {
    // Clean up seeded users so the rest of the suite (if re-run) is unaffected
    const db = getTestDb();
    await db('refresh_tokens').delete();
    await db('users').delete();

    // Recreate the shared test user for any tests that run after this block
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const [user] = await db('users')
      .insert({ email: TEST_EMAIL, name: 'Auth Test User', role: 'editor', status: 'active', password_hash: passwordHash })
      .returning('id');
    testUserId = user.id;
  });

  it('creates an admin user when the users table is empty', async () => {
    const result = await seedAdminIfNeeded();
    expect(result.seeded).toBe(true);
    expect(result.email).toBe(SEED_EMAIL);

    const db = getTestDb();
    const user = await db('users').where('email', SEED_EMAIL).first();
    expect(user).toBeDefined();
    expect(user.role).toBe('admin');
    expect(user.status).toBe('active');
  });

  it('does not create a duplicate when called again', async () => {
    const result = await seedAdminIfNeeded();
    expect(result.seeded).toBe(false);

    const db = getTestDb();
    const users = await db('users').where('email', SEED_EMAIL);
    expect(users).toHaveLength(1);
  });
});

// ── 2.T7 — Auth rate limiting ────────────────────────────────────────────────

describe('2.T7 — Auth rate limiting', () => {
  const RATE_LIMIT_IP = '10.255.255.7'; // unique IP not used by any other test

  it('returns 429 on the 11th request in rapid succession from the same IP', async () => {
    const responses: number[] = [];

    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': RATE_LIMIT_IP },
        body: { email: 'nonexistent@example.com', password: 'irrelevant' },
      });
      responses.push(res.statusCode);
    }

    // First 10 should get through (401 for bad credentials, not 429)
    expect(responses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    // 11th should be rate limited
    expect(responses[10]).toBe(429);
  });

  it('429 response includes a Retry-After header', async () => {
    // Send one more after the bucket is full from the previous test
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': RATE_LIMIT_IP },
      body: { email: 'nonexistent@example.com', password: 'irrelevant' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
