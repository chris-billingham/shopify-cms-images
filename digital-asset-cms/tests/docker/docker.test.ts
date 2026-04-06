/**
 * Stage 14 — Docker Infrastructure Integration Tests
 *
 * These tests verify the full Docker Compose stack starts, routes correctly
 * through Caddy, runs migrations, and seeds the admin user.
 *
 * Run from: digital-asset-cms/
 *   npx vitest run --config tests/docker/vitest.config.ts
 *
 * Pre-requisites:
 *   - Docker daemon running
 *   - .env present with at minimum DB_PASSWORD, JWT_SECRET, etc.
 *   - Ports 80 and 443 free
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';

const CMS_DIR = join(import.meta.dirname, '../..');
const BASE_URL = 'http://localhost';
const COMPOSE = `docker compose --project-directory ${CMS_DIR}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function compose(args: string) {
  return spawnSync(`${COMPOSE} ${args}`, {
    shell: true,
    cwd: CMS_DIR,
    timeout: 300_000,
    encoding: 'utf8',
  });
}

async function waitForHealth(
  maxWaitMs = 120_000,
  pollMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = compose('ps --format json');
    if (result.status === 0 && result.stdout) {
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      const services = lines.flatMap((line) => {
        try { return [JSON.parse(line) as { Service: string; Health: string; State: string }]; }
        catch { return []; }
      });
      const required = ['caddy', 'app', 'worker', 'frontend', 'db', 'redis'];
      const allUp = required.every((svc) => {
        const s = services.find((x) => x.Service === svc);
        return s && (s.Health === 'healthy' || s.State === 'running');
      });
      const allHealthy = required.every((svc) => {
        const s = services.find((x) => x.Service === svc);
        // services without a HEALTHCHECK only have State, not Health
        return s && (s.Health === 'healthy' || (s.Health === '' && s.State === 'running'));
      });
      if (allUp && allHealthy) return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('Stack did not become healthy within timeout');
}

async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  retries = 10,
  delayMs = 3_000,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch {
      if (i === retries - 1) throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

// ── Suite setup / teardown ────────────────────────────────────────────────────

beforeAll(async () => {
  // 14.T6 requires a fresh start from scratch
  compose('down -v --remove-orphans');

  // 14.T1 — Build all images
  const build = compose('build --no-cache');
  if (build.status !== 0) {
    throw new Error(`docker compose build failed:\n${build.stderr}`);
  }

  // Start the stack
  const up = compose('up -d');
  if (up.status !== 0) {
    throw new Error(`docker compose up failed:\n${up.stderr}`);
  }

  // Wait for all services to be healthy
  await waitForHealth(120_000);
}, 300_000);

afterAll(() => {
  compose('down -v --remove-orphans');
}, 60_000);

// ── 14.T1 — Docker build ──────────────────────────────────────────────────────

describe('14.T1 — Docker build', () => {
  it('all images build without errors (verified in beforeAll)', () => {
    // If beforeAll threw, this test suite would not run.
    // Reaching here means the build succeeded.
    expect(true).toBe(true);
  });
});

// ── 14.T2 — Stack startup ─────────────────────────────────────────────────────

describe('14.T2 — Stack startup', () => {
  it('all 6 required services are running', () => {
    const result = compose('ps --format json');
    expect(result.status).toBe(0);

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const services = lines.flatMap((line) => {
      try { return [JSON.parse(line) as { Service: string; State: string }]; }
      catch { return []; }
    });

    const required = ['caddy', 'app', 'worker', 'frontend', 'db', 'redis'];
    for (const svc of required) {
      const s = services.find((x) => x.Service === svc);
      expect(s, `Service '${svc}' not found`).toBeDefined();
      expect(s?.State).toBe('running');
    }
  });
});

// ── 14.T3 — Health endpoint through Caddy ────────────────────────────────────

describe('14.T3 — Health endpoint through Caddy', () => {
  it('GET /api/health returns 200 with dependencies', async () => {
    const res = await fetchWithRetry(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      status: string;
      dependencies: Record<string, { status: string }>;
    };

    // Overall status may be degraded (Drive/Shopify use stub creds) but not unhealthy
    expect(['healthy', 'degraded']).toContain(body.status);

    // PostgreSQL and Redis must be healthy (real services in the stack)
    expect(body.dependencies.postgres?.status).toBe('healthy');
    expect(body.dependencies.redis?.status).toBe('healthy');

    // Drive and Shopify use stub creds — degraded is expected
    expect(body.dependencies).toHaveProperty('google_drive');
    expect(body.dependencies).toHaveProperty('shopify');
  });
});

// ── 14.T4 — Frontend served through Caddy ────────────────────────────────────

describe('14.T4 — Frontend served through Caddy', () => {
  it('GET / returns HTML containing the React root element', async () => {
    const res = await fetchWithRetry(`${BASE_URL}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    // Vite's index.html contains the app root div
    expect(html).toContain('<div id="root"');
    expect(html).toContain('</html>');
  });
});

// ── 14.T5 — WebSocket endpoint through Caddy ─────────────────────────────────

describe('14.T5 — WebSocket endpoint through Caddy', () => {
  it('WebSocket upgrade reaches the app (unauthenticated request returns 401)', async () => {
    // A plain HTTP request to the WS endpoint (without Upgrade headers) should
    // be proxied to the app and return 401 for a missing token.
    const res = await fetchWithRetry(`${BASE_URL}/api/ws`);
    // The app returns 401 for a missing token — this confirms Caddy is routing
    // /api/ws to the backend correctly.
    expect(res.status).toBe(401);
  });
});

// ── 14.T6 — Database migrations on startup ────────────────────────────────────

describe('14.T6 — Database migrations run on startup', () => {
  it('core tables exist after a fresh start from scratch', async () => {
    // Query the database through the app's health endpoint (which queries the DB)
    const res = await fetchWithRetry(`${BASE_URL}/api/health`);
    const body = await res.json() as { dependencies: { postgres: { status: string } } };
    expect(body.dependencies.postgres.status).toBe('healthy');

    // Also verify via docker exec that the tables exist
    const result = execSync(
      `${COMPOSE} exec -T db psql -U cms_user -d cms -c "\\dt" 2>&1`,
      { cwd: CMS_DIR, encoding: 'utf8', timeout: 30_000 },
    );
    // knex_migrations table proves migrations ran
    expect(result).toContain('knex_migrations');
    // Core application tables
    expect(result).toContain('users');
    expect(result).toContain('assets');
  });

  it('admin user is seeded via SEED_ADMIN_EMAIL', async () => {
    const result = execSync(
      `${COMPOSE} exec -T db psql -U cms_user -d cms -c "SELECT email, role FROM users WHERE email = 'admin@test.example.com';" 2>&1`,
      { cwd: CMS_DIR, encoding: 'utf8', timeout: 30_000 },
    );
    expect(result).toContain('admin@test.example.com');
    expect(result).toContain('admin');
  });
});
