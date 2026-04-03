import type { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from '../services/auth.service.js';
import { config } from '../config/index.js';

// Overridable for testing (object property so it can be mutated from outside the module)
export const wsConfig = { REFRESH_GRACE_MS: 60_000 };

interface Connection {
  userId: string;
  role: string;
  tokenExpiresAt: number;
  refreshDeadlineTimer?: ReturnType<typeof setTimeout>;
}

const connections = new Map<WebSocket, Connection>();

function scheduleCloseAfterGrace(ws: WebSocket, tokenExpiresAt: number): ReturnType<typeof setTimeout> {
  const delay = tokenExpiresAt - Date.now() + wsConfig.REFRESH_GRACE_MS;
  return setTimeout(() => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.close(4001, 'Token expired — no refresh received');
    }
  }, Math.max(0, delay));
}

export function handleConnection(ws: WebSocket, userId: string, role: string, tokenExpiresAt: number): void {
  const conn: Connection = {
    userId,
    role,
    tokenExpiresAt,
    refreshDeadlineTimer: scheduleCloseAfterGrace(ws, tokenExpiresAt),
  };
  connections.set(ws, conn);

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg['type'] === 'token_refresh') {
      try {
        const payload = verifyAccessToken(msg['token'] as string, config.JWT_SECRET);
        const decoded = jwt.decode(msg['token'] as string) as { exp?: number } | null;
        const newExpiry = (decoded?.exp ?? 0) * 1000;

        if (conn.refreshDeadlineTimer) clearTimeout(conn.refreshDeadlineTimer);
        conn.userId = payload.user_id;
        conn.role = payload.role;
        conn.tokenExpiresAt = newExpiry;
        conn.refreshDeadlineTimer = scheduleCloseAfterGrace(ws, newExpiry);
      } catch {
        // invalid refresh token — leave existing timer running
      }
    }
  });

  ws.on('close', () => {
    if (conn.refreshDeadlineTimer) clearTimeout(conn.refreshDeadlineTimer);
    connections.delete(ws);
  });
}

// ── Emit functions ────────────────────────────────────────────────────────────

export function emitJobProgress(payload: unknown, ownerId: string): void {
  for (const [ws, conn] of connections) {
    if (conn.userId === ownerId && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'job_progress', payload }));
    }
  }
}

export function emitAssetChange(payload: unknown): void {
  for (const [ws] of connections) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'asset_change', payload }));
    }
  }
}

export function emitAdminAlert(payload: unknown): void {
  for (const [ws, conn] of connections) {
    if (conn.role === 'admin' && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'admin_alert', payload }));
    }
  }
}
