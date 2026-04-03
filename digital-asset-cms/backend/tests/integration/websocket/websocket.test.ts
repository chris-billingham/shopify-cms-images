import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { WebSocket } from 'ws';
import { getTestApp, closeTestApp } from '../../helpers/app.js';
import { getTestDb, runMigrations, destroyTestDb } from '../../helpers/db.js';
import { createAccessToken } from '../../../src/services/auth.service.js';
import * as wsHandler from '../../../src/websocket/handler.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env['JWT_SECRET']!;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a token expiring ttlSeconds whole seconds from now. */
function shortLivedToken(userId: string, role: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return jwt.sign({ user_id: userId, role, exp }, JWT_SECRET);
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
  });
}

function nextMessageWithTimeout(ws: WebSocket, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForClose timeout')), timeoutMs);
    ws.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Suite setup ───────────────────────────────────────────────────────────────

let app: FastifyInstance;
let adminUserId: string;
let editorUserId: string;
let adminToken: string;
let editorToken: string;

beforeAll(async () => {
  await runMigrations();
  app = await getTestApp();

  const db = getTestDb();

  const [admin] = await db('users')
    .insert({ email: 'ws-admin@test.com', name: 'Admin', role: 'admin', status: 'active' })
    .returning('id');
  adminUserId = admin.id;
  adminToken = createAccessToken(adminUserId, 'admin', JWT_SECRET);

  const [editor] = await db('users')
    .insert({ email: 'ws-editor@test.com', name: 'Editor', role: 'editor', status: 'active' })
    .returning('id');
  editorUserId = editor.id;
  editorToken = createAccessToken(editorUserId, 'editor', JWT_SECRET);
});

afterAll(async () => {
  const db = getTestDb();
  await db('users').whereIn('id', [adminUserId, editorUserId]).delete().catch(() => {});
  await closeTestApp();
  await destroyTestDb();
});

afterEach(() => {
  // Restore default grace period
  wsHandler.wsConfig.REFRESH_GRACE_MS = 60_000;
});

// ── 8.T1 — Valid token connection ─────────────────────────────────────────────

describe('8.T1 — WebSocket connection with valid token', () => {
  it('establishes a connection when token is valid', async () => {
    const ws = await app.injectWS(`/api/ws?token=${adminToken}`);
    expect(ws.readyState).toBe(1 /* OPEN */);
    ws.terminate();
  });
});

// ── 8.T2 — Invalid token rejection ───────────────────────────────────────────

describe('8.T2 — WebSocket connection with invalid token', () => {
  it('rejects the connection with HTTP 401 for an invalid token', async () => {
    await expect(
      app.injectWS('/api/ws?token=this-is-not-a-valid-jwt')
    ).rejects.toThrow('401');
  });

  it('rejects the connection with HTTP 401 when no token is provided', async () => {
    await expect(
      app.injectWS('/api/ws')
    ).rejects.toThrow('401');
  });
});

// ── 8.T3 — Job progress scoping ───────────────────────────────────────────────

describe('8.T3 — Job progress scoping', () => {
  it('delivers job_progress only to the job owner', async () => {
    const wsAdmin = await app.injectWS(`/api/ws?token=${adminToken}`);
    const wsEditor = await app.injectWS(`/api/ws?token=${editorToken}`);

    try {
      wsHandler.emitJobProgress({ job_id: 'job-123', progress: 50 }, adminUserId);

      // Admin (owner) should receive the message
      const adminMsg = await nextMessageWithTimeout(wsAdmin, 500);
      expect(adminMsg['type']).toBe('job_progress');
      expect((adminMsg['payload'] as Record<string, unknown>)['job_id']).toBe('job-123');

      // Editor (non-owner) should NOT receive it
      await expect(nextMessageWithTimeout(wsEditor, 200)).rejects.toThrow('timeout');
    } finally {
      wsAdmin.terminate();
      wsEditor.terminate();
    }
  });
});

// ── 8.T4 — Asset change broadcast ────────────────────────────────────────────

describe('8.T4 — Asset change broadcast', () => {
  it('delivers asset_change to all connected clients', async () => {
    const wsAdmin = await app.injectWS(`/api/ws?token=${adminToken}`);
    const wsEditor = await app.injectWS(`/api/ws?token=${editorToken}`);

    try {
      const [adminMsg, editorMsg] = await Promise.all([
        nextMessageWithTimeout(wsAdmin, 500),
        nextMessageWithTimeout(wsEditor, 500),
        Promise.resolve(wsHandler.emitAssetChange({ asset_id: 'asset-abc', event: 'upload_complete' })),
      ]);

      expect(adminMsg['type']).toBe('asset_change');
      expect(editorMsg['type']).toBe('asset_change');
    } finally {
      wsAdmin.terminate();
      wsEditor.terminate();
    }
  });
});

// ── 8.T5 — Admin alert scoping ────────────────────────────────────────────────

describe('8.T5 — Admin alert scoping', () => {
  it('delivers admin_alert only to admin-role connections', async () => {
    const wsAdmin = await app.injectWS(`/api/ws?token=${adminToken}`);
    const wsEditor = await app.injectWS(`/api/ws?token=${editorToken}`);

    try {
      wsHandler.emitAdminAlert({ message: 'Drive quota at 95%' });

      // Admin should receive the alert
      const adminMsg = await nextMessageWithTimeout(wsAdmin, 500);
      expect(adminMsg['type']).toBe('admin_alert');

      // Editor should NOT receive it
      await expect(nextMessageWithTimeout(wsEditor, 200)).rejects.toThrow('timeout');
    } finally {
      wsAdmin.terminate();
      wsEditor.terminate();
    }
  });
});

// ── 8.T6 — In-band token refresh ─────────────────────────────────────────────

describe('8.T6 — In-band token refresh', () => {
  it('keeps the connection open after a valid token_refresh message', async () => {
    // Token expires in 2 full seconds; grace = 500ms → deadline ~2–3s from now
    wsHandler.wsConfig.REFRESH_GRACE_MS = 500;
    const shortToken = shortLivedToken(editorUserId, 'editor', 2);
    const ws = await app.injectWS(`/api/ws?token=${shortToken}`);

    try {
      // Send refresh at 300ms — well before minimum deadline (2000 + 500 = 2500ms)
      await sleep(300);
      ws.send(JSON.stringify({ type: 'token_refresh', token: editorToken }));

      // Wait 3.5s from start — original deadline has passed but refresh extended it
      await sleep(3200);

      expect(ws.readyState).toBe(1 /* OPEN */);
    } finally {
      ws.terminate();
    }
  });

  it('closes the connection with code 4001 when no refresh is received before the deadline', async () => {
    // Token expires in 1 full second; grace = 300ms → deadline ~1–2s from now
    wsHandler.wsConfig.REFRESH_GRACE_MS = 300;
    const shortToken = shortLivedToken(editorUserId, 'editor', 1);
    const ws = await app.injectWS(`/api/ws?token=${shortToken}`);

    // Wait up to 4s — the close must arrive within that window
    const closeCode = await waitForClose(ws, 4000);
    expect(closeCode).toBe(4001);
  });
});
